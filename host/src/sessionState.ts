/**
 * 会话级激活状态。
 *
 * 以 Agent 对象本身为 key（DSH 的 Agent 同时是会话作用域的 ScopeKey）。
 * 用 WeakMap 而不是 Map：会话对象一旦被丢弃，记录自动消失，插件不会拿着
 * 已结束会话的引用不放。
 *
 * “会话结束重置”由两件事共同保证：
 * 1. 入口在 `agent/disposed` 时显式 reset；
 * 2. 即使事件漏了，WeakMap 也随 Agent 一起回收，不会串到下一个会话。
 */

export class SessionStateStore {
  private readonly activated = new WeakMap<object, Set<string>>()

  /** 激活一个工具；返回 true 表示这次是新激活，false 表示之前就已激活。 */
  activate(agent: object, toolName: string): boolean {
    let set = this.activated.get(agent)
    if (!set) {
      set = new Set<string>()
      this.activated.set(agent, set)
    }
    if (set.has(toolName)) return false
    set.add(toolName)
    return true
  }

  isActive(agent: object, toolName: string): boolean {
    return this.activated.get(agent)?.has(toolName) ?? false
  }

  /** 当前会话已激活的工具名（排序后，便于测试与日志稳定）。 */
  activeTools(agent: object): string[] {
    return [...this.activated.get(agent) ?? []].sort()
  }

  /** 清空某个会话的激活状态；会话结束或 clear 时调用。 */
  reset(agent: object): void {
    this.activated.delete(agent)
  }
}
