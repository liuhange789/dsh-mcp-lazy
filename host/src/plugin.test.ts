import { describe, expect, it } from 'vitest'
import { apply } from './index.ts'
import { createFakeHost } from './testing/fakeHost.ts'
import type { DshToolExecution } from './types/dsh.ts'

const ALL_TOOLS = ['mcp__github__create_issue', 'mcp__github__list_issues', 'read']

async function boot(config: unknown = { coreTools: [] }, names = ALL_TOOLS) {
  const host = createFakeHost(names)
  await apply(host.ctx, config)
  return host
}

function execFor(agent: { id?: string }, name: string): DshToolExecution {
  return {
    name,
    arguments: {},
    agent,
    callId: 'call-1',
    signal: new AbortController().signal,
  }
}

describe('dsh-mcp-lazy 插件装配', () => {
  it('注册 lazy_load_tool，并挂上 systemPrompt 提示段', async () => {
    const host = await boot()
    const tool = host.registered.find(item => item.name === 'lazy_load_tool')
    expect(tool).toBeDefined()
    expect(typeof tool!.output.render).toBe('function')
    expect(typeof tool!.output.schema).toBe('object')
    expect(host.sections.map(section => section.name)).toContain('mcp-lazy:hidden-tools')
  })

  it('未激活的 MCP 调用被拦截，提示先调用 lazy_load_tool', async () => {
    const host = await boot()
    const agent = host.createAgent('s1')
    await host.emit('agent/session-start', { agent, source: 'startup' })

    const decision = await host.runPreExecute({ name: 'mcp__github__create_issue', agent })
    expect(decision.kind).toBe('deny')
    expect((decision as { reason: string }).reason).toContain('lazy_load_tool')
  })

  it('lazy_load_tool 之后同一会话可以调用，且提示行里不再列出它', async () => {
    const host = await boot()
    const agent = host.createAgent('s1')
    await host.emit('agent/session-start', { agent, source: 'startup' })

    const tool = host.registered.find(item => item.name === 'lazy_load_tool')!
    const result = await tool.execute({ toolName: 'mcp__github__create_issue' }, execFor(agent, 'lazy_load_tool')) as {
      ok: boolean
      status: string
    }

    expect(result).toMatchObject({ ok: true, status: 'activated' })
    // 激活后限制重装：本次只摘剩下的那个
    expect(host.activeDenials.get(agent)).toEqual(['mcp__github__list_issues'])
    expect((await host.runPreExecute({ name: 'mcp__github__create_issue', agent })).kind).toBe('allow')
    // 下一轮 pre-step 之后仍然保持激活
    await host.emit('agent/pre-step', { agent, messages: [], turn: 2, step: 2 })
    expect((await host.runPreExecute({ name: 'mcp__github__create_issue', agent })).kind).toBe('allow')
    expect(host.sectionText(agent)).not.toContain('mcp__github__create_issue')
    expect(host.sectionText(agent)).toContain('mcp__github__list_issues')
  })

  it('会话结束后激活状态重置', async () => {
    const host = await boot()
    const agent = host.createAgent('s1')
    await host.emit('agent/session-start', { agent, source: 'startup' })
    const tool = host.registered.find(item => item.name === 'lazy_load_tool')!
    await tool.execute({ toolName: 'mcp__github__create_issue' }, execFor(agent, 'lazy_load_tool'))

    await host.emit('agent/disposed', { agent })
    expect((await host.runPreExecute({ name: 'mcp__github__create_issue', agent })).kind).toBe('deny')

    const next = host.createAgent('s2')
    await host.emit('agent/session-start', { agent: next, source: 'startup' })
    expect((await host.runPreExecute({ name: 'mcp__github__create_issue', agent: next })).kind).toBe('deny')
  })

  it('coreTools 白名单始终可用，非 MCP 工具不受影响', async () => {
    const host = await boot({ coreTools: ['mcp__github__list_issues'] })
    const agent = host.createAgent('s1')
    await host.emit('agent/session-start', { agent, source: 'startup' })
    expect(host.activeDenials.get(agent)).toEqual(['mcp__github__create_issue'])
    expect((await host.runPreExecute({ name: 'mcp__github__list_issues', agent })).kind).toBe('allow')
    expect((await host.runPreExecute({ name: 'read', agent })).kind).toBe('allow')
  })

  it('enabled=false 时完全不介入', async () => {
    const host = await boot({ enabled: false })
    expect(host.registered).toHaveLength(0)
    const agent = host.createAgent('s1')
    await host.emit('agent/session-start', { agent, source: 'startup' })
    expect(host.restrictCalls).toHaveLength(0)
    expect((await host.runPreExecute({ name: 'mcp__github__create_issue', agent })).kind).toBe('allow')
  })

  it('lazy_load_tool 对未知名字返回可用清单，而不是抛错', async () => {
    const host = await boot()
    const agent = host.createAgent('s1')
    const tool = host.registered.find(item => item.name === 'lazy_load_tool')!
    const result = await tool.execute({ toolName: 'mcp__nope__missing' }, execFor(agent, 'lazy_load_tool')) as {
      ok: boolean
      status: string
      availableTools: string[]
    }
    expect(result.ok).toBe(false)
    expect(result.status).toBe('unknown-tool')
    expect(result.availableTools).toEqual(['mcp__github__create_issue', 'mcp__github__list_issues'])
  })

  it('提示段在没有被隐藏的工具时为空', async () => {
    const host = await boot({ coreTools: ['mcp__github__create_issue', 'mcp__github__list_issues'] })
    const agent = host.createAgent('s1')
    await host.emit('agent/session-start', { agent, source: 'startup' })
    expect(host.sectionText(agent)).toBe('')
  })
})
