/**
 * `lazy_load_tool`：模型侧唯一的“装载入口”。
 *
 * 设计取舍：
 * - 只做一件事 —— 把一个 MCP 工具加进当前会话的已激活集合，然后立刻重算限制，
 *   让它的定义在**下一轮**请求里重新出现。不缓存 schema、不代理调用，避免成为
 *   第二套工具运行时。
 * - 失败一律返回结构化结果而不是抛异常：模型能读懂 `status` 和 `availableTools`，
 *   自己换一个名字重试，比一个堆栈更像“能用”。
 */

import { isMcpToolName, mcpToolNames } from '../mcpTools.ts'
import type { SessionStateStore } from '../sessionState.ts'
import type { ToolVisibilityController } from '../visibility.ts'
import type {
  DshContentBlock,
  DshToolDefinition,
  DshToolExecution,
  DshToolsService,
  LogFn,
} from '../types/dsh.ts'

export const LAZY_LOAD_TOOL_NAME = 'lazy_load_tool'

/** 一次返回里最多列多少个待装载工具名，避免把结果写成一篇目录。 */
const MAX_AVAILABLE_TOOLS = 50

export type LazyLoadStatus =
  | 'activated'
  | 'already-active'
  | 'already-core'
  | 'not-mcp-tool'
  | 'unknown-tool'
  | 'no-session'
  | 'invalid-request'

export interface LazyLoadOutcome {
  ok: boolean
  toolName: string
  status: LazyLoadStatus
  message: string
  availableTools: string[]
}

export interface LazyLoadToolDeps {
  tools: DshToolsService
  sessions: SessionStateStore
  visibility: ToolVisibilityController
  coreTools: ReadonlySet<string>
  log: LogFn
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    toolName: { type: 'string' },
    status: { type: 'string' },
    message: { type: 'string' },
    availableTools: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'toolName', 'status', 'message', 'availableTools'],
  additionalProperties: false,
} as const

const DESCRIPTION = [
  'Load one MCP tool into this session on demand.',
  'MCP tool definitions are omitted from your context until they are loaded; calling a tool that is not loaded is rejected.',
  'Pass the exact tool name (for example "mcp__github__create_issue").',
  'After a successful call the tool stays callable until the session ends.',
  'The "not loaded" list in the system prompt, or the availableTools field of an error result, tells you which names exist.',
].join(' ')

export function createLazyLoadTool(deps: LazyLoadToolDeps): DshToolDefinition {
  return {
    name: LAZY_LOAD_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'Exact MCP tool name to load, e.g. "mcp__github__create_issue".',
        },
      },
      required: ['toolName'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      render(_args, value): DshContentBlock[] {
        const outcome = value as LazyLoadOutcome
        const lines = [outcome.message]
        if (outcome.availableTools.length > 0) {
          lines.push(`Still not loaded: ${outcome.availableTools.join(', ')}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec): Promise<LazyLoadOutcome> {
      return run(args, exec, deps)
    },
  }
}

function run(args: unknown, exec: DshToolExecution, deps: LazyLoadToolDeps): LazyLoadOutcome {
  const raw = (args ?? {}) as { toolName?: unknown }
  const toolName = typeof raw.toolName === 'string' ? raw.toolName.trim() : ''

  if (toolName.length === 0) {
    return outcome(false, '', 'invalid-request', 'lazy_load_tool requires a non-empty "toolName" string.', [])
  }

  const agent = exec.agent
  if (!agent) {
    return outcome(
      false,
      toolName,
      'no-session',
      `Cannot load "${toolName}": this call has no session, and activation is per session.`,
      [],
    )
  }

  if (!isMcpToolName(toolName)) {
    return outcome(
      false,
      toolName,
      'not-mcp-tool',
      `"${toolName}" is not an MCP tool (MCP tool names look like "mcp__server__tool"); it is always available and needs no loading.`,
      [],
    )
  }

  if (deps.coreTools.has(toolName)) {
    return outcome(
      true,
      toolName,
      'already-core',
      `"${toolName}" is in coreTools, so it is always loaded and needs no activation.`,
      remainingHidden(agent, deps),
    )
  }

  let known: Set<string>
  try {
    known = new Set(mcpToolNames(deps.tools.schemas()))
  } catch (error) {
    deps.log('warn', `mcp-lazy: failed to read tool registry while loading "${toolName}": ${String(error)}`)
    return outcome(false, toolName, 'unknown-tool', `Could not read the tool registry to verify "${toolName}".`, [])
  }

  if (!known.has(toolName)) {
    const available = remainingHidden(agent, deps).filter(name => known.has(name))
    return outcome(
      false,
      toolName,
      'unknown-tool',
      `No MCP tool named "${toolName}" is registered in this session.`,
      available,
    )
  }

  if (deps.sessions.isActive(agent, toolName)) {
    return outcome(
      true,
      toolName,
      'already-active',
      `"${toolName}" is already loaded in this session.`,
      remainingHidden(agent, deps),
    )
  }

  deps.sessions.activate(agent, toolName)
  // 立刻重算限制：下一轮请求的工具定义里就会重新出现它。
  deps.visibility.reconcile(agent)
  deps.log('info', `mcp-lazy: session ${agent.id ?? '(unknown)'} loaded MCP tool "${toolName}"`)

  return outcome(
    true,
    toolName,
    'activated',
    `Loaded "${toolName}". It is callable now and stays loaded until the session ends.`,
    remainingHidden(agent, deps),
  )
}

/** 当前会话里仍未装载的 MCP 工具名，最多返回 MAX_AVAILABLE_TOOLS 个。 */
function remainingHidden(agent: object, deps: LazyLoadToolDeps): string[] {
  try {
    return mcpToolNames(deps.tools.schemas())
      .filter(name => !deps.coreTools.has(name) && !deps.sessions.isActive(agent, name))
      .sort()
      .slice(0, MAX_AVAILABLE_TOOLS)
  } catch {
    return []
  }
}

function outcome(
  ok: boolean,
  toolName: string,
  status: LazyLoadStatus,
  message: string,
  availableTools: string[],
): LazyLoadOutcome {
  return { ok, toolName, status, message, availableTools }
}
