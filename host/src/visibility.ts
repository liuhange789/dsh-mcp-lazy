/**
 * 真正的“从 prompt 前缀里摘掉工具定义”。
 *
 * 关键 API 结论（已对照 DSH rc.7 源码验证，并在 scripts/verify-real-runtime.mjs
 * 里用真实注册表跑通）：
 *
 * - `ctx.tools.restrict({ deny })` 支持在**运行时**修改某个会话可见的工具集，
 *   而且必须在会话作用域 Context（`agent.ctx`）上调用；从插件全局 Context 调用
 *   会被注册表拒绝，因为那会遮蔽所有会话。
 * - 限制只过滤“继承来的”工具（全局层与祖先层），不会误伤会话自己注册的工具。
 * - 返回的 disposer 解除本次限制，会话作用域销毁时也会自动解除。
 * - `restrict()` 只接受当前已存在的工具名，所以名单里只能放实际注册过的名字。
 * - systemPrompt 的工具区由 `tools.schemas(scope)` 投影而来，因此限制一旦生效，
 *   下一轮请求的工具定义就真的少了这些工具 —— 不是只加一句提示。
 *
 * 因为 MCP 工具是异步注册的，本插件不追求“启动瞬间一次性定型”：每次
 * `agent/pre-step`（模型请求前）都会重新对账，只在下发名单变化时才重装限制。
 */

import { mcpToolNames } from './mcpTools.ts'
import type { SessionStateStore } from './sessionState.ts'
import type { DshAgent, DshToolsService, LogFn } from './types/dsh.ts'

export interface VisibilityDeps {
  /** 插件全局 Context 上的 tools 服务，用于取全局工具名。 */
  tools: DshToolsService
  coreTools: ReadonlySet<string>
  sessions: SessionStateStore
  log: LogFn
}

interface AppliedRestriction {
  dispose: () => void
  denied: string[]
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

/**
 * 取“绑定到该会话作用域”的 tools 服务。
 *
 * 不能用 `agent.ctx.tools`：cordis 的属性访问会走 inject 守卫，会话作用域不是插件 fiber，
 * 直接取属性会抛 `cannot get property "tools" without inject`。
 * `agent.ctx.get('tools')` 返回一个绑定在调用方 Context 上的 traceable 代理，
 * 这样 `restrict()` 里的 `this.ctx` 才是会话作用域，注册表才会把限制落到这个会话上。
 */
export function scopedTools(agent: DshAgent): DshToolsService | undefined {
  const agentCtx = agent.ctx
  if (!agentCtx) return undefined
  if (typeof agentCtx.get === 'function') {
    const service = agentCtx.get('tools') as DshToolsService | undefined
    if (service) return service
  }
  try {
    return agentCtx.tools
  } catch {
    return undefined
  }
}

export class ToolVisibilityController {
  /** 每个会话当前装着的限制；key 是 Agent 对象。 */
  private readonly applied = new WeakMap<object, AppliedRestriction>()
  private warnedMissingScope = false
  private warnedRestrictFailure = false

  constructor(private readonly deps: VisibilityDeps) {}

  /** 本插件从该会话里摘掉的工具名（排序后）。systemPrompt 的提示行直接用它。 */
  hiddenNames(scope: object): string[] {
    return this.applied.get(scope)?.denied ?? []
  }

  /**
   * 让某个会话的可见工具集对齐“全局 MCP 工具 − coreTools − 已激活”。
   * 名单没变就什么都不做，避免每次 pre-step 都触发 tools/change 抖动。
   */
  reconcile(agent: DshAgent): void {
    const previous = this.applied.get(agent)
    let desired: string[]
    try {
      const globalMcpTools = mcpToolNames(this.deps.tools.schemas())
      desired = globalMcpTools
        .filter(name => !this.deps.coreTools.has(name) && !this.deps.sessions.isActive(agent, name))
        .sort()
    } catch (error) {
      this.deps.log('warn', `mcp-lazy: failed to read tool registry: ${String(error)}`)
      return
    }

    if (previous && sameNames(previous.denied, desired)) return

    // 先解除旧限制再装新的：如果是“新工具出现”导致名单变长，两条限制取交集
    // 会让新工具继续可见，所以不能靠叠加。
    previous?.dispose()
    this.applied.delete(agent)

    if (desired.length === 0) return

    const sessionTools = scopedTools(agent)
    if (!sessionTools) {
      if (!this.warnedMissingScope) {
        this.warnedMissingScope = true
        this.deps.log('warn', 'mcp-lazy: agent.ctx is unavailable, cannot hide MCP tools for this session')
      }
      return
    }

    try {
      const dispose = sessionTools.restrict({ deny: desired })
      this.applied.set(agent, { dispose, denied: desired })
    } catch (error) {
      // 典型原因：读名单和装限制之间 MCP server 刚好断线，工具名已经不存在。
      // 不阻断会话，下一轮 pre-step 会重新对账。
      if (!this.warnedRestrictFailure) {
        this.warnedRestrictFailure = true
        this.deps.log('warn', `mcp-lazy: failed to apply tool restriction (will retry): ${String(error)}`)
      }
    }
  }

  /** 会话结束时解除限制。restrict 的 disposer 本身也挂在会话作用域上，这里显式收尾并清记录。 */
  release(agent: DshAgent): void {
    const applied = this.applied.get(agent)
    if (!applied) return
    this.applied.delete(agent)
    try {
      applied.dispose()
    } catch {
      // 会话作用域销毁路径上的 disposer 重复调用是安全的；这里吞掉即可。
    }
  }
}
