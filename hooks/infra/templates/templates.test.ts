import { test, expect } from 'claude-code/testing'
import { world } from '../flow-manager/fake-world'
import { addMarketplace, catalog, fingerprintOf, installTemplate, listMarketplaces, refreshMarketplaces, removeMarketplace, removeTemplate, toggleMarketplace, updateMarketplace } from './templates'
import type { TemplatePorts } from './templates'

const ROOT = '/h/.claude/zeremai'
const CACHE = `${ROOT}/cache/sources/official`
const CONFIG = { marketplaces: [{ name: 'official', url: 'https://x/t.git', branch: 'main', enabled: true, priority: 100 }], settings: {} }
const cacheFiles = {
  [`${CACHE}/templates/flows/dev/fix/fix.json`]: { metadata: { title: 'Fix a bug', purposeAndUsage: 'Fixes bugs' } },
  [`${CACHE}/templates/flows/dev/plan/plan.json`]: { metadata: { title: 'Plan' } },
  [`${CACHE}/templates/flows/_hidden/x/x.json`]: {},
}
const setup = (extra: Record<string, unknown> = {}, { windows = false, fail = '' } = {}) => {
  const w = world({ [`${ROOT}/config/marketplaces.json`]: CONFIG, ...extra })
  const calls: string[][] = []
  const ports: TemplatePorts = {
    files: w.ports.files,
    write: w.ports.write,
    now: w.ports.now,
    pluginRoot: '/plugin',
    windows,
    run: async argv => {
      calls.push(argv)
      if (fail && argv[0] === fail) return { exitCode: 1, stdout: '', stderr: 'boom' }
      return { exitCode: 0, stdout: argv.includes('rev-parse') ? 'abc123\n' : '', stderr: '' }
    },
  }
  return { w, ports, calls }
}

test('catalog: available, installed, update; hidden folders are skipped', async () => {
  const { ports } = setup({
    ...cacheFiles,
    [`${ROOT}/config/installed-templates.json`]: {
      templates: [
        { name: 'fix', category: 'dev', type: 'flow', marketplace: 'official', installedAt: 't', version: 'old' },
        { name: 'plan', category: 'dev', type: 'flow', marketplace: 'official', installedAt: 't', version: 'abc123' },
      ],
    },
  })
  const entries = await catalog(ports)
  expect(entries.map(e => [e.category, e.name, e.state])).toEqual([
    ['dev', 'fix', 'update'],
    ['dev', 'plan', 'installed'],
  ])
  expect(entries[0]).toMatchObject({ title: 'Fix a bug', description: 'Fixes bugs' })
})
test('catalog: a marketplace with no cache is skipped; the config is seeded from the plugin default', async () => {
  const w = world({ '/plugin/config/marketplaces.default.json': CONFIG })
  const ports: TemplatePorts = { files: w.ports.files, write: w.ports.write, now: w.ports.now, pluginRoot: '/plugin', windows: false, run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }
  expect(await catalog(ports)).toEqual([])
  expect(w.json(`${ROOT}/config/marketplaces.json`).marketplaces[0].name).toBe('official')
})
test('refresh: clone when there is no cache, pull when there is, keep the old copy when a pull fails', async () => {
  const first = setup()
  expect(await refreshMarketplaces(first.ports)).toEqual(['official: cloned'])
  expect(first.calls[0]).toEqual(['git', 'clone', '--depth', '1', '--branch', 'main', '--', 'https://x/t.git', CACHE])
  expect(first.w.json(`${ROOT}/config/marketplaces.json`).marketplaces[0].lastSynced).toBeTruthy()
  const again = setup(cacheFiles)
  expect(await refreshMarketplaces(again.ports)).toEqual(['official: updated'])
  expect(again.calls[0]).toEqual(['git', '-C', CACHE, 'pull'])
  const broken = setup(cacheFiles, { fail: 'git' })
  expect((await refreshMarketplaces(broken.ports))[0]).toBe('official: update failed, kept the old copy (boom)')
})
test('install: replaces the folder, copies, and records the git hash', async () => {
  const { ports, calls, w } = setup(cacheFiles)
  await installTemplate(ports, { marketplace: 'official', category: 'dev', name: 'fix' })
  const to = `${ROOT}/templates/flows/dev/fix`
  expect(calls.slice(0, 3)).toEqual([
    ['rm', '-rf', to],
    ['mkdir', '-p', `${ROOT}/templates/flows/dev`],
    ['cp', '-R', `${CACHE}/templates/flows/dev/fix`, to],
  ])
  expect(w.json(`${ROOT}/config/installed-templates.json`).templates).toMatchObject([{ name: 'fix', category: 'dev', type: 'flow', marketplace: 'official', version: 'abc123' }])
})
test('install on Windows uses one PowerShell command each', async () => {
  const { ports, calls } = setup(cacheFiles, { windows: true })
  await installTemplate(ports, { marketplace: 'official', category: 'dev', name: 'fix' })
  expect(calls[0][0]).toBe('powershell')
  expect(calls[0][4]).toContain('Remove-Item')
  expect(calls[1][4]).toContain('Copy-Item')
})
test('install: a template that is not in the cache, a bad name and a failed copy are errors', async () => {
  const { ports } = setup(cacheFiles)
  await expect(installTemplate(ports, { marketplace: 'official', category: 'dev', name: 'nope' })).rejects.toThrow('Refresh first')
  await expect(installTemplate(ports, { marketplace: 'official', category: '..', name: 'fix' })).rejects.toThrow('Not a plain name')
  await expect(removeTemplate(ports, { category: 'dev', name: 'a/b' })).rejects.toThrow('Not a plain name')
  const broken = setup(cacheFiles, { fail: 'cp' })
  await expect(installTemplate(broken.ports, { marketplace: 'official', category: 'dev', name: 'fix' })).rejects.toThrow('cp failed: boom')
})
test('remove: deletes the folder and the manifest entry of that category only', async () => {
  const entry = (category: string) => ({ name: 'fix', category, type: 'flow', marketplace: 'official', installedAt: 't', version: 'v' })
  const { ports, calls, w } = setup({ [`${ROOT}/config/installed-templates.json`]: { templates: [entry('dev'), entry('ops')] } })
  await removeTemplate(ports, { category: 'dev', name: 'fix' })
  expect(calls).toEqual([['rm', '-rf', `${ROOT}/templates/flows/dev/fix`]])
  expect(w.json(`${ROOT}/config/installed-templates.json`).templates.map((t: any) => t.category)).toEqual(['ops'])
})

const FIELDS = { name: 'team', url: 'https://x/team.git', branch: '', priority: '' }
const configOf = (w: ReturnType<typeof setup>['w']) => w.json(`${ROOT}/config/marketplaces.json`).marketplaces
test('add: defaults, and a duplicate name, a bad name, a dash address and a bad priority are refused', async () => {
  const { ports, w } = setup()
  await addMarketplace(ports, FIELDS)
  expect(configOf(w)[1]).toEqual({ name: 'team', url: 'https://x/team.git', branch: 'main', enabled: true, priority: 100 })
  await expect(addMarketplace(ports, FIELDS)).rejects.toThrow('exists already')
  await expect(addMarketplace(ports, { ...FIELDS, name: '../x' })).rejects.toThrow('Not a plain name')
  await expect(addMarketplace(ports, { ...FIELDS, name: 'a', url: '--upload-pack=x' })).rejects.toThrow('does not start with "-"')
  await expect(addMarketplace(ports, { ...FIELDS, name: 'a', priority: 'x' })).rejects.toThrow('whole number')
  await expect(addMarketplace(ports, { ...FIELDS, name: 'a', url: 'team.git' })).rejects.toThrow('starts with https://')
  for (const url of ['https://x/t.git', 'ssh://h/t.git', 'git@github.com:o/t.git', '/srv/t', './t', 'C:\\t'])
    await addMarketplace(ports, { ...FIELDS, name: `ok-${url.length}-${url.charCodeAt(0)}`, url })
})
test('toggle flips enabled; list shows the cache', async () => {
  const { ports, w } = setup(cacheFiles)
  await toggleMarketplace(ports, 'official')
  expect(configOf(w)[0].enabled).toBe(false)
  expect((await listMarketplaces(ports))[0]).toMatchObject({ name: 'official', enabled: false, cached: true })
  await expect(toggleMarketplace(ports, 'nope')).rejects.toThrow('not found')
})
test('remove: the cache and the line go; installed templates are not touched', async () => {
  const { ports, w, calls } = setup(cacheFiles)
  await removeMarketplace(ports, 'official')
  expect(calls).toEqual([['rm', '-rf', CACHE]])
  expect(configOf(w)).toEqual([])
})
test('update: a new name moves the cache; a new address drops it', async () => {
  const renamed = setup(cacheFiles)
  await updateMarketplace(renamed.ports, 'official', { name: 'main', url: 'https://x/t.git', branch: 'main', priority: '5' })
  expect(renamed.calls).toEqual([['mv', CACHE, `${ROOT}/cache/sources/main`]])
  expect(configOf(renamed.w)[0]).toMatchObject({ name: 'main', priority: 5 })
  const moved = setup(cacheFiles)
  await updateMarketplace(moved.ports, 'official', { name: 'official', url: 'https://x/other.git', branch: 'dev', priority: '100' })
  expect(moved.calls).toEqual([['rm', '-rf', CACHE]])
  expect(configOf(moved.w)[0]).toMatchObject({ url: 'https://x/other.git', branch: 'dev' })
  await expect(updateMarketplace(setup().ports, 'official', { ...FIELDS, name: 'official', branch: '-x' })).rejects.toThrow('Not a branch name')
})

test('edited: install saves a base code; a changed file shows as edited; a manifest with no code is filled in, not edited', async () => {
  const fixed = { [`${CACHE}/templates/flows/dev/fix/fix.json`]: { metadata: { title: 'Fix' } }, [`${CACHE}/templates/flows/dev/fix/step/step.json`]: { a: 1 } }
  const { ports, w } = setup(fixed)
  await installTemplate(ports, { marketplace: 'official', category: 'dev', name: 'fix' })
  const base = w.json(`${ROOT}/config/installed-templates.json`).templates[0].baseHash
  expect(base).toBe(await fingerprintOf(ports, `${CACHE}/templates/flows/dev/fix`))
  const mine = `${ROOT}/templates/flows/dev/fix`
  await w.ports.write(`${mine}/fix.json`, JSON.stringify({ metadata: { title: 'Fix' } })) // the copy the user has (the fake shell does not copy)
  await w.ports.write(`${mine}/step/step.json`, JSON.stringify({ a: 1 }))
  expect((await catalog(ports))[0].edited).toBeUndefined()
  await w.ports.write(`${mine}/step/step.json`, JSON.stringify({ a: 2 }))
  expect((await catalog(ports))[0]).toMatchObject({ edited: true })
  const old = setup({
    ...fixed,
    [`${ROOT}/config/installed-templates.json`]: { templates: [{ name: 'fix', category: 'dev', type: 'flow', marketplace: 'official', installedAt: 't', version: 'abc123' }] },
    [`${mine}/fix.json`]: {},
  })
  expect((await catalog(old.ports))[0].edited).toBeUndefined()
  expect(old.w.json(`${ROOT}/config/installed-templates.json`).templates[0].baseHash).toBeTruthy()
})
