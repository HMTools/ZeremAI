import type { FileSystem } from '../ports/ports'
import type { Doc } from '../flow-manager/flow-files'
import { flowKind, listFlows } from '../flow-pane/flow-pane'
import { filesView, logView, memoryView, tabCounts } from '../flow-pane/flow-views'
import { stepKind } from '../flow-pane/status-look'

// The live page reads one database. The mod writes it here: `flows/<id>` (the state), `details/<id>~logs|memory|files` (owner only),
// `meta/mod` (the heartbeat). Only the documents that changed since the last push are written.

export type DocWrite = { op: 'set'; collection: string; doc_id: string; data: Doc }
export type LivePorts = {
  files: FileSystem
  batch(writes: DocWrite[]): Promise<void> // one ArtifactData call; rejects on failure
  now(): string
}

const CAP = 2000 // ponytail: a string longer than this is cut; the page links nothing deeper, add paging if a reader needs whole texts
const MAX_ROWS = 200 // ponytail: one cap for every list so a document stays far under 256 KiB; raise it with per-flow paging if needed
const BATCH = 50 // ArtifactData takes 1 to 50 writes in one batch

const cut = (v: unknown): unknown => {
  if (typeof v === 'string') return v.length > CAP ? `${v.slice(0, CAP)}…` : v
  if (Array.isArray(v)) return v.slice(0, MAX_ROWS).map(cut)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x)]))
  return v
}
const readDoc = async (files: FileSystem, path: string): Promise<Doc | undefined> => {
  try { return JSON.parse(await files.read(path)) } catch { /* unreadable: leave it out */ }
}
const isDone = (s: Doc) => s.status === 'completed' || s.status === 'skipped'

// What the page draws for one flow: the same facts the terminal pane reads (flowKind, stepKind), as one document.
export function flowDoc(flow: Doc, counts: { topics: number; files: number }): Doc {
  const steps: Doc[] = flow.steps ?? []
  const next = steps.find(s => !isDone(s))
  const waiting = steps.find(s => s.status === 'awaiting_approval')
  const children: Doc[] = flow.subFlowState?.childFlows ?? []
  const parentId = flow.subFlowState?.parentFlow?.id
  return cut({
    name: flow.name ?? '',
    template: flow.metadata?.template ?? '',
    status: flowKind(flow),
    activeStepId: flow.currentState?.activeStep?.id ?? next?.id ?? '',
    ...(waiting ? { needsYou: { stepId: waiting.id, stepNumber: Number(waiting.number ?? 0), stepName: waiting.name ?? '', waitsFor: waiting.stepDefinition?.output?.description || 'Your approval', since: flow.metadata?.lastUpdated ?? '' } } : {}), // ponytail: "since" is the last change of the flow, the files do not record when the wait began
    updatedAt: flow.metadata?.lastUpdated ?? '',
    ...(parentId ? { parentFlowId: parentId } : {}),
    counts,
    steps: steps.map((s, i) => {
      const child = children.find(c => c.spawnedAtStep === s.id || c.spawnedAtStep === Number(s.number))
      const summary = s.stepDefinition?.output?.description
      return {
        id: s.id ?? String(i + 1), number: Number(s.number ?? i + 1), name: s.name ?? s.id ?? `Step ${i + 1}`,
        ...(s.phase ? { phase: s.phase } : {}), status: stepKind(s.status), approval: s.approvalRequired === true,
        ...(s.loopBackTo ? { loopBackTo: s.loopBackTo } : {}), ...(child ? { childFlowId: child.id } : {}), ...(summary ? { summary } : {}),
      }
    }),
  }) as Doc
}

// Every document of one flow. Null when the flow file is unreadable.
export async function snapshot(files: FileSystem, dir: string): Promise<{ flowId: string; docs: Record<string, DocWrite> } | undefined> {
  const flow = await readDoc(files, `${dir}/flow.json`)
  if (!flow) return
  const flowId = String(flow.id ?? dir.split('/').pop())
  const [logs, memory, rows, counts] = await Promise.all([logView(files, dir), memoryView(files, dir), filesView(files, dir), tabCounts(files, dir)])
  const put = (collection: string, doc_id: string, data: unknown): [string, DocWrite] => [`${collection}/${doc_id}`, { op: 'set', collection, doc_id, data: cut(data) as Doc }]
  return {
    flowId,
    docs: Object.fromEntries([
      put('flows', flowId, flowDoc(flow, counts)),
      put('details', `${flowId}~logs`, { rows: logs }),
      put('details', `${flowId}~memory`, { topics: memory.topics, diffs: memory.diffs }),
      put('details', `${flowId}~files`, { rows }),
    ]),
  }
}

// The documents whose text differs from the last push. `last` keeps that text for each path.
export const changed = (last: Map<string, string>, docs: Record<string, DocWrite>): DocWrite[] =>
  Object.entries(docs).filter(([path, w]) => last.get(path) !== JSON.stringify(w.data)).map(([, w]) => w)

// Read every active flow and write what changed, in batches of 50. A batch that fails leaves `last` as it was, so the next push tries it again.
export async function pushFlows(ports: LivePorts, last: Map<string, string>): Promise<number> {
  const writes: DocWrite[] = []
  for (const info of await listFlows(ports.files)) {
    const snap = await snapshot(ports.files, info.dir)
    if (snap) writes.push(...changed(last, snap.docs))
  }
  for (let i = 0; i < writes.length; i += BATCH) {
    const part = writes.slice(i, i + BATCH)
    await ports.batch(part)
    for (const w of part) last.set(`${w.collection}/${w.doc_id}`, JSON.stringify(w.data))
  }
  return writes.length
}

export const heartbeat = (ports: LivePorts): Promise<void> => ports.batch([{ op: 'set', collection: 'meta', doc_id: 'mod', data: { beat: ports.now(), v: 1 } }])

// The rules the page declares when it is published.
export const PAGE_CAPABILITIES = { db: { rules: [{ path: '', read: 'view', write: 'owner' }, { path: 'details', read: 'owner', write: 'owner' }] }, user: {} }
