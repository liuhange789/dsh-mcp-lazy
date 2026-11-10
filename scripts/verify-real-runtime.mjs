/**
 * 真实运行时验证：把插件装进 DSH 自己的 cordis + ToolRuntime + SystemPrompt，
 * 走一遍“注册 → 装配 → 拦截 → 装载 → 会话结束”的完整链路。
 *
 * 这里没有任何 mock：
 * - 工具注册、限制、可见性来自 @deepseek-ai/dsh-tools 的真实实现；
 * - prompt 装配来自 @deepseek-ai/dsh-system-prompt；
 * - 会话事件由 @deepseek-ai/dsh-agent 的 agentEvents 派发。
 *
 * 用法：node scripts/verify-real-runtime.mjs
 * 可选环境变量：DSH_HOME（默认 ~/.dsh）、DSH_CORE_DIR（直接指向 @deepseek-ai 目录）。
 */

import { readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROJECT_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function resolveCoreDir() {
  if (process.env.DSH_CORE_DIR) return process.env.DSH_CORE_DIR
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const profiles = join(home, 'profiles')
  const candidates = [
    join(profiles, 'node_modules', '@deepseek-ai'),
    join(profiles, 'web', 'node_modules', '@deepseek-ai'),
  ]
  if (existsSync(profiles)) {
    for (const entry of readdirSync(profiles)) {
      candidates.push(join(profiles, entry, 'node_modules', '@deepseek-ai'))
    }
  }
  const found = candidates.find(dir => existsSync(join(dir, 'dsh-tools', 'lib', 'index.js')))
  if (!found) throw new Error(`cannot find DSH core packages; set DSH_CORE_DIR. Tried: ${candidates.join(', ')}`)
  return found
}

const coreDir = resolveCoreDir()
const loadCore = name => import(pathToFileURL(join(coreDir, name, 'lib', 'index.js')).href)

const { Context } = await loadCore('cordis')
const { SystemPrompt } = await loadCore('dsh-system-prompt')
const { ToolRuntime } = await loadCore('dsh-tools')
const { createScope } = await loadCore('dsh-scope')
const { agentEvents } = await loadCore('dsh-agent')
const pluginModule = await import(pathToFileURL(join(PROJECT_ROOT, 'host', 'dist', 'index.js')).href)
const plugin = pluginModule.default ?? pluginModule

const checks = []
function check(id, ok, detail = '') {
  checks.push({ id, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? ` — ${detail}` : ''}`)
}

function textOf(result) {
  return (result.content ?? []).map(block => block.text ?? '').join('\n')
}

function toolNames(assembly) {
  return assembly.tools.map(tool => tool.name).sort()
}

/** 一个只有回显行为的 MCP 工具，够用来观察“可见 / 可执行 / 被拦截”。 */
function echoTool(name) {
  return {
    name,
    description: `echo tool ${name}`,
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { echo: { type: 'string' } },
        required: ['echo'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: String(value.echo) }],
    },
    execute: async args => ({ echo: `${name}:${args?.value ?? ''}` }),
  }
}

const signal = new AbortController().signal
let callSeq = 0
const execute = (name, args, agent) => ctx.tools.execute({
  callId: `call-${++callSeq}`,
  name,
  arguments: args,
  agent,
  signal,
})

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, {})

ctx.tools.register(echoTool('mcp__demo__alpha'))
ctx.tools.register(echoTool('mcp__demo__beta'))
ctx.tools.register(echoTool('read'))

// coreTools 只留 alpha：beta 必须被摘掉，read 不是 MCP 工具必须不受影响。
await ctx.plugin(plugin, { coreTools: ['mcp__demo__alpha'] })

const sessionOne = { id: 'session-1' }
const scopeOne = createScope(ctx, sessionOne)
sessionOne.ctx = scopeOne.ctx
const eventsOne = agentEvents(ctx, sessionOne)

// —— 会话开始前：beta 仍然全局可见，说明“摘掉”确实发生在插件这一层 ——
const before = await ctx.systemPrompt.assemble({ agent: sessionOne, scope: sessionOne })
check(
  'before activation: beta is registered and visible',
  toolNames(before).includes('mcp__demo__beta'),
  toolNames(before).join(', '),
)

// 插件没有参与装配时，restrict 从全局 Context 调用会被注册表拒绝（记录设计依据）。
let globalRestrictMessage = ''
try {
  ctx.tools.restrict({ deny: ['mcp__demo__beta'] })
} catch (error) {
  globalRestrictMessage = String(error)
}
check(
  'global tools.restrict() is rejected (why the plugin must use agent.ctx)',
  globalRestrictMessage.includes('requires a scoped context'),
)

// —— 会话开始 ——
eventsOne.emit('agent/session-start', { source: 'startup' })
await eventsOne.waterfall(
  'agent/pre-step',
  { messages: [], turn: 1, step: 1, signal },
  async () => ({ kind: 'context' }),
)

const afterStart = await ctx.systemPrompt.assemble({ agent: sessionOne, scope: sessionOne })
const afterNames = toolNames(afterStart)
check(
  'after session start: non-core MCP tool removed from the prompt tool list',
  !afterNames.includes('mcp__demo__beta'),
  afterNames.join(', '),
)
check('coreTools entry stays visible', afterNames.includes('mcp__demo__alpha'))
check('non-MCP tool stays visible', afterNames.includes('read'))
check('lazy_load_tool is registered and visible', afterNames.includes('lazy_load_tool'))
check(
  'systemPrompt lists the hidden tool name',
  JSON.stringify(afterStart.sections).includes('mcp__demo__beta'),
)
check(
  'hidden schema really left the request payload',
  !JSON.stringify(afterStart.tools).includes('echo tool mcp__demo__beta'),
)

const savedChars = JSON.stringify(before.tools).length - JSON.stringify(afterStart.tools).length
console.log(`INFO  tool-definition payload shrank by ${savedChars} chars for this one tool`)

// —— 未加载就调用：必须被拦下，并给出“先 lazy_load_tool”的指令 ——
const blocked = await execute('mcp__demo__beta', { value: 'x' }, sessionOne)
check('unloaded MCP call is rejected', blocked.isError === true, textOf(blocked).slice(0, 120))
check(
  'rejection tells the model to call lazy_load_tool',
  textOf(blocked).includes('lazy_load_tool') && textOf(blocked).includes('mcp__demo__beta'),
)

// —— 非 MCP 工具和 coreTools 不受闸门影响 ——
const readOk = await execute('read', { value: 'r' }, sessionOne)
check('non-MCP tool still executes', readOk.isError === false && textOf(readOk).includes('read:r'))
const coreOk = await execute('mcp__demo__alpha', { value: 'a' }, sessionOne)
check('coreTools entry still executes', coreOk.isError === false && textOf(coreOk).includes('mcp__demo__alpha:a'))

// —— 装载：工具回到 prompt，并且可以立即执行 ——
const loaded = await execute('lazy_load_tool', { toolName: 'mcp__demo__beta' }, sessionOne)
check('lazy_load_tool succeeds', loaded.isError === false && loaded.value?.status === 'activated', textOf(loaded))
check('lazy_load_tool reports remaining hidden tools', Array.isArray(loaded.value?.availableTools))

const afterLoad = await ctx.systemPrompt.assemble({ agent: sessionOne, scope: sessionOne })
check(
  'activated tool returns to the prompt tool list',
  toolNames(afterLoad).includes('mcp__demo__beta'),
  toolNames(afterLoad).join(', '),
)
check(
  'activated tool is callable right away',
  (await execute('mcp__demo__beta', { value: 'y' }, sessionOne)).isError === false,
)

// —— 同一会话内，后续轮次保持激活 ——
await eventsOne.waterfall(
  'agent/pre-step',
  { messages: [], turn: 2, step: 2, signal },
  async () => ({ kind: 'context' }),
)
const secondTurn = await ctx.systemPrompt.assemble({ agent: sessionOne, scope: sessionOne })
check('activation survives the next step', toolNames(secondTurn).includes('mcp__demo__beta'))

const secondLoad = await execute('lazy_load_tool', { toolName: 'mcp__demo__beta' }, sessionOne)
check('reloading an active tool is idempotent', secondLoad.value?.status === 'already-active')

const bogus = await execute('lazy_load_tool', { toolName: 'mcp__demo__missing' }, sessionOne)
check(
  'unknown tool name is refused with the available list',
  bogus.isError === false && bogus.value?.status === 'unknown-tool' && bogus.value.availableTools.length === 0,
  textOf(bogus),
)

// —— 会话结束：激活状态重置 ——
eventsOne.emit('agent/disposed', {})
await scopeOne.dispose()

const sessionTwo = { id: 'session-2' }
const scopeTwo = createScope(ctx, sessionTwo)
sessionTwo.ctx = scopeTwo.ctx
const eventsTwo = agentEvents(ctx, sessionTwo)
eventsTwo.emit('agent/session-start', { source: 'startup' })
const fresh = await ctx.systemPrompt.assemble({ agent: sessionTwo, scope: sessionTwo })
check(
  'a new session starts with the tool hidden again',
  !toolNames(fresh).includes('mcp__demo__beta'),
  toolNames(fresh).join(', '),
)
check(
  'new session cannot call the tool that the old session activated',
  (await execute('mcp__demo__beta', { value: 'z' }, sessionTwo)).isError === true,
)

await scopeTwo.dispose()
await ctx.dispose?.()

const failed = checks.filter(item => !item.ok)
console.log('\nSUMMARY', JSON.stringify({ total: checks.length, passed: checks.length - failed.length, failed: failed.length }))
if (failed.length > 0) process.exitCode = 1
