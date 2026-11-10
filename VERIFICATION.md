# 验证记录

本文件记录 `@liuhange/dsh-mcp-lazy` 实际跑过的验证、结论，以及**没有覆盖到的部分**。

- 机器：Windows，Node v24.13.1
- DSH core：`@deepseek-ai/dsh-*` 0.1.0-rc.7（`$DSH_HOME/profiles/node_modules`）
- 日期：2026-11-10

---

## 1. 结论先行：走的是动态移除，不是提示词降级

`ctx.tools` **支持**在运行时修改某个会话可见的工具集，因此插件没有退到
“往 systemPrompt 里塞一句‘以下工具不可用’”的降级方案。

真实链路：

```
agent.ctx.get('tools').restrict({ deny: [...] })
  → ToolRuntime 的 scoped restriction 层
  → tools.schemas(agentScope) 少掉这些工具
  → systemPrompt 工具区投影变小
  → 下一次请求的 tools 数组真的少了这些定义
```

验证脚本里对比了同一会话在 `restrict` 前后的 `systemPrompt.assemble()` 结果：

- `assemble().tools` 从 `[lazy_load_tool, mcp__demo__alpha, mcp__demo__beta, read]`
  变成 `[lazy_load_tool, mcp__demo__alpha, read]`；
- 序列化后的 `tools` 体积随之减少；
- 被摘掉的工具，其 `description`（`echo tool mcp__demo__beta`）在请求载荷里不再出现。

systemPrompt 里保留的只有**一行工具名**，不含任何 schema，用于让模型知道
`lazy_load_tool` 能传什么。

---

## 2. 踩到的两个真实 API 细节（已写进代码注释）

### 2.1 全局 `tools.restrict()` 会被拒绝

从插件（全局）Context 调用：

```
Error: tools.restrict() requires a scoped context (agent.ctx)
```

因为限制是“会话作用域”的概念，全局调用等于遮蔽所有会话。验证脚本把这条作为
一条前置断言跑过，确认插件必须走 `agent.ctx`。

### 2.2 `agent.ctx.tools` 属性访问会触发 cordis 的 inject 守卫

```
Error: cannot get property "tools" without inject
```

会话作用域不是插件 fiber，属性访问走的是 `ReflectService.handler` 的守卫。
正确写法是 `agent.ctx.get('tools')` —— 它返回绑定在调用方 Context 上的
traceable 代理，`restrict()` 内部的 `this.ctx` 才是会话作用域。
代码位置：[visibility.ts](./host/src/visibility.ts) 的 `scopedTools()`。

---

## 3. 真实运行时验证（21 项，全部通过）

`node scripts/verify-real-runtime.mjs`

无 mock：直接装配 `cordis` + `@deepseek-ai/dsh-tools` 的 `ToolRuntime` +
`@deepseek-ai/dsh-system-prompt`，用 `@deepseek-ai/dsh-agent` 的 `agentEvents`
派发会话事件，注册两个假 MCP 工具和一个普通工具。

```
PASS  before activation: beta is registered and visible
PASS  global tools.restrict() is rejected (why the plugin must use agent.ctx)
PASS  after session start: non-core MCP tool removed from the prompt tool list
PASS  coreTools entry stays visible
PASS  non-MCP tool stays visible
PASS  lazy_load_tool is registered and visible
PASS  systemPrompt lists the hidden tool name
PASS  hidden schema really left the request payload
PASS  unloaded MCP call is rejected
PASS  rejection tells the model to call lazy_load_tool
PASS  non-MCP tool still executes
PASS  coreTools entry still executes
PASS  lazy_load_tool succeeds
PASS  lazy_load_tool reports remaining hidden tools
PASS  activated tool returns to the prompt tool list
PASS  activated tool is callable right away
PASS  activation survives the next step
PASS  reloading an active tool is idempotent
PASS  unknown tool name is refused with the available list
PASS  a new session starts with the tool hidden again
PASS  new session cannot call the tool that the old session activated

SUMMARY {"total":21,"passed":21,"failed":0}
```

覆盖的任务要求：

| 要求 | 对应断言 |
| --- | --- |
| 未激活工具调用被拦截 | `unloaded MCP call is rejected` + `rejection tells the model to call lazy_load_tool` |
| `lazy_load_tool` 后可用 | `lazy_load_tool succeeds` + `activated tool returns to the prompt tool list` + `activated tool is callable right away` |
| 会话内保持激活 | `activation survives the next step` |
| 会话结束重置 | `a new session starts with the tool hidden again` + `new session cannot call ...` |
| 白名单 / 非 MCP 工具不受影响 | `coreTools entry stays visible/executes`、`non-MCP tool stays visible/executes` |

---

## 4. 单元测试（32 项，全部通过）

`npm test`（vitest）

| 文件 | 项数 | 覆盖 |
| --- | --- | --- |
| `config.test.ts` | 8 | 默认值、去重、非 MCP 名过滤、5 个上限截断、错类型回退、config 与文件优先级、坏 JSON、`DSH_HOME` 不写死路径 |
| `sessionState.test.ts` | 3 | 幂等激活、会话隔离、`reset` 后清空 |
| `gate.test.ts` | 6 | 非 MCP、coreTools、未激活拒绝、激活后放行、跨会话隔离、无会话拒绝、`enabled=false` |
| `visibility.test.ts` | 7 | 摘除名单、名单不变不重装、激活后重装、新注册工具也摘、释放限制、`restrict` 抛错可重试、全白名单不装限制 |
| `plugin.test.ts` | 8 | 装配（工具 + 提示段）、拦截、装载后可用、跨轮保持、会话结束重置、白名单、`enabled=false`、未知名字返回清单、空提示段 |

另外 `npm run typecheck` 在 `strict` + `noUnusedLocals` + `noUnusedParameters` 下零错误。

---

## 5. 没有覆盖的部分（如实说明）

1. **没有在完整 DSH 桌面应用里点一遍**。验证跑的是 DSH 的 core 包（工具注册表、prompt 装配、会话事件派发），不是 Electron 外壳与真实 MCP server 的连接。差别在于：真实 MCP server 的 schema 更大、注册时机更晚；这两点都不改变本插件的逻辑，但没有被端到端观察过。
2. **MCP 异步注册的竞态**只在单测里用“`restrict` 抛错 → 重试”模拟，没有在真实 server 断线重连时抓过包。
3. **Code Mode 的嵌套调用**：验证的是 `tools.execute` 这条真实路径（会经过 `tools/pre-execute`）。如果宿主某天改成直接访问注册表内部、绕过 waterfall，闸门会失效，只剩“工具已移除”的可观测结果 —— 这一点写在 README 的已知边界里。
4. **多 agent / 子代理**：会话隔离用的是 Agent 对象本身（WeakMap），没有跑过带子代理的场景。
5. **会话恢复（resume）**：设计上激活状态随新 Agent 重置，没有实测 resume 流程。

---

## 6. 未采用的方案及原因

| 方案 | 为什么不用 |
| --- | --- |
| systemPrompt 注入“以下工具不可用” | 只是提示，schema 仍在请求里，省不到 token。这是任务里给的降级路径，实测证明不需要 |
| 卸载/重注册 MCP 工具 | 工具属于 MCP 客户端插件，改它的注册表会波及其它会话，也违反“不动已有插件”的约束 |
| 每个会话挂一份工具子集 | 需要在会话创建时拦截装配，侵入性远大于 `restrict()`，且会与其它插件的注册冲突 |
| 跨会话学习“常用工具” | 需要持久化统计，和“会话级干净状态”是两套模型；MVP 不做 |
