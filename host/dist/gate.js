/**
 * `tools/pre-execute` 闸门：兜住“工具定义已经不在上下文里，模型却还是照着
 * 旧记忆 / 别的会话的名字硬调”的情况。
 *
 * 为什么已经用 restrict 摘掉了定义，还要这一层？
 * - 注册表对“未知工具”的错误是 UNKNOWN_TOOL，模型看到只会当成部署坏了；
 *   这里把错误换成一句可执行的自救指令（先调 lazy_load_tool）。
 * - 第一个请求之前的窗口、MCP server 重连后的窗口、以及 Code Mode 里嵌套
 *   调用的路径，都可能绕过“工具列表已更新”这件事，闸门是最后一道保险。
 *
 * 判定顺序刻意与“可见性”一致：非 MCP 工具、coreTools、本会话已激活 —— 放行。
 */
import { isMcpToolName } from "./mcpTools.js";
/** 被拦截时的提示：必须指名道姓，并告诉模型下一步怎么做。 */
export function blockedReason(toolName, agent) {
    if (!agent) {
        return `MCP tool "${toolName}" can only run inside an agent session: dsh-mcp-lazy tracks lazy loading per session and cannot verify activation for this call.`;
    }
    return `MCP tool "${toolName}" is not loaded in this session, so its definition was left out of your context to save tokens. `
        + `Call lazy_load_tool with toolName "${toolName}" first; once loaded it stays available until the session ends.`;
}
/** 纯判定函数，方便单测直接覆盖，不依赖事件系统。 */
export function decide(exec, deps) {
    if (!deps.enabled)
        return { kind: 'allow' };
    const name = exec.name;
    if (!isMcpToolName(name))
        return { kind: 'allow' };
    if (deps.coreTools.has(name))
        return { kind: 'allow' };
    if (exec.agent && deps.sessions.isActive(exec.agent, name))
        return { kind: 'allow' };
    return { kind: 'deny', reason: blockedReason(name, exec.agent) ?? '' };
}
/** 生成可以直接挂到 `ctx.on('tools/pre-execute')` 的监听器。 */
export function createPreExecuteListener(deps, log) {
    return async (exec, next) => {
        const decision = decide(exec, deps);
        if (decision.kind === 'deny') {
            // 只记 warn 级别的一行，避免把每次被拦都写成错误刷屏。
            log('warn', `mcp-lazy: blocked unloaded MCP tool "${exec.name}"${exec.agent?.id ? ` for session ${exec.agent.id}` : ''}`);
            return decision;
        }
        return next();
    };
}
//# sourceMappingURL=gate.js.map