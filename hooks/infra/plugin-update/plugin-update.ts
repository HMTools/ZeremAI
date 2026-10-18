// A new version of this plugin: find it, say so once, install it. The mod asks Claude Code to refresh the marketplace, then reads the
// version in the fresh copy: private repositories work, because Claude Code already has the access. Every failure is quiet: it never touches a flow.

export type UpdateState = 'available' | 'updating' | 'restart' | 'failed'
export type UpdateRecord = { current: string; latest: string; state: UpdateState | 'current'; error?: string } // 'current': nothing to show
export type UpdatePorts = {
  run(argv: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>
  read(path: string): Promise<string>
  home(): Promise<string | undefined>
  pluginRoot: string
}

const PLUGIN = 'zeremai@zeremai'

// ponytail: plain numbers only (1.2.3); a pre-release tag counts as its base version
const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0)
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

export const versionIn = async (ports: UpdatePorts, path: string): Promise<string | undefined> => {
  try {
    const v = JSON.parse(await ports.read(path)).version
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

// The newest version when it is newer than the one that runs, else undefined. Any failure gives undefined.
export async function findUpdate(ports: UpdatePorts): Promise<UpdateRecord | undefined> {
  try {
    const run = await ports.run(['claude', 'plugin', 'marketplace', 'update', 'zeremai'])
    const home = await ports.home()
    if (run.exitCode !== 0 || !home) return undefined
    const current = await runningVersion(ports)
    const latest = await versionIn(ports, `${home}/.claude/plugins/marketplaces/zeremai/.claude-plugin/plugin.json`)
    return current && latest && isNewer(latest, current) ? { current, latest, state: 'available' } : undefined
  } catch {
    return undefined
  }
}

export const runningVersion = (ports: UpdatePorts) => versionIn(ports, `${ports.pluginRoot}/.claude-plugin/plugin.json`)

// Claude Code installs the files. The session that is open keeps the old code, so the state after a good run is `restart`.
export async function installUpdate(ports: UpdatePorts, record: UpdateRecord): Promise<UpdateRecord> {
  try {
    const run = await ports.run(['claude', 'plugin', 'update', PLUGIN])
    if (run.exitCode === 0) return { ...record, state: 'restart' }
    return { ...record, state: 'failed', error: (run.stderr || run.stdout).trim().split('\n')[0].slice(0, 200) || 'Claude Code could not update the plugin.' }
  } catch (error) {
    return { ...record, state: 'failed', error: (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 200) }
  }
}
