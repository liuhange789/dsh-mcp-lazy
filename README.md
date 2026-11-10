# @liuhange/dsh-mcp-lazy

MCP 工具的**按需加载**：默认只把 `coreTools` 白名单里的几个 MCP 工具放进上下文，其余工具的定义从本会话的工具集里真正移除，模型需要时调用 `lazy_load_tool` 现场装载。

它不做“MCP 管理”（配置、启停、热加载），只做一件事：**给每次请求的前缀瘦身**。

---

## 它解决什么

DSH 的 MCP 客户端会把每个远端工具注册成 `mcp__<server>__<tool>`，这些定义每轮请求都会随工具列表一起发给模型。

- 配 5 个 MCP server、每个 10 个工具 → 50 份 schema 常驻；
- 一次会话里通常只用 2~3 个。

`dsh-mcp-lazy` 让另外 47 个不进上下文，用到哪个装哪个。

| | 常规 | 装上本插件 |
| --- | --- | --- |
| 每轮工具定义 | 全部 MCP 工具 | coreTools + 已激活工具 |
| 模型如何知道还有别的工具 | 看 schema | 看 prompt 里的一行名字清单 |
| 用到新工具 | 直接调用 | 先 `lazy_load_tool`，再调用 |

---

## 安装

MCP 工具必须存在，插件只负责“摘”和“装”，不创建工具。

在 DSH profile（例如 `$DSH_HOME/profiles/web`）里：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@liuhange/dsh-mcp-lazy"
      ]
    }
  },
  "dependencies": {
    "@liuhange/dsh-mcp-lazy": "^1.0.0"
  }
}
```

然后在 profile 目录执行 `npm install`。插件自带的 `cordis.patch.yml` 会把自己插入装配树，不需要你改 `cordis.yml`。

---

## 配置

两个来源，优先级从高到低：

1. **cordis 条目上的 `config`**（profile 的 `cordis.yml` / `cordis.patch.yml`）：

   ```yaml
   - id: "@liuhange/dsh-mcp-lazy"
     name: "@liuhange/dsh-mcp-lazy"
     config:
       coreTools:
         - mcp__filesystem__read_file
         - mcp__github__get_issue
   ```

2. **`$DSH_HOME/dsh-mcp-lazy.json`**（`DSH_HOME` 未设置时是 `~/.dsh`）；不想动 yml 就写这个文件：

   ```json
   {
     "coreTools": ["mcp__filesystem__read_file"],
     "enabled": true,
     "announceHiddenTools": true
   }
   ```

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `coreTools` | `string[]` | `[]` | 常驻的 MCP 工具名，**最多 5 个**，超出的会被丢弃并告警 |
| `enabled` | `boolean` | `true` | `false` 时插件完全不介入 |
| `announceHiddenTools` | `boolean` | `true` | 是否在 systemPrompt 里追加一行“未加载工具名” |

编号规则：`coreTools` 为空表示所有 MCP 工具都按需加载。非 `mcp__` 开头的名字会被忽略并告警 —— 内置工具本来就不受本插件影响。

---

## 实际走的路径：动态移除，不是提示词降级

这是本插件最需要说清楚的一点：

**`ctx.tools` 支持运行时修改工具列表，所以走的是真正的移除，没有使用 systemPrompt 降级方案。**

依据（对照 DSH core 源码 + 真实运行时验证，见 [VERIFICATION.md](./VERIFICATION.md)）：

- `ctx.tools.restrict({ deny })` 可以在运行时收窄某个会话可见的工具集，并且必须在**会话作用域**上调用 —— 也就是 `agent.ctx.get('tools').restrict(...)`。从插件的全局 Context 调用会被注册表拒绝，因为那等于遮蔽所有会话。
- systemPrompt 的工具区由 `tools.schemas(scope)` 投影而来，限制一生效，下一轮请求的工具定义就真的少了这些工具。
- 限制返回 disposer，会话作用域销毁时自动解除；插件同时显式收尾。

唯一保留的提示是**只有名字**的那一行：

> MCP tools available on demand (schemas intentionally left out to save context): mcp__github__create_issue, ... Call lazy_load_tool with the exact toolName before using one.

原因很实际：schema 拿掉之后，模型没有任何途径知道工具叫什么，`lazy_load_tool` 就成了猜谜。名字清单通常一两百个字符，而对应 schema 是几千 token，这笔买卖仍然划算。用 `announceHiddenTools: false` 可以关掉它（代价是模型只能从报错里拿到名字）。

---

## `lazy_load_tool`

调用一次，把工具装进**当前会话**，之后一直可用，直到会话结束。

```json
{ "toolName": "mcp__github__create_issue" }
```

返回结构化结果，不会抛异常：

| `status` | `ok` | 含义 |
| --- | --- | --- |
| `activated` | true | 装载成功，下一轮请求它的定义就回来了 |
| `already-active` | true | 本会话已经装过，幂等 |
| `already-core` | true | 在 `coreTools` 里，本来就不用装 |
| `unknown-tool` | false | 没有这个 MCP 工具，`availableTools` 给出可选名字 |
| `not-mcp-tool` | false | 不是 MCP 工具，无需装载 |
| `no-session` | false | 调用没有携带会话，无法追踪激活 |
| `invalid-request` | false | `toolName` 为空 |

---

## 拦截行为

`tools/pre-execute` 上有一道闸门：**未加载的 MCP 工具调用会被拒绝**，返回的错误会直接告诉模型下一步该干什么：

```
MCP tool "mcp__github__create_issue" is not loaded in this session, so its definition was
left out of your context to save tokens. Call lazy_load_tool with toolName
"mcp__github__create_issue" first; once loaded it stays available until the session ends.
```

放行的四种情况：非 MCP 工具、`coreTools` 里的工具、本会话已激活的工具、`enabled=false`。

已经用 `restrict` 把定义摘掉了，为什么还要这层闸门？因为注册表对未知工具只会回一个 `UNKNOWN_TOOL`，模型看到会以为部署坏了；而且 MCP 异步注册、server 重连、Code Mode 嵌套调用这些窗口都可能绕过“工具列表已刷新”。闸门是最后一道保险，负责把错误变成一句可执行的自救指令。

---

## 工作流程

```
agent/session-start ─┐
agent/pre-step ──────┼─► reconcile：全局 MCP 工具 − coreTools − 已激活 = 需要摘掉的名字
lazy_load_tool ──────┘        └─► agent.ctx.get('tools').restrict({ deny })
                                            │
                                            └─► tools.schemas(scope) 少掉这些定义
                                                └─► 下一轮请求的 tools 数组真的变小

tools/pre-execute ──► 未加载的 MCP 调用 → deny + 自救指令
systemPrompt ───────► 一行“未加载工具名”（只有名字）
agent/disposed ─────► 解除限制 + 清激活状态
```

`reconcile` 只在名单变化时才重装限制，不会每轮都触发 `tools/change` 抖动。

---

## 已知边界（如实说明）

- **MCP 工具必须在装配时已注册**：本插件只处理 `mcp__` 开头的工具。如果某个 MCP server 在会话开始之后才连上，它的工具会在下一次 `agent/pre-step` 才被摘掉 —— 中间那一轮是可见的。
- **激活状态是内存态**：进程重启、会话恢复（resume）都会从“全部未加载”开始。这是刻意的，激活状态本来就属于会话。
- **只影响 MCP 工具**：内置工具、其它插件注册的工具、`lazy_load_tool` 自身永远可见。
- **Code Mode**：`run_code` 里的嵌套调用同样会被闸门拦下并给出提示；但如果宿主的 code mode 实现直接访问注册表内部而不经过 `tools/pre-execute`，则只能依赖移除后的“工具不存在”。实测路径（`tools.execute`）是经过闸门的。
- **不做使用历史学习**：早期想法里有“学习哪些工具常用”，MVP 没有实现 —— 那需要跨会话的统计存储，和“干净的会话级状态”是两套东西。

---

## 开发

```bash
npm install
npm run build
npm test          # 32 个单元测试
npm run verify:real   # 装进真实 DSH core 跑 21 项端到端检查
```

`verify:real` 需要本机有 DSH（默认找 `$DSH_HOME/profiles`，也可用 `DSH_CORE_DIR` 指定 `@deepseek-ai` 目录）。它会真的装配 `cordis + ToolRuntime + SystemPrompt`，注册假 MCP 工具，然后验证“移除 → 拦截 → 装载 → 跨会话重置”的完整链路，不依赖任何 mock。

## License

MIT
