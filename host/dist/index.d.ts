/**
 * @liuhange/dsh-mcp-lazy —— MCP 工具的按需加载。
 *
 * 它解决的是一个和“MCP 管理”不同的问题：MCP server 配得越多，每次请求固定携带的
 * 工具定义就越多。本插件在会话开始时只保留 coreTools 白名单，其余 MCP 工具的定义
 * 从该会话的工具集里真正移除，模型需要时通过 lazy_load_tool 现场装载。
 *
 * 数据流（每个会话一条）：
 *
 *   agent/session-start ─┐
 *   agent/pre-step ──────┼─► ToolVisibilityController.reconcile
 *   lazy_load_tool ──────┘        │
 *                                 ├─ 全局 MCP 工具名 − coreTools − 已激活 = 需要摘掉的名字
 *                                 └─ agent.ctx.tools.restrict({ deny })  ← 真正生效的地方
 *
 *   tools/pre-execute ──► 闸门：未加载的 MCP 工具给一句可执行的错误提示
 *   systemPrompt ───────► 一行“当前未加载的工具名”（只有名字，没有 schema）
 */
import type { DshHostContext } from './types/dsh.ts';
export { MAX_CORE_TOOLS, CONFIG_FILE_NAME, configFilePath, dshHome } from './config.ts';
export type { McpLazyConfig, ResolvedConfig } from './config.ts';
export { LAZY_LOAD_TOOL_NAME } from './tool/lazyLoadTool.ts';
export { HIDDEN_TOOLS_SECTION_NAME } from './prompt/hiddenToolsSection.ts';
export declare const name = "@liuhange/dsh-mcp-lazy";
/**
 * tools 是主依赖；systemPrompt 只用于补一行“未加载工具名”。
 * 两者都必须声明：cordis 不允许访问未 inject 的服务（会直接抛错），
 * 而 DSH 的核心装配一定同时提供这两个服务。
 */
export declare const inject: readonly ["tools", "systemPrompt"];
/**
 * 插件入口。
 * @param ctx Host Context
 * @param pluginConfig cordis 加载器传入的 config；为空时读 $DSH_HOME/dsh-mcp-lazy.json
 */
export declare function apply(ctx: DshHostContext, pluginConfig?: unknown): Promise<void>;
/** 兼容只找 `setup` 的加载器；与 apply 是同一实现。 */
export declare const setup: typeof apply;
//# sourceMappingURL=index.d.ts.map