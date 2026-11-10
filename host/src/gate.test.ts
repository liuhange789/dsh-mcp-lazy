import { describe, expect, it } from 'vitest'
import { decide } from './gate.ts'
import { SessionStateStore } from './sessionState.ts'

const coreTools = new Set(['mcp__fs__read_file'])

function makeDeps(enabled = true) {
  return { enabled, coreTools, sessions: new SessionStateStore() }
}

describe('decide（tools/pre-execute 闸门）', () => {
  it('非 MCP 工具永远放行', () => {
    const deps = makeDeps()
    expect(decide({ name: 'read', agent: { id: 'a' } }, deps).kind).toBe('allow')
  })

  it('coreTools 放行，即使没有会话', () => {
    expect(decide({ name: 'mcp__fs__read_file' }, makeDeps()).kind).toBe('allow')
  })

  it('未激活的 MCP 工具被拒绝，并提示先调用 lazy_load_tool', () => {
    const deps = makeDeps()
    const decision = decide({ name: 'mcp__github__create_issue', agent: { id: 'a' } }, deps)
    expect(decision.kind).toBe('deny')
    const reason = (decision as { reason: string }).reason
    expect(reason).toContain('mcp__github__create_issue')
    expect(reason).toContain('lazy_load_tool')
  })

  it('本会话激活后放行，另一个会话仍然被拒绝', () => {
    const deps = makeDeps()
    const one = { id: 'a' }
    const two = { id: 'b' }
    deps.sessions.activate(one, 'mcp__github__create_issue')
    expect(decide({ name: 'mcp__github__create_issue', agent: one }, deps).kind).toBe('allow')
    expect(decide({ name: 'mcp__github__create_issue', agent: two }, deps).kind).toBe('deny')
  })

  it('没有会话的 MCP 调用被拒绝（无法确认激活状态）', () => {
    const decision = decide({ name: 'mcp__github__create_issue' }, makeDeps())
    expect(decision.kind).toBe('deny')
  })

  it('enabled=false 时完全不介入', () => {
    expect(decide({ name: 'mcp__github__create_issue', agent: { id: 'a' } }, makeDeps(false)).kind).toBe('allow')
  })
})
