/**
 * `lazy_load_tool`：模型侧唯一的“装载入口”。
 *
 * 设计取舍：
 * - 只做一件事 —— 把一个 MCP 工具加进当前会话的已激活集合，然后立刻重算限制，
 *   让它的定义在**下一轮**请求里重新出现。不缓存 schema、不代理调用，避免成为
 *   第二套工具运行时。
 * - 失败一律返回结构化结果而不是抛异常：模型能读懂 `status` 和 `availableTools`，
 *   自己换一个名字重试，比一个堆栈更像“能用”。
 */
import type { SessionStateStore } from '../sessionState.ts';
import type { ToolVisibilityController } from '../visibility.ts';
import type { DshToolDefinition, DshToolsService, LogFn } from '../types/dsh.ts';
export declare const LAZY_LOAD_TOOL_NAME = "lazy_load_tool";
export type LazyLoadStatus = 'activated' | 'already-active' | 'already-core' | 'not-mcp-tool' | 'unknown-tool' | 'no-session' | 'invalid-request';
export interface LazyLoadOutcome {
    ok: boolean;
    toolName: string;
    status: LazyLoadStatus;
    message: string;
    availableTools: string[];
}
export interface LazyLoadToolDeps {
    tools: DshToolsService;
    sessions: SessionStateStore;
    visibility: ToolVisibilityController;
    coreTools: ReadonlySet<string>;
    log: LogFn;
}
export declare function createLazyLoadTool(deps: LazyLoadToolDeps): DshToolDefinition;
//# sourceMappingURL=lazyLoadTool.d.ts.map