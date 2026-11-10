import { describe, expect, it } from 'vitest'
import { SessionStateStore } from './sessionState.ts'
import { createFakeHost } from './testing/fakeHost.ts'
import { ToolVisibilityController } from './visibility.ts'

function setup(names = ['mcp__fs__read_file', 'mcp__github__create_issue', 'mcp__github__list_issues', 'read']) {
  const host = createFakeHost(names)
  const sessions = new SessionStateStore()
  const logLines: string[] = []
  const controller = new ToolVisibilityController({
    tools: host.tools,
    coreTools: new Set(['mcp__fs__read_file']),
    sessions,
    log: (level, message) => logLines.push(`${level}: ${message}`),
  })
  return { host, sessions, controller, logLines }
}

describe('ToolVisibilityController', () => {
  it('把非白名单、未激活的 MCP 工具全部摘掉，不动内置工具', () => {
    const { host, controller } = setup()
    const agent = host.createAgent('s1')
    controller.reconcile(agent)
    expect(host.restrictCalls).toHaveLength(1)
    expect(host.restrictCalls[0].deny).toEqual(['mcp__github__create_issue', 'mcp__github__list_issues'])
    expect(host.tools.schemas(agent).map(tool => tool.name)).toEqual(
      expect.arrayContaining(['mcp__fs__read_file', 'read']),
    )
    expect(host.tools.schemas(agent).map(tool => tool.name)).not.toContain('mcp__github__create_issue')
  })

  it('名单没变时不重复装限制（避免每轮都触发 tools/change）', () => {
    const { host, controller } = setup()
    const agent = host.createAgent('s1')
    controller.reconcile(agent)
    controller.reconcile(agent)
    controller.reconcile(agent)
    expect(host.restrictCalls).toHaveLength(1)
  })

  it('激活一个工具后重装限制，名单里去掉它', () => {
    const { host, sessions, controller } = setup()
    const agent = host.createAgent('s1')
    controller.reconcile(agent)
    sessions.activate(agent, 'mcp__github__create_issue')
    controller.reconcile(agent)
    expect(host.restrictCalls).toHaveLength(2)
    expect(host.restrictCalls[1].deny).toEqual(['mcp__github__list_issues'])
    expect(controller.hiddenNames(agent)).toEqual(['mcp__github__list_issues'])
  })

  it('新注册的 MCP 工具也会被摘掉（先解除旧限制，不做交集）', () => {
    const { host, controller } = setup()
    const agent = host.createAgent('s1')
    controller.reconcile(agent)
    host.addTool('mcp__slack__post_message')
    controller.reconcile(agent)
    expect(host.restrictCalls.at(-1)?.deny).toContain('mcp__slack__post_message')
    expect(host.tools.schemas(agent).map(tool => tool.name)).not.toContain('mcp__slack__post_message')
  })

  it('会话结束解除限制并清空记录', () => {
    const { host, controller } = setup()
    const agent = host.createAgent('s1')
    controller.reconcile(agent)
    expect(controller.hiddenNames(agent)).toHaveLength(2)
    controller.release(agent)
    expect(controller.hiddenNames(agent)).toEqual([])
    expect(host.tools.schemas(agent).map(tool => tool.name)).toContain('mcp__github__create_issue')
  })

  it('restrict 抛错（工具刚好被注销）时不阻断，下一轮重试', () => {
    const { host, controller, logLines } = setup()
    const agent = host.createAgent('s1')
    host.failNextRestrict()
    controller.reconcile(agent)
    expect(controller.hiddenNames(agent)).toEqual([])
    expect(logLines.some(line => line.includes('failed to apply tool restriction'))).toBe(true)

    controller.reconcile(agent)
    expect(controller.hiddenNames(agent)).toHaveLength(2)
  })

  it('所有工具都在白名单里时不装任何限制', () => {
    const { host, controller } = setup(['mcp__fs__read_file', 'read'])
    controller.reconcile(host.createAgent('s1'))
    expect(host.restrictCalls).toHaveLength(0)
  })
})
