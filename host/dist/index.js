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
import { resolveConfig } from "./config.js";
import { createPreExecuteListener } from "./gate.js";
import { createHiddenToolsSection } from "./prompt/hiddenToolsSection.js";
import { SessionStateStore } from "./sessionState.js";
import { createLazyLoadTool } from "./tool/lazyLoadTool.js";
import { createLog } from "./types/dsh.js";
import { ToolVisibilityController } from "./visibility.js";
export { MAX_CORE_TOOLS, CONFIG_FILE_NAME, configFilePath, dshHome } from "./config.js";
export { LAZY_LOAD_TOOL_NAME } from "./tool/lazyLoadTool.js";
export { HIDDEN_TOOLS_SECTION_NAME } from "./prompt/hiddenToolsSection.js";
export const name = '@liuhange/dsh-mcp-lazy';
/**
 * tools 是主依赖；systemPrompt 只用于补一行“未加载工具名”。
 * 两者都必须声明：cordis 不允许访问未 inject 的服务（会直接抛错），
 * 而 DSH 的核心装配一定同时提供这两个服务。
 */
export const inject = ['tools', 'systemPrompt'];
/**
 * 插件入口。
 * @param ctx Host Context
 * @param pluginConfig cordis 加载器传入的 config；为空时读 $DSH_HOME/dsh-mcp-lazy.json
 */
export async function apply(ctx, pluginConfig) {
    const log = createLog(ctx);
    const config = resolveConfig(pluginConfig);
    for (const warning of config.warnings)
        log('warn', warning);
    if (!config.enabled) {
        log('info', 'mcp-lazy: disabled by config, leaving every MCP tool untouched');
        return;
    }
    const tools = ctx.tools;
    if (!tools) {
        // inject 已经保证 tools 存在；这里只是把“宿主契约变了”变成一条清楚的日志。
        log('warn', 'mcp-lazy: tools service is unavailable, plugin did nothing');
        return;
    }
    const coreTools = new Set(config.coreTools);
    const sessions = new SessionStateStore();
    const visibility = new ToolVisibilityController({ tools, coreTools, sessions, log });
    // 1) 闸门：未加载的 MCP 工具调用直接拒绝，并给出下一步指令。
    ctx.on('tools/pre-execute', ((exec, next) => {
        const listener = createPreExecuteListener({ enabled: true, coreTools, sessions }, log);
        return listener(exec, next);
    }));
    // 2) 会话开始就定一次型，避免第一个请求多带一整轮定义。
    ctx.on('agent/session-start', ((payload) => {
        if (payload.source === 'clear') {
            // clear 是同一个会话里的“重新开始”，激活状态按会话语义一并重置。
            sessions.reset(payload.agent);
            visibility.release(payload.agent);
        }
        visibility.reconcile(payload.agent);
    }));
    // 3) 每个模型请求前对账：MCP 工具是异步注册的，这里保证“下一轮”一定是最新的。
    ctx.on('agent/pre-step', (async (payload, next) => {
        visibility.reconcile(payload.agent);
        return next();
    }));
    // 4) 会话结束：解除限制并清激活状态（会话对象回收后 WeakMap 也会自动释放）。
    ctx.on('agent/disposed', ((payload) => {
        visibility.release(payload.agent);
        sessions.reset(payload.agent);
    }));
    // 5) 模型侧的装载入口。
    tools.register(createLazyLoadTool({ tools, sessions, visibility, coreTools, log }));
    // 6) 未加载工具名提示（只列名字，不含 schema）。
    if (config.announceHiddenTools && ctx.systemPrompt) {
        ctx.effect(() => ctx.systemPrompt.section(createHiddenToolsSection(visibility)));
    }
    log('info', `mcp-lazy: active (config from ${config.source}, coreTools=${config.coreTools.length > 0 ? config.coreTools.join(', ') : '(none)'})`);
}
/** 兼容只找 `setup` 的加载器；与 apply 是同一实现。 */
export const setup = apply;
//# sourceMappingURL=index.js.map