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
import type { ToolVisibilityController } from '../visibility.ts';
import type { DshPromptSection } from '../types/dsh.ts';
export declare const HIDDEN_TOOLS_SECTION_NAME = "mcp-lazy:hidden-tools";
/** 工具指引约定占用 100~199；190 让这行紧跟在其它工具说明之后。 */
export declare const HIDDEN_TOOLS_SECTION_ORDER = 190;
export declare function createHiddenToolsSection(visibility: ToolVisibilityController): DshPromptSection;
//# sourceMappingURL=hiddenToolsSection.d.ts.map