import { test, expect } from 'claude-code/testing'
import { findUpdate, installUpdate, isNewer } from './plugin-update'
import type { UpdatePorts } from './plugin-update'

const files: Record<string, string> = {
  '/plugin/.claude-plugin/plugin.json': '{"version":"5.5.0"}',
  '/h/.claude/plugins/marketplaces/zeremai/.claude-plugin/plugin.json': '{"version":"5.6.0"}',
}
const ports = (over: Partial<UpdatePorts> = {}): UpdatePorts => ({
  run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  read: async p => {
    if (!(p in files)) throw new Error('missing')
    return files[p]
  },
  home: async () => '/h',
  pluginRoot: '/plugin',
  ...over,
})

test('versions compare by number, not by text', () => {
  expect(isNewer('5.10.0', '5.9.0')).toBe(true)
  expect(isNewer('5.5.0', '5.5.0')).toBe(false)
  expect(isNewer('5.4.9', '5.5.0')).toBe(false)
})
test('a newer version in the fresh copy is an update', async () => {
  expect(await findUpdate(ports())).toEqual({ current: '5.5.0', latest: '5.6.0', state: 'available' })
})
test('a failed refresh or a missing file gives no update, and no error', async () => {
  expect(await findUpdate(ports({ run: async () => ({ exitCode: 1, stdout: '', stderr: 'offline' }) }))).toBeUndefined()
  expect(await findUpdate(ports({ read: async () => { throw new Error('x') } }))).toBeUndefined()
})
test('a good install says restart, a bad one says why', async () => {
  const rec = { current: '5.5.0', latest: '5.6.0', state: 'updating' as const }
  expect((await installUpdate(ports(), rec)).state).toBe('restart')
  const bad = await installUpdate(ports({ run: async () => ({ exitCode: 1, stdout: '', stderr: 'no route\nmore' }) }), rec)
  expect(bad).toMatchObject({ state: 'failed', error: 'no route' })
})
