/**
 * 本文件只声明插件真正用到的那一小部分 DSH Host 契约，结构对照 DSH rc.7 的
 * `@deepseek-ai/dsh-tools`、`dsh-system-prompt`、`dsh-agent` 源码。
 *
 * 刻意用结构化类型而不是 `import type` 那些包，原因有两个：
 * 1. 插件发布到 npm 后不需要携带任何 DSH 内部包作为依赖，安装不会膨胀；
 * 2. 宿主升级时只要下面这些成员没有变化，插件就继续可用，不会因为内部类型搬家而编译失败。
 */
export function createLog(ctx) {
    return (level, message) => {
        const logger = ctx.logger;
        if (logger) {
            const write = level === 'warn' ? logger.warn : level === 'debug' ? logger.debug : logger.info;
            if (typeof write === 'function') {
                write.call(logger, message);
                return;
            }
        }
        ctx.log?.(level, message);
    };
}
//# sourceMappingURL=dsh.js.map