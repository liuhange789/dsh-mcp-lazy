/**
 * 本文件只声明插件真正用到的那一小部分 DSH Host 契约，结构对照 DSH rc.7 的
 * `@deepseek-ai/dsh-tools`、`dsh-system-prompt`、`dsh-agent` 源码。
 *
 * 刻意用结构化类型而不是 `import type` 那些包，原因有两个：
 * 1. 插件发布到 npm 后不需要携带任何 DSH 内部包作为依赖，安装不会膨胀；
 * 2. 宿主升级时只要下面这些成员没有变化，插件就继续可用，不会因为内部类型搬家而编译失败。
 */

/** 工具注册表投影给模型的一份工具定义。 */
export interface DshToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** 工具结果回给模型的最小内容块。 */
export interface DshContentBlock {
  type: 'text'
  text: string
}

/** `tools/pre-execute` 的返回值：放行、拒绝、或请求人工确认。 */
export type DshPreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

/** 本插件只读取 id 和 ctx；ctx 是会话作用域的 Context。 */
export interface DshAgent {
  id?: string
  /**
   * 该会话作用域的 Context。`tools.restrict()` 必须经由它调用 ——
   * 直接从插件（全局）Context 调用会被注册表拒绝，因为那会遮蔽所有会话。
   */
  ctx?: DshHostContext
}

/** 一次待执行 / 执行中的工具调用。 */
export interface DshToolExecution {
  name: string
  arguments: unknown
  /** 调用方的会话；没有会话的调用无法追踪激活状态。 */
  agent?: DshAgent
  callId: string
  signal: AbortSignal
}

/** 工具定义：注册表要求 output.schema 是对象、output.render 是函数、execute 返回对象。 */
export interface DshToolDefinition extends DshToolSchema {
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): DshContentBlock[]
  }
  execute(args: unknown, exec: DshToolExecution): Promise<unknown>
}

/** `tools` 服务中本插件用到的三个方法。 */
export interface DshToolsService {
  register(definition: DshToolDefinition): () => void
  /** 不传 scope 时是全局视角；传会话（Agent 本身就是 ScopeKey）时是该会话可见的工具。 */
  schemas(scope?: object): readonly DshToolSchema[]
  /** 只能从会话作用域调用；返回的 disposer 解除这次限制。 */
  restrict(filter: { allow?: string[]; deny?: string[] }): () => void
}

/** systemPrompt 片段。text 是函数时，每次装配都会按当前会话重新求值。 */
export interface DshPromptSection {
  name: string
  order: number
  text: string | ((context: { scope?: object }) => string)
}

export interface DshSystemPromptService {
  section(section: DshPromptSection): () => void
}

export interface DshLogger {
  info(message: string): void
  warn(message: string): void
  debug?(message: string): void
}

/** 插件拿到的 Host Context（只列本插件用到的成员）。 */
export interface DshHostContext {
  tools?: DshToolsService
  systemPrompt?: DshSystemPromptService
  logger?: DshLogger
  /** cordis Context#get：取服务时会把返回值绑定到当前 Context，可绕过属性访问的 inject 守卫。 */
  get?(name: string): unknown
  /** 老版本宿主用这个函数式日志接口。 */
  log?(level: 'debug' | 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>): void
  on(event: string, listener: (...args: any[]) => unknown): () => void
  effect(execute: () => void | (() => void)): void
}

/** 统一日志适配：优先用 cordis 的 logger 服务，退回老宿主的 ctx.log，再退回静默。 */
export type LogFn = (level: 'debug' | 'info' | 'warn', message: string) => void

export function createLog(ctx: DshHostContext): LogFn {
  return (level, message) => {
    const logger = ctx.logger
    if (logger) {
      const write = level === 'warn' ? logger.warn : level === 'debug' ? logger.debug : logger.info
      if (typeof write === 'function') {
        write.call(logger, message)
        return
      }
    }
    ctx.log?.(level, message)
  }
}
