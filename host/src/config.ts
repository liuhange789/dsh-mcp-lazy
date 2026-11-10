/**
 * 用户配置。
 *
 * 配置有两个来源，优先级从高到低：
 * 1. cordis 加载器传给插件的 config（写在 profile 的 cordis.yml / cordis.patch.yml 条目里）；
 * 2. `$DSH_HOME/dsh-mcp-lazy.json`（DSH_HOME 未设置时用 `~/.dsh`）。
 *
 * 两者都没有时用默认值：coreTools 为空，也就是所有 MCP 工具默认都不进上下文，
 * 由模型按需调用 lazy_load_tool 装载 —— 这是插件存在的意义。
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isMcpToolName } from './mcpTools.ts'

/** 白名单上限：常驻工具越多，省下的上下文越少，所以硬限制 5 个。 */
export const MAX_CORE_TOOLS = 5

export const CONFIG_FILE_NAME = 'dsh-mcp-lazy.json'

export interface McpLazyConfig {
  /** 关闭后插件完全不介入（不注册工具、不装限制）。默认 true。 */
  enabled?: boolean
  /** 常驻会话的 MCP 工具白名单，最多 5 个。 */
  coreTools?: string[]
  /** 是否在 systemPrompt 里追加一行“当前未加载的工具名”。默认 true。 */
  announceHiddenTools?: boolean
}

export type ConfigSourceKind = 'plugin' | 'file' | 'default'

export interface ResolvedConfig {
  enabled: boolean
  coreTools: string[]
  announceHiddenTools: boolean
  source: ConfigSourceKind
  /** 配置本身的问题（非法值、超限、不存在的名字等），由入口统一记日志。 */
  warnings: string[]
}

/** DSH 根目录：优先环境变量，其次用户目录。路径不写死，跨机器可用。 */
export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), '.dsh')
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHome(env), CONFIG_FILE_NAME)
}

/** 把任意输入归一成可用配置；非法项退回默认值并留下 warning。 */
export function normalizeConfig(raw: unknown, source: ConfigSourceKind): ResolvedConfig {
  const warnings: string[] = []
  if (raw === undefined || raw === null) {
    return { enabled: true, coreTools: [], announceHiddenTools: true, source, warnings }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`mcp-lazy: config from ${source} is not an object; falling back to defaults`)
    return { enabled: true, coreTools: [], announceHiddenTools: true, source, warnings }
  }

  const input = raw as McpLazyConfig

  let enabled = true
  if (input.enabled !== undefined) {
    if (typeof input.enabled === 'boolean') enabled = input.enabled
    else warnings.push(`mcp-lazy: config.enabled must be a boolean; using true`)
  }

  let announceHiddenTools = true
  if (input.announceHiddenTools !== undefined) {
    if (typeof input.announceHiddenTools === 'boolean') announceHiddenTools = input.announceHiddenTools
    else warnings.push(`mcp-lazy: config.announceHiddenTools must be a boolean; using true`)
  }

  const coreTools: string[] = []
  if (input.coreTools !== undefined) {
    if (!Array.isArray(input.coreTools)) {
      warnings.push(`mcp-lazy: config.coreTools must be an array of MCP tool names; using []`)
    } else {
      for (const entry of input.coreTools) {
        if (typeof entry !== 'string') {
          warnings.push(`mcp-lazy: ignoring non-string coreTools entry ${JSON.stringify(entry)}`)
          continue
        }
        const name = entry.trim()
        if (name.length === 0) continue
        if (coreTools.includes(name)) continue
        if (!isMcpToolName(name)) {
          // 内置工具永远不会被本插件移除，写进白名单没有意义，但也不该因此拒绝启动。
          warnings.push(`mcp-lazy: coreTools entry "${name}" is not an MCP tool (expected "mcp__server__tool"); ignored`)
          continue
        }
        coreTools.push(name)
      }
      if (coreTools.length > MAX_CORE_TOOLS) {
        warnings.push(
          `mcp-lazy: coreTools has ${coreTools.length} entries but at most ${MAX_CORE_TOOLS} are kept; `
          + `dropping ${coreTools.slice(MAX_CORE_TOOLS).join(', ')}`,
        )
        coreTools.length = MAX_CORE_TOOLS
      }
    }
  }

  return { enabled, coreTools, announceHiddenTools, source, warnings }
}

/** 读配置文件；不存在、读到坏 JSON、读失败都返回 undefined 并给出 warning。 */
export function readConfigFile(path = configFilePath()): { raw?: unknown; warnings: string[] } {
  try {
    return { raw: JSON.parse(readFileSync(path, 'utf8')), warnings: [] }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { warnings: [] }
    return { warnings: [`mcp-lazy: failed to read ${path}: ${String(error)}`] }
  }
}

/**
 * 按优先级解析配置。
 * @param pluginConfig cordis 传给插件的 config；不传则读配置文件。
 * @param filePath 配置文件路径，测试可注入。
 */
export function resolveConfig(pluginConfig?: unknown, filePath = configFilePath()): ResolvedConfig {
  if (pluginConfig !== undefined && pluginConfig !== null) {
    return normalizeConfig(pluginConfig, 'plugin')
  }
  const file = readConfigFile(filePath)
  if (file.raw === undefined) {
    return { ...normalizeConfig(undefined, 'default'), warnings: file.warnings }
  }
  const normalized = normalizeConfig(file.raw, 'file')
  return { ...normalized, warnings: [...file.warnings, ...normalized.warnings] }
}
