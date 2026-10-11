import type { ManagerPorts } from '../ports/ports'

// Shared by every flow tool: the answer shape, a lock for each flow folder, and reading and writing JSON.

export type Doc = Record<string, any> // a flow, log or memory file: plain JSON, so fields the tools do not know survive a write
export type Result = Record<string, any> & { status: 'ok' | 'error' }

export class ToolError extends Error {}
export const fail = (message: string): never => { throw new ToolError(message) }
export const ok = (...files: string[]): Result => ({ status: 'ok', files_written: files })

export const STEP_STATUSES = ['pending', 'in_progress', 'completed', 'skipped', 'awaiting_approval']
export const FLOW_STATUSES = ['running', 'completed', 'failed', 'paused']

export async function readJson(ports: ManagerPorts, path: string): Promise<Doc> {
  return JSON.parse(await ports.files.read(path))
}
export const writeJson = (ports: ManagerPorts, path: string, data: unknown): Promise<void> =>
  ports.write(path, JSON.stringify(data, null, 2) + '\n')

// One change at a time for each flow folder: a second call waits, then reads the file the first one wrote.
// ponytail: a lock in this mod only. A second session that writes the same folder is not seen; the last write wins, as with the script.
const tails = new Map<string, Promise<unknown>>()
export function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(work)
  tails.set(key, run)
  run.catch(() => {}).finally(() => { if (tails.get(key) === run) tails.delete(key) })
  return run
}

export async function readFlow(ports: ManagerPorts, dir: string): Promise<Doc> {
  const path = `${dir}/flow.json`
  if (!(await ports.files.exists(path))) fail(`flow.json not found in ${dir}`)
  return readJson(ports, path)
}
export async function readLog(ports: ManagerPorts, dir: string): Promise<Doc> {
  const path = `${dir}/log.json`
  if (!(await ports.files.exists(path))) fail(`log.json not found in ${dir}`)
  return readJson(ports, path)
}

export const stepName = (flow: Doc, stepId: string): string => flow.steps?.find((s: Doc) => s.id === stepId)?.name ?? ''
