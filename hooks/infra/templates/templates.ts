import type { FileSystem, FileWriter } from '../ports/ports'
import { slash } from '../flow-manager/move'
import { hashOf } from '../live-site/live-site'

// Template marketplaces: git repositories cached under `cache/sources/<name>`. The user installs templates from
// a cache into `templates/flows/<category>/<name>`. The files and their shapes are the ones the Python manager wrote.

export type TemplatePorts = {
  files: FileSystem
  write: FileWriter
  now(): string
  pluginRoot: string
  windows: boolean
  run(argv: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>
}
export type CatalogEntry = {
  marketplace: string; category: string; name: string; title: string; description: string
  state: 'installed' | 'update' | 'available'
  edited?: true // the installed folder differs from the copy that was installed
}

type Marketplace = { name: string; url: string; branch: string; enabled: boolean; priority: number; lastSynced?: string }
type Config = { marketplaces: Marketplace[]; settings?: Record<string, unknown> }
type Manifest = { templates: { name: string; category: string; type: string; marketplace: string; installedAt: string; version: string; baseHash?: string }[]; lastUpdated?: string }

const rootOf = async (ports: TemplatePorts) => {
  const home = await ports.files.home()
  if (!home) throw new Error('No home folder found')
  return `${slash(home)}/.claude/zeremai`
}
// A short code of every file in a folder: it changes when a file is added, removed or edited.
export async function fingerprintOf(ports: TemplatePorts, dir: string): Promise<string> {
  const parts: string[] = []
  const walk = async (path: string, rel: string): Promise<void> => {
    for (const e of (await ports.files.list(path).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '__pycache__' || e.name === '.git') continue
      const at = rel ? `${rel}/${e.name}` : e.name
      if (e.kind === 'dir') await walk(`${path}/${e.name}`, at)
      else parts.push(`${at}\0${await ports.files.read(`${path}/${e.name}`).catch(() => '')}`)
    }
  }
  await walk(dir, '')
  return hashOf(parts.join('\0'))
}

const readJson = async <T>(ports: TemplatePorts, path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await ports.files.read(path)) } catch { return fallback }
}
const writeJson = (ports: TemplatePorts, path: string, data: unknown) => ports.write(path, JSON.stringify(data, null, 2) + '\n')
const list = (ports: TemplatePorts, path: string) => ports.files.list(path).catch(() => [])

async function git(ports: TemplatePorts, args: string[]): Promise<string> {
  const run = await ports.run(['git', ...args])
  if (run.exitCode !== 0) throw new Error((run.stderr || run.stdout).trim() || `git ${args[0]} failed`)
  return run.stdout.trim()
}
const headOf = (ports: TemplatePorts, cache: string) => git(ports, ['-C', cache, 'rev-parse', 'HEAD']).catch(() => 'unknown')

// The config is seeded from the file the plugin ships, as the script did.
async function loadConfig(ports: TemplatePorts, root: string): Promise<Config> {
  const path = `${root}/config/marketplaces.json`
  if (await ports.files.exists(path)) return readJson(ports, path, { marketplaces: [] })
  const config = await readJson<Config>(ports, `${ports.pluginRoot}/config/marketplaces.default.json`, { marketplaces: [] })
  await writeJson(ports, path, config)
  return config
}
const loadManifest = (ports: TemplatePorts, root: string) => readJson<Manifest>(ports, `${root}/config/installed-templates.json`, { templates: [] })
const saveManifest = (ports: TemplatePorts, root: string, manifest: Manifest) =>
  writeJson(ports, `${root}/config/installed-templates.json`, { ...manifest, lastUpdated: ports.now() })

// Clone or pull every enabled marketplace. A failed pull keeps the old cache. Returns one line for each marketplace.
export async function refreshMarketplaces(ports: TemplatePorts): Promise<string[]> {
  const root = await rootOf(ports)
  const config = await loadConfig(ports, root)
  const lines: string[] = []
  for (const m of config.marketplaces.filter(m => m.enabled).sort((a, b) => a.priority - b.priority)) {
    const cache = `${root}/cache/sources/${m.name}`
    const cached = await ports.files.exists(cache)
    try {
      await (cached ? git(ports, ['-C', cache, 'pull']) : git(ports, ['clone', '--depth', '1', '--branch', m.branch, '--', m.url, cache]))
      m.lastSynced = ports.now()
      lines.push(`${m.name}: ${cached ? 'updated' : 'cloned'}`)
    } catch (error) {
      lines.push(`${m.name}: ${cached ? 'update failed, kept the old copy' : 'clone failed'} (${error instanceof Error ? error.message : error})`)
    }
  }
  await writeJson(ports, `${root}/config/marketplaces.json`, config)
  return lines
}

// Every template of every cached marketplace, with its state. A template is the same one by category and name.
export async function catalog(ports: TemplatePorts): Promise<CatalogEntry[]> {
  const root = await rootOf(ports)
  const config = await loadConfig(ports, root)
  const manifest = await loadManifest(ports, root)
  const entries: CatalogEntry[] = []
  let backfilled = false
  for (const m of config.marketplaces.filter(m => m.enabled).sort((a, b) => a.priority - b.priority)) {
    const cache = `${root}/cache/sources/${m.name}`
    if (!(await ports.files.exists(cache))) continue
    const head = await headOf(ports, cache)
    const base = `${cache}/templates/flows`
    for (const category of (await list(ports, base)).filter(e => e.kind === 'dir' && !e.name.startsWith('_'))) {
      for (const dir of (await list(ports, `${base}/${category.name}`)).filter(e => e.kind === 'dir')) {
        const meta = (await readJson<any>(ports, `${base}/${category.name}/${dir.name}/${dir.name}.json`, {})).metadata ?? {}
        const installed = manifest.templates.find(t => t.name === dir.name && t.category === category.name && t.marketplace === m.name)
        // ponytail: a template installed before baseHash existed counts as unchanged; its folder becomes the base now.
        let edited = false
        if (installed) {
          const now = await fingerprintOf(ports, `${root}/templates/flows/${category.name}/${dir.name}`)
          if (!installed.baseHash) { installed.baseHash = now; backfilled = true } else edited = installed.baseHash !== now
        }
        entries.push({
          marketplace: m.name, category: category.name, name: dir.name, title: meta.title ?? dir.name, description: meta.purposeAndUsage ?? '',
          state: !installed ? 'available' : installed.version !== head && head !== 'unknown' ? 'update' : 'installed',
          ...(edited ? { edited: true as const } : {}),
        })
      }
    }
  }
  if (backfilled) await saveManifest(ports, root, manifest)
  return entries
}

// A name from the pane or the catalog becomes part of a path that is deleted: only plain names pass.
const plain = (part: string) => { if (!/^[\w.-]+$/.test(part) || part === '..' || part === '.') throw new Error(`Not a plain name: ${part}`); return part }

const quote = (path: string) => `'${path.replace(/'/g, "''")}'`
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
const copyArgv = (windows: boolean, from: string, to: string): string[][] => windows
  ? [['powershell', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Force -Path ${quote(parentOf(to))} | Out-Null; Copy-Item -LiteralPath ${quote(from)} -Destination ${quote(to)} -Recurse -Force`]]
  : [['mkdir', '-p', parentOf(to)], ['cp', '-R', from, to]]
const removeArgv = (windows: boolean, path: string): string[][] => windows
  ? [['powershell', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Remove-Item -LiteralPath ${quote(path)} -Recurse -Force -ErrorAction SilentlyContinue`]]
  : [['rm', '-rf', path]]
const renameArgv = (windows: boolean, from: string, to: string): string[][] => windows
  ? [['powershell', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Move-Item -LiteralPath ${quote(from)} -Destination ${quote(to)}`]]
  : [['mv', from, to]]
async function runAll(ports: TemplatePorts, argvs: string[][]) {
  for (const argv of argvs) {
    const run = await ports.run(argv)
    if (run.exitCode !== 0) throw new Error(`${argv[0]} failed: ${(run.stderr || run.stdout).trim()}`)
  }
}

export async function installTemplate(ports: TemplatePorts, entry: { marketplace: string; category: string; name: string }): Promise<void> {
  const root = await rootOf(ports)
  const category = plain(entry.category), name = plain(entry.name)
  const cache = `${root}/cache/sources/${plain(entry.marketplace)}`
  const from = `${cache}/templates/flows/${category}/${name}`
  if (!(await ports.files.exists(from))) throw new Error(`Template ${category}/${name} is not in the cache of ${entry.marketplace}. Refresh first.`)
  const to = `${root}/templates/flows/${category}/${name}`
  const baseHash = await fingerprintOf(ports, from) // the folder as it is copied: a later difference is the user's edit
  await runAll(ports, [...removeArgv(ports.windows, to), ...copyArgv(ports.windows, from, to)])
  const manifest = await loadManifest(ports, root)
  manifest.templates = [
    ...manifest.templates.filter(t => !(t.name === name && t.category === category)),
    { name, category, type: 'flow', marketplace: entry.marketplace, installedAt: ports.now(), version: await headOf(ports, cache), baseHash },
  ]
  await saveManifest(ports, root, manifest)
}

// Match on category and name: two templates with one name in two categories no longer clash.
export async function removeTemplate(ports: TemplatePorts, entry: { category: string; name: string }): Promise<void> {
  const root = await rootOf(ports)
  const category = plain(entry.category), name = plain(entry.name)
  await runAll(ports, removeArgv(ports.windows, `${root}/templates/flows/${category}/${name}`))
  const manifest = await loadManifest(ports, root)
  manifest.templates = manifest.templates.filter(t => !(t.name === name && t.category === category))
  await saveManifest(ports, root, manifest)
}

// ── The marketplaces themselves ─────────────────────────────────────────────

export type MarketplaceInfo = Marketplace & { cached: boolean }
export type MarketplaceFields = { name: string; url: string; branch: string; priority: string }

export async function listMarketplaces(ports: TemplatePorts): Promise<MarketplaceInfo[]> {
  const root = await rootOf(ports)
  const config = await loadConfig(ports, root)
  const found: MarketplaceInfo[] = []
  for (const m of [...config.marketplaces].sort((a, b) => a.priority - b.priority)) {
    found.push({ ...m, cached: await ports.files.exists(`${root}/cache/sources/${m.name}`) })
  }
  return found
}

// What a git address can look like. This checks the shape only: no network call.
const ADDRESS = /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|git@[\w.-]+:|[/~.]|[A-Za-z]:[\\/])/
// The address and the branch go to `git clone`: a leading "-" would be read as an option.
function checked(f: Partial<MarketplaceFields>): void {
  if (f.name !== undefined) plain(f.name)
  if (f.url !== undefined && (!f.url.trim() || f.url.startsWith('-'))) throw new Error('Give a git address that does not start with "-"')
  if (f.url !== undefined && !ADDRESS.test(f.url.trim())) throw new Error('A git address starts with https://, ssh://, git@host: or is a local path')
  if (f.branch && !/^[\w][\w./-]*$/.test(f.branch)) throw new Error('Not a branch name: ' + f.branch)
  if (f.priority && !/^\d+$/.test(f.priority)) throw new Error('Priority is a whole number')
}
const changeConfig = async (ports: TemplatePorts, change: (config: Config, root: string) => Promise<void> | void) => {
  const root = await rootOf(ports)
  const config = await loadConfig(ports, root)
  await change(config, root)
  await writeJson(ports, `${root}/config/marketplaces.json`, config)
}
const find = (config: Config, name: string) => {
  const m = config.marketplaces.find(m => m.name === name)
  if (!m) throw new Error(`Marketplace ${name} not found`)
  return m
}
const dropCache = (ports: TemplatePorts, root: string, name: string) =>
  runAll(ports, removeArgv(ports.windows, `${root}/cache/sources/${plain(name)}`))

export const addMarketplace = (ports: TemplatePorts, f: MarketplaceFields) => changeConfig(ports, config => {
  checked(f)
  if (config.marketplaces.some(m => m.name === f.name)) throw new Error(`Marketplace ${f.name} exists already`)
  config.marketplaces.push({ name: f.name, url: f.url.trim(), branch: f.branch || 'main', enabled: true, priority: f.priority ? Number(f.priority) : 100 })
})

export const toggleMarketplace = (ports: TemplatePorts, name: string) => changeConfig(ports, config => { const m = find(config, name); m.enabled = !m.enabled })

// The cache goes too. Installed templates are copies, so they stay.
export const removeMarketplace = (ports: TemplatePorts, name: string) => changeConfig(ports, async (config, root) => {
  find(config, name)
  await dropCache(ports, root, name)
  config.marketplaces = config.marketplaces.filter(m => m.name !== name)
})

// A new name moves the cache folder. A new address or branch drops the cache: a pull would still read the old remote, so Refresh clones again.
export const updateMarketplace = (ports: TemplatePorts, name: string, f: MarketplaceFields) => changeConfig(ports, async (config, root) => {
  checked(f)
  const m = find(config, name)
  if (f.name !== name && config.marketplaces.some(o => o.name === f.name)) throw new Error(`Marketplace ${f.name} exists already`)
  const remoteChanged = f.url.trim() !== m.url || (f.branch || 'main') !== m.branch
  if (remoteChanged) await dropCache(ports, root, name)
  else if (f.name !== name && await ports.files.exists(`${root}/cache/sources/${name}`)) await runAll(ports, renameArgv(ports.windows, `${root}/cache/sources/${name}`, `${root}/cache/sources/${f.name}`))
  Object.assign(m, { name: f.name, url: f.url.trim(), branch: f.branch || 'main', priority: f.priority ? Number(f.priority) : 100 })
  if (remoteChanged) delete m.lastSynced
})
