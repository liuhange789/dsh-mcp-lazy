/**
 * 用户配置。
 *
 * 配置有两个来源，优先级从高到低：
 * 1. cordis 加载器传给插件的 config（写在 profile 的 cordis.yml / cordis.patch.yml 条目里）；
 * 2. `$DSH_HOME/dsh-mcp-lazy.json`（DSH_HOME 未设置时用 `~/.dsh`）。
 *
 * 两者都没有时用默认值：coreTools 为空，也就是所有 MCP 工具默认都不进上下文，
 * 由模型按需调用 lazy_load_tool 装载 —— 这是插件存在的意义。
 */
/** 白名单上限：常驻工具越多，省下的上下文越少，所以硬限制 5 个。 */
export declare const MAX_CORE_TOOLS = 5;
export declare const CONFIG_FILE_NAME = "dsh-mcp-lazy.json";
export interface McpLazyConfig {
    /** 关闭后插件完全不介入（不注册工具、不装限制）。默认 true。 */
    enabled?: boolean;
    /** 常驻会话的 MCP 工具白名单，最多 5 个。 */
    coreTools?: string[];
    /** 是否在 systemPrompt 里追加一行“当前未加载的工具名”。默认 true。 */
    announceHiddenTools?: boolean;
}
export type ConfigSourceKind = 'plugin' | 'file' | 'default';
export interface ResolvedConfig {
    enabled: boolean;
    coreTools: string[];
    announceHiddenTools: boolean;
    source: ConfigSourceKind;
    /** 配置本身的问题（非法值、超限、不存在的名字等），由入口统一记日志。 */
    warnings: string[];
}
/** DSH 根目录：优先环境变量，其次用户目录。路径不写死，跨机器可用。 */
export declare function dshHome(env?: NodeJS.ProcessEnv): string;
export declare function configFilePath(env?: NodeJS.ProcessEnv): string;
/** 把任意输入归一成可用配置；非法项退回默认值并留下 warning。 */
export declare function normalizeConfig(raw: unknown, source: ConfigSourceKind): ResolvedConfig;
/** 读配置文件；不存在、读到坏 JSON、读失败都返回 undefined 并给出 warning。 */
export declare function readConfigFile(path?: string): {
    raw?: unknown;
    warnings: string[];
};
/**
 * 按优先级解析配置。
 * @param pluginConfig cordis 传给插件的 config；不传则读配置文件。
 * @param filePath 配置文件路径，测试可注入。
 */
export declare function resolveConfig(pluginConfig?: unknown, filePath?: string): ResolvedConfig;
//# sourceMappingURL=config.d.ts.map