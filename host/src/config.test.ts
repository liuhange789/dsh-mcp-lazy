import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_CORE_TOOLS, configFilePath, dshHome, normalizeConfig, resolveConfig } from './config.ts'

describe('normalizeConfig', () => {
  it('默认值：启用、无白名单、注入提示行', () => {
    const config = normalizeConfig(undefined, 'default')
    expect(config).toMatchObject({ enabled: true, coreTools: [], announceHiddenTools: true, source: 'default' })
    expect(config.warnings).toEqual([])
  })

  it('去重、去空白、过滤非 MCP 名字并给出警告', () => {
    const config = normalizeConfig(
      { coreTools: [' mcp__github__get_issue ', 'mcp__github__get_issue', 'read', ''] },
      'plugin',
    )
    expect(config.coreTools).toEqual(['mcp__github__get_issue'])
    expect(config.warnings.some(line => line.includes('"read" is not an MCP tool'))).toBe(true)
  })

  it('白名单超过上限时截断并告警', () => {
    const names = Array.from({ length: MAX_CORE_TOOLS + 2 }, (_, index) => `mcp__s__t${index}`)
    const config = normalizeConfig({ coreTools: names }, 'plugin')
    expect(config.coreTools).toHaveLength(MAX_CORE_TOOLS)
    expect(config.coreTools).toEqual(names.slice(0, MAX_CORE_TOOLS))
    expect(config.warnings.some(line => line.includes('at most 5'))).toBe(true)
  })

  it('类型不对时退回默认值而不是崩溃', () => {
    const config = normalizeConfig({ enabled: 'yes', announceHiddenTools: 1, coreTools: 'mcp__a__b' }, 'plugin')
    expect(config.enabled).toBe(true)
    expect(config.announceHiddenTools).toBe(true)
    expect(config.coreTools).toEqual([])
    expect(config.warnings).toHaveLength(3)
  })
})

describe('resolveConfig', () => {
  it('plugin 配置优先于配置文件', () => {
    const config = resolveConfig({ coreTools: ['mcp__a__b'] }, 'Z:/definitely-not-here.json')
    expect(config.source).toBe('plugin')
    expect(config.coreTools).toEqual(['mcp__a__b'])
  })

  it('没有 plugin 配置时读 $DSH_HOME/dsh-mcp-lazy.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-lazy-'))
    const file = join(dir, 'dsh-mcp-lazy.json')
    writeFileSync(file, JSON.stringify({ coreTools: ['mcp__fs__read_file'] }))
    const config = resolveConfig(undefined, file)
    expect(config.source).toBe('file')
    expect(config.coreTools).toEqual(['mcp__fs__read_file'])
  })

  it('配置文件是坏 JSON 时退回默认值并告警', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-lazy-'))
    const file = join(dir, 'dsh-mcp-lazy.json')
    writeFileSync(file, '{ not json')
    const config = resolveConfig(undefined, file)
    expect(config.source).toBe('default')
    expect(config.coreTools).toEqual([])
    expect(config.warnings[0]).toContain('failed to read')
  })

  it('路径来自 DSH_HOME，而不是写死的用户目录', () => {
    expect(dshHome({ DSH_HOME: 'D:/dsh-home' })).toBe('D:/dsh-home')
    expect(configFilePath({ DSH_HOME: 'D:/dsh-home' })).toBe(join('D:/dsh-home', 'dsh-mcp-lazy.json'))
  })
})
