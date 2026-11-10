/**
 * systemPrompt 里的一行“未加载工具名”。
 *
 * 这不是降级方案里的“不可用提示” —— 那些工具的 schema 已经被 restrict 真正摘掉了，
 * 这里只是补一份**只有名字**的清单，让模型知道可选菜单，否则它无从知道
 * `lazy_load_tool` 该传什么。
 *
 * 一行 50 个名字大约是 1~2 KB 的字符，而 50 份完整 schema 通常是上万 token，
 * 所以“名字留下、定义摘掉”仍然是有意义的瘦身。
 */
export const HIDDEN_TOOLS_SECTION_NAME = 'mcp-lazy:hidden-tools';
/** 工具指引约定占用 100~199；190 让这行紧跟在其它工具说明之后。 */
export const HIDDEN_TOOLS_SECTION_ORDER = 190;
/** 提示行里最多列多少个名字，其余用计数概括。 */
const MAX_LISTED = 40;
export function createHiddenToolsSection(visibility) {
    return {
        name: HIDDEN_TOOLS_SECTION_NAME,
        order: HIDDEN_TOOLS_SECTION_ORDER,
        text(context) {
            // 无作用域的装配（例如纯全局 prompt 预览）不涉及会话，注入会误导。
            const scope = context.scope;
            if (!scope)
                return '';
            const hidden = visibility.hiddenNames(scope);
            if (hidden.length === 0)
                return '';
            const listed = hidden.slice(0, MAX_LISTED).join(', ');
            const suffix = hidden.length > MAX_LISTED ? `, and ${hidden.length - MAX_LISTED} more` : '';
            return 'MCP tools available on demand (schemas intentionally left out to save context): '
                + `${listed}${suffix}. `
                + 'Call lazy_load_tool with the exact toolName before using one; a loaded tool stays available until the session ends.';
        },
    };
}
//# sourceMappingURL=hiddenToolsSection.js.map