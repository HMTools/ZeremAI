import type { FileSystem } from '../ports/ports'
import type { Doc } from '../flow-manager/flow-files'
import { stepKind } from './status-look'
import type { Kind } from './status-look'

// The Memory, Logs and Files views of a bound flow. They read files only: the pane draws what they return.

const readDoc = async (files: FileSystem, path: string): Promise<Doc | undefined> => {
  try { return JSON.parse(await files.read(path)) } catch { /* unreadable: leave it out */ }
}
const list = (files: FileSystem, path: string) => files.list(path).catch(() => [])
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))) : typeof v === 'string' && v ? [v] : [])
const topicName = (t: string) => t.replace(/\.json$/, '')
const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

type Named = { id: string; number: string; name: string }
const stepsOf = (flow: Doc | undefined): (Named & { def: Doc; status?: string })[] =>
  ((flow?.steps ?? []) as Doc[]).map((s, i) => ({ id: s.id ?? String(i + 1), number: String(s.number ?? i + 1), name: s.name ?? s.id ?? `Step ${i + 1}`, def: s.stepDefinition ?? {}, status: s.status }))

// ── Memory ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type MemEntry = { topic: string; step: string; stepName: string; values: [string, string][]; decisions: string[]; files: string[]; notes: string[]; updated: string }
export type MemTopic = { topic: string; entries: MemEntry[]; writtenBy: string[]; readBy: string[] }
export type MemDiff = { topic: string; from: string; to: string; lines: string[] }
export type MemoryView = { topics: MemTopic[]; history: MemEntry[]; diffs: MemDiff[] }

// What each step wrote or read, by topic (Flow and Topics), every entry newest first (History), and what changed from one entry to the next (Diffs).
export async function memoryView(files: FileSystem, dir: string): Promise<MemoryView> {
  const steps = stepsOf(await readDoc(files, `${dir}/flow.json`))
  const byId = new Map(steps.map(s => [s.id, s]))
  const topics: MemTopic[] = []
  for (const file of await list(files, `${dir}/memory`)) {
    if (!file.name.endsWith('.json') || file.name.startsWith('_')) continue
    const topic = topicName(file.name)
    const data = await readDoc(files, `${dir}/memory/${file.name}`)
    const entries: MemEntry[] = Object.entries((data?.entries ?? {}) as Record<string, Doc>).map(([id, e]) => ({
      topic, step: byId.get(id)?.number ?? id, stepName: byId.get(id)?.name ?? id,
      values: Object.entries(e.informationProduced ?? {}).map(([k, v]) => [k, text(v)] as [string, string]),
      decisions: strings(e.decisionsMade), files: strings(e.filesModifiedCreated), notes: strings(e.notes), updated: String(e.updatedAt ?? e.createdAt ?? ''),
    })).sort((a, b) => a.updated.localeCompare(b.updated))
    const uses = (access: 'readFrom' | 'writeTo') => steps.filter(s => strings(s.def.memoryFileUsage?.[access]).map(topicName).includes(topic)).map(s => s.number)
    topics.push({ topic, entries, writtenBy: [...new Set([...entries.map(e => e.step), ...uses('writeTo')])], readBy: uses('readFrom') })
  }
  topics.sort((a, b) => a.topic.localeCompare(b.topic))
  const history = topics.flatMap(t => t.entries).sort((a, b) => b.updated.localeCompare(a.updated))
  const diffs: MemDiff[] = []
  for (const t of topics) {
    for (let i = 1; i < t.entries.length; i++) {
      const before = new Map(t.entries[i - 1].values), after = new Map(t.entries[i].values)
      const lines = [
        ...[...after].filter(([k]) => !before.has(k)).map(([k, v]) => `+ ${k}: ${v}`),
        ...[...before].filter(([k]) => !after.has(k)).map(([k]) => `- ${k}`),
        ...[...after].filter(([k, v]) => before.has(k) && before.get(k) !== v).map(([k, v]) => `~ ${k}: ${before.get(k)} → ${v}`),
      ]
      if (lines.length) diffs.push({ topic: t.topic, from: t.entries[i - 1].step, to: t.entries[i].step, lines })
    }
  }
  return { topics, history, diffs }
}

// ── Logs ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LogRow = Named & { kind: Kind; started?: string; completed?: string; actions: string[]; reasoning: string[]; problems: string[] }

// A time is a string, { startedAt, completedAt } or { started, completed }: older flows use older formats.
export function timesOf(ts: unknown): { started?: string; completed?: string } {
  if (typeof ts === 'string') return { started: ts }
  if (ts && typeof ts === 'object') {
    const o = ts as Record<string, unknown>
    const pick = (a: unknown, b: unknown) => (typeof a === 'string' ? a : typeof b === 'string' ? b : undefined)
    return { started: pick(o.startedAt, o.started), completed: pick(o.completedAt, o.completed) }
  }
  return {}
}

// One row for each step, in flow order.
export async function logView(files: FileSystem, dir: string): Promise<LogRow[]> {
  const steps = stepsOf(await readDoc(files, `${dir}/flow.json`))
  const log = (await readDoc(files, `${dir}/log.json`))?.steps ?? {}
  return steps.map(s => {
    const entry: Doc = log[s.id] ?? {}
    return { id: s.id, number: s.number, name: s.name, kind: stepKind(s.status), ...timesOf(entry.timestamp), actions: strings(entry.actionsTaken), reasoning: strings(entry.agentReasoning), problems: strings(entry.problemsEncountered) }
  })
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type FileRow = { path: string; name: string; output: boolean; step?: string; openable: boolean }

const FRAMEWORK = new Set(['flow.json', 'log.json', 'memory.json', 'pending-interaction.json'])
const absolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

// Files in the flow folder (framework files apart) and the files the steps say they changed. Each knows its step.
export async function filesView(files: FileSystem, dir: string): Promise<FileRow[]> {
  const steps = stepsOf(await readDoc(files, `${dir}/flow.json`))
  const byId = new Map(steps.map(s => [s.id, s.number]))
  const touched = new Map<string, string>() // resolved path → step number
  const note = (path: string, stepId: string) => { const full = absolute(path) ? path : `${dir}/${path}`; if (!touched.has(full)) touched.set(full, byId.get(stepId) ?? stepId) }
  for (const [id, entry] of Object.entries(((await readDoc(files, `${dir}/log.json`))?.steps ?? {}) as Record<string, Doc>)) strings(entry.filesModified).forEach(p => note(p, id))
  for (const file of await list(files, `${dir}/memory`)) {
    const data = await readDoc(files, `${dir}/memory/${file.name}`)
    for (const [id, entry] of Object.entries((data?.entries ?? {}) as Record<string, Doc>)) strings(entry.filesModifiedCreated).forEach(p => note(p, id))
  }
  const rows = new Map<string, FileRow>()
  const walk = async (path: string, depth: number) => {
    for (const e of await list(files, path)) {
      const full = `${path}/${e.name}`
      const rel = full.slice(dir.length + 1)
      if (e.kind === 'dir') { if (depth < 3) await walk(full, depth + 1); continue }
      const framework = FRAMEWORK.has(rel) || rel.startsWith('memory/')
      rows.set(full, { path: full, name: rel, output: !framework, ...(touched.has(full) ? { step: touched.get(full) } : {}), openable: true })
    }
  }
  await walk(dir, 0)
  for (const [full, step] of touched) if (!rows.has(full)) rows.set(full, { path: full, name: full.startsWith(`${dir}/`) ? full.slice(dir.length + 1) : full, output: true, step, openable: await files.exists(full) })
  return [...rows.values()].sort((a, b) => Number(b.output) - Number(a.output) || a.name.localeCompare(b.name))
}

// The numbers on the Memory and Files tabs, from folder listings only: no file is read. The Files number is approximate: it counts the files in the
// flow folder (framework files apart) and leaves out the files that only the log or memory name.
export async function tabCounts(files: FileSystem, dir: string): Promise<{ topics: number; files: number }> {
  const topics = (await list(files, `${dir}/memory`)).filter(f => f.name.endsWith('.json') && !f.name.startsWith('_')).length
  let found = 0
  const walk = async (path: string, depth: number) => {
    for (const e of await list(files, path)) {
      const rel = `${path}/${e.name}`.slice(dir.length + 1)
      if (e.kind === 'dir') { if (depth < 3 && rel !== 'memory') await walk(`${path}/${e.name}`, depth + 1) } else if (!FRAMEWORK.has(rel)) found++
    }
  }
  await walk(dir, 0)
  return { topics, files: found }
}
