/**
 * MCP 工具的识别规则。
 *
 * DSH 的 MCP 客户端把每个远端工具注册成 `mcp__<server>__<tool>`，这个前缀是
 * 宿主约定（见 @deepseek-ai/dsh-mcp-client）。本插件只处理这种名字的工具，
 * 内置工具、插件自带工具都不受影响。
 */
export const MCP_TOOL_PREFIX = 'mcp__';
/** 是否是 MCP 工具名。 */
export function isMcpToolName(name) {
    return typeof name === 'string' && name.startsWith(MCP_TOOL_PREFIX) && name.length > MCP_TOOL_PREFIX.length;
}
/** 从工具定义列表里挑出 MCP 工具名，保持注册表给出的顺序。 */
export function mcpToolNames(schemas) {
    return schemas.map(schema => schema.name).filter(isMcpToolName);
}
//# sourceMappingURL=mcpTools.js.map