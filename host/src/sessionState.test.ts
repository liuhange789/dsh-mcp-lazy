import { describe, expect, it } from 'vitest'
import { SessionStateStore } from './sessionState.ts'

describe('SessionStateStore', () => {
  it('激活是幂等的，并返回“是否新激活”', () => {
    const store = new SessionStateStore()
    const agent = { id: 'a' }
    expect(store.activate(agent, 'mcp__s__t')).toBe(true)
    expect(store.activate(agent, 'mcp__s__t')).toBe(false)
    expect(store.activeTools(agent)).toEqual(['mcp__s__t'])
  })

  it('会话之间互不可见', () => {
    const store = new SessionStateStore()
    const one = { id: 'a' }
    const two = { id: 'b' }
    store.activate(one, 'mcp__s__t')
    expect(store.isActive(two, 'mcp__s__t')).toBe(false)
  })

  it('reset 后激活状态清空（会话结束重置）', () => {
    const store = new SessionStateStore()
    const agent = { id: 'a' }
    store.activate(agent, 'mcp__s__t')
    store.reset(agent)
    expect(store.isActive(agent, 'mcp__s__t')).toBe(false)
    expect(store.activeTools(agent)).toEqual([])
  })
})
