/**
 * 单元测试用的宿主替身。
 *
 * 只模拟插件真正依赖的那点语义：
 * - `tools.schemas(scope)`：全局视角 / 会话视角；
 * - `agent.ctx.get('tools')`：拿到绑定到该会话的 restrict；
 * - `tools/pre-execute` 的 waterfall 串行语义。
 *
 * 真实注册表的行为由 scripts/verify-real-runtime.mjs 用 DSH 本体验证，这里不做重复。
 */

import type {
  DshAgent,
  DshHostContext,
  DshPreToolDecision,
  DshPromptSection,
  DshToolDefinition,
  DshToolExecution,
  DshToolSchema,
  DshToolsService,
} from '../types/dsh.ts'

type Listener = (...args: any[]) => unknown

export interface RestrictCall {
  scope: object
  deny: string[]
}

export interface FakeHost {
  ctx: DshHostContext
  tools: DshToolsService
  registered: DshToolDefinition[]
  restrictCalls: RestrictCall[]
  /** 每个会话当前生效的 deny 名册（已解除的会是 undefined）。 */
  activeDenials: Map<object, string[] | undefined>
  logLines: string[]
  sections: DshPromptSection[]
  addTool(name: string): void
  createAgent(id: string): DshAgent
  runPreExecute(exec: Pick<DshToolExecution, 'name' | 'agent'>): Promise<DshPreToolDecision>
  emit(event: string, payload: unknown): Promise<unknown>
  sectionText(scope?: object): string
  /** 让下一次 restrict 抛错，用来测“工具刚好被注销”的竞态。 */
  failNextRestrict(): void
}

export function createFakeHost(toolNames: string[]): FakeHost {
  const names = [...toolNames]
  const listeners = new Map<string, Listener[]>()
  const registered: DshToolDefinition[] = []
  const restrictCalls: RestrictCall[] = []
  const activeDenials = new Map<object, string[] | undefined>()
  const logLines: string[] = []
  const sections: DshPromptSection[] = []
  let failRestrict = false

  const visibleFor = (scope?: object): DshToolSchema[] => {
    const deny = scope ? activeDenials.get(scope) : undefined
    return names
      .filter(name => !deny?.includes(name))
      .map(name => ({ name, description: `tool ${name}`, parameters: { type: 'object', properties: {} } }))
  }

  const tools: DshToolsService = {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
    schemas(scope?: object) {
      return visibleFor(scope)
    },
    // 全局 restrict 在真实注册表里是禁止的；测试里从插件拿到的是会话绑定的那份。
    restrict() {
      throw new Error('restrict() must be called from a scoped context')
    },
  }

  const ctx: DshHostContext = {
    tools,
    logger: {
      info: message => logLines.push(`info: ${message}`),
      warn: message => logLines.push(`warn: ${message}`),
      debug: message => logLines.push(`debug: ${message}`),
    },
    on(event, listener) {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener as Listener)
      listeners.set(event, bucket)
      return () => {}
    },
    effect(execute) {
      execute()
    },
  }

  ctx.systemPrompt = {
    section(section) {
      sections.push(section)
      return () => {}
    },
  }

  const createAgent = (id: string): DshAgent => {
    const agent: DshAgent = { id }
    const scopedTools: DshToolsService = {
      ...tools,
      restrict(filter) {
        if (failRestrict) {
          failRestrict = false
          throw new Error('unknown tool name (simulated unregister race)')
        }
        const deny = [...filter.deny ?? []]
        restrictCalls.push({ scope: agent, deny })
        activeDenials.set(agent, deny)
        return () => {
          if (activeDenials.get(agent) === deny) activeDenials.set(agent, undefined)
        }
      },
    }
    agent.ctx = {
      get: (name: string) => (name === 'tools' ? scopedTools : undefined),
      on: ctx.on,
      effect: ctx.effect,
    }
    return agent
  }

  return {
    ctx,
    tools,
    registered,
    restrictCalls,
    activeDenials,
    logLines,
    sections,
    addTool(name) {
      if (!names.includes(name)) names.push(name)
    },
    createAgent,
    async runPreExecute(exec) {
      const chain = listeners.get('tools/pre-execute') ?? []
      let index = -1
      const next = async (): Promise<DshPreToolDecision> => {
        index += 1
        const listener = chain[index]
        if (!listener) return { kind: 'allow' }
        return listener(exec, next) as Promise<DshPreToolDecision>
      }
      return next()
    },
    async emit(event, payload) {
      const bucket = listeners.get(event) ?? []
      let result: unknown
      for (const listener of bucket) {
        result = await listener(payload, async () => ({ messages: [] }))
      }
      return result
    },
    sectionText(scope) {
      const section = sections.find(item => item.name === 'mcp-lazy:hidden-tools')
      if (!section) return ''
      return typeof section.text === 'function' ? section.text({ scope }) : section.text
    },
    failNextRestrict() {
      failRestrict = true
    },
  }
}
