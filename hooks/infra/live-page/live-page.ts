import type { FileSystem, FileWriter } from '../ports/ports'
import type { Doc } from '../flow-manager/flow-files'
import { flowKind, listFlows } from '../flow-pane/flow-pane'
import { filesView, logView, memoryView, tabCounts } from '../flow-pane/flow-views'
import { stepKind } from '../flow-pane/status-look'
import { routesOf } from '../approval-gate/approval-gate'
import type { Step } from '../flow-types/flow-types'

// The live page reads one database. The mod writes it here: `flows/<id>` (the state), `details/<id>~logs|memory|files` (owner only),
// `meta/mod` (the heartbeat). Only the documents that changed since the last push are written.

export type SetWrite = { op: 'set'; collection: string; doc_id: string; data: Doc }
export type DocWrite = SetWrite | { op: 'delete'; collection: string; doc_id: string }
export type LivePorts = {
  files: FileSystem
  batch(writes: DocWrite[]): Promise<void> // one ArtifactData call; rejects on failure
  now(): string
  activity?(dir: string): Activity | undefined // the last tool call of the agent that runs this flow
}
export type Activity = { text: string; at: string }

const CAP = 2000 // ponytail: a string longer than this is cut; the page links nothing deeper, add paging if a reader needs whole texts
const MAX_ROWS = 200 // ponytail: one cap for every list so a document stays far under 256 KiB; raise it with per-flow paging if needed
const BATCH = 50 // ArtifactData takes 1 to 50 writes in one batch

export const cut = (v: unknown): unknown => {
  if (typeof v === 'string') return v.length > CAP ? `${v.slice(0, CAP)}…` : v
  if (Array.isArray(v)) return v.slice(0, MAX_ROWS).map(cut)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x)]))
  return v
}
const readDoc = async (files: FileSystem, path: string): Promise<Doc | undefined> => {
  try {
    return JSON.parse(await files.read(path))
  } catch {
    /* unreadable: leave it out */
  }
}
// "Edit refund-service.ts", "Bash npm test": one short line for a tool call of the agent. Null for the calls that are noise (the site's own, search for tools).
const QUIET = ['ArtifactData', 'Artifact', 'ArtifactComments', 'ToolSearch', 'ScheduleWakeup', 'Monitor']
export function describeTool(e: Record<string, any>): string | undefined {
  const tool = String(e.tool ?? '')
  if (!tool || QUIET.includes(tool)) return
  const arg = e.file_path ? String(e.file_path).split(/[\\/]/).pop() : e.command ? String(e.command).split('\n')[0] : (e.pattern ?? e.query ?? e.url ?? e.description ?? '')
  const text = `${tool} ${arg}`.trim()
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

export const flowIdOf = (flow: Doc, dir: string) => String(flow.id ?? dir.split('/').pop())
const isDone = (s: Doc) => s.status === 'completed' || s.status === 'skipped'

// What the page draws for one flow: the same facts the terminal pane reads (flowKind, stepKind), as one document.
export function flowDoc(flow: Doc, counts: { topics: number; files: number }, activity?: Activity): Doc {
  const steps: Doc[] = flow.steps ?? []
  const next = steps.find(s => !isDone(s))
  const waiting = steps.find(s => s.status === 'awaiting_approval')
  const blocked = steps.find(s => s.status === 'blocked')
  const routes = waiting ? routesOf(waiting as Step).map(r => ({ label: r.label, to: r.goTo })) : [] // the Back buttons of the card
  const children: Doc[] = flow.subFlowState?.childFlows ?? []
  const parentId = flow.subFlowState?.parentFlow?.id
  return cut({
    name: flow.name ?? '',
    template: flow.metadata?.template ?? '',
    status: flowKind(flow),
    activeStepId: flow.currentState?.activeStep?.id ?? next?.id ?? '',
    ...(blocked
      ? {
          needsYou: {
            stepId: blocked.id,
            stepNumber: Number(blocked.number ?? 0),
            stepName: blocked.name ?? '',
            waitsFor: blocked.blocked?.reason ?? 'A retry cannot help.',
            blocked: true,
            ...(blocked.blocked?.command ? { command: blocked.blocked.command } : {}),
            since: blocked.blocked?.since ?? flow.metadata?.lastUpdated ?? '',
          },
        }
      : waiting
        ? {
            needsYou: {
              stepId: waiting.id,
              stepNumber: Number(waiting.number ?? 0),
              stepName: waiting.name ?? '',
              waitsFor: waiting.stepDefinition?.output?.description || 'Your approval',
              ...(routes.length ? { routes } : {}),
              since: flow.metadata?.lastUpdated ?? '',
            },
          }
        : {}), // ponytail: "since" is the last change of the flow, the files do not record when the wait began
    updatedAt: flow.metadata?.lastUpdated ?? '',
    folders: flow.metadata?.projectPaths ?? (flow.metadata?.projectPath ? [flow.metadata.projectPath] : []), // the page warns when Continue runs in another folder
    ...(parentId ? { parentFlowId: parentId } : {}),
    counts,
    ...(activity && flowKind(flow) === 'running' ? { activity } : {}),
    steps: steps.map((s, i) => {
      const kids = children.filter(c => c.spawnedAtStep === s.id || c.spawnedAtStep === Number(s.number))
      const summary = s.stepDefinition?.output?.description
      return {
        id: s.id ?? String(i + 1),
        number: Number(s.number ?? i + 1),
        name: s.name ?? s.id ?? `Step ${i + 1}`,
        ...(s.phase ? { phase: s.phase } : {}),
        status: stepKind(s.status),
        approval: s.approvalRequired === true,
        ...(s.loopBackTo ? { loopBackTo: s.loopBackTo } : {}),
        ...(s.routes?.length ? { routes: s.routes } : {}),
        ...(s.onVerifierFail ? { onVerifierFail: s.onVerifierFail } : {}),
        ...(kids.length ? { childFlowIds: kids.map(c => c.id) } : {}),
        ...(summary ? { summary } : {}),
      }
    }),
  }) as Doc
}

// Every document of one flow. Null when the flow file is unreadable.
export async function snapshot(files: FileSystem, dir: string, activity?: Activity): Promise<{ flowId: string; docs: Record<string, SetWrite> } | undefined> {
  const flow = await readDoc(files, `${dir}/flow.json`)
  if (!flow) return
  const flowId = flowIdOf(flow, dir)
  const [logs, memory, rows, counts] = await Promise.all([logView(files, dir), memoryView(files, dir), filesView(files, dir), tabCounts(files, dir)])
  const put = (collection: string, doc_id: string, data: unknown): [string, SetWrite] => [`${collection}/${doc_id}`, { op: 'set', collection, doc_id, data: cut(data) as Doc }]
  return {
    flowId,
    docs: Object.fromEntries([
      put('flows', flowId, flowDoc(flow, counts, activity)),
      put('details', `${flowId}~logs`, { rows: logs }),
      put('details', `${flowId}~memory`, { topics: memory.topics, diffs: memory.diffs }),
      put('details', `${flowId}~files`, { rows }),
    ]),
  }
}

// The documents whose text differs from the last push. `last` keeps that text for each path.
export const changed = (last: Map<string, string>, docs: Record<string, SetWrite>): SetWrite[] =>
  Object.entries(docs)
    .filter(([path, w]) => last.get(path) !== JSON.stringify(w.data))
    .map(([, w]) => w)

// Write the documents in batches of 50. A batch that fails leaves `last` as it was, so the next push tries it again.
async function send(ports: LivePorts, last: Map<string, string>, writes: DocWrite[]): Promise<number> {
  for (let i = 0; i < writes.length; i += BATCH) {
    const part = writes.slice(i, i + BATCH)
    await ports.batch(part)
    for (const w of part) {
      if (w.op === 'delete') last.delete(`${w.collection}/${w.doc_id}`)
      else last.set(`${w.collection}/${w.doc_id}`, JSON.stringify(w.data))
    }
  }
  return writes.length
}

// Any documents: only those whose text differs from the last push are written. Rows of the `prune` collections that `docs` no longer holds are deleted:
// a removed or switched-off marketplace takes its rows with it. ponytail: only rows this mod wrote are pruned (`last` knows no others).
export const pushDocs = (ports: LivePorts, last: Map<string, string>, docs: SetWrite[], prune: string[] = []): Promise<number> => {
  const present = new Set(docs.map(w => `${w.collection}/${w.doc_id}`))
  const gone: DocWrite[] = [...last.keys()]
    .filter(path => prune.includes(path.split('/')[0]) && !present.has(path))
    .map(path => ({ op: 'delete', collection: path.split('/')[0], doc_id: path.split('/').slice(1).join('/') }))
  return send(ports, last, [...gone, ...docs.filter(w => last.get(`${w.collection}/${w.doc_id}`) !== JSON.stringify(w.data))])
}

// The given writes and the changed documents of one flow, in one batch: the page shows a command as done together with the state it made.
export async function pushOne(ports: LivePorts, last: Map<string, string>, dir: string, first: DocWrite[]): Promise<void> {
  const snap = await snapshot(ports.files, dir, ports.activity?.(dir))
  await send(ports, last, [...first, ...(snap ? changed(last, snap.docs) : [])])
}

// Read every active flow and write what changed. A flow that left the disk (deleted by any session) loses its rows, so every open page drops it.
// ponytail: a flow whose file cannot be read for one push loses its rows and gets them back on the next; rows written before the mod started are not pruned.
export async function pushFlows(ports: LivePorts, last: Map<string, string>): Promise<number> {
  const writes: DocWrite[] = []
  const present = new Set<string>()
  for (const info of await listFlows(ports.files)) {
    const snap = await snapshot(ports.files, info.dir, ports.activity?.(info.dir))
    if (!snap) continue
    for (const path of Object.keys(snap.docs)) present.add(path)
    writes.push(...changed(last, snap.docs))
  }
  for (const path of last.keys()) {
    const [collection, ...rest] = path.split('/')
    if ((collection === 'flows' || collection === 'details') && !present.has(path)) writes.push({ op: 'delete', collection, doc_id: rest.join('/') })
  }
  return send(ports, last, writes)
}

// The theme of the pages: one word in `~/.claude/zeremai/config/ui.json`, next to marketplaces.json. Every page of every session shows it.
// A missing, broken or unknown file reads as auto. The browser keeps a copy for the first paint; this file wins.
export type Theme = 'auto' | 'light' | 'dark'
export const THEMES: string[] = ['auto', 'light', 'dark']
const themePath = async (files: FileSystem) => {
  const home = await files.home()
  if (!home) throw new Error('No home folder found')
  return `${home.replace(/\\/g, '/')}/.claude/zeremai/config/ui.json`
}
export async function readTheme(files: FileSystem): Promise<Theme> {
  try {
    const theme = JSON.parse(await files.read(await themePath(files))).theme
    return THEMES.includes(theme) ? theme : 'auto'
  } catch {
    return 'auto'
  }
}
export const writeTheme = async (files: FileSystem, write: FileWriter, mode: string) => write(await themePath(files), JSON.stringify({ theme: THEMES.includes(mode) ? mode : 'auto' }, null, 2) + '\n')
export const themeDoc = async (files: FileSystem): Promise<SetWrite> => ({ op: 'set', collection: 'meta', doc_id: 'ui', data: { theme: await readTheme(files) } })

export const heartbeat = (ports: LivePorts): Promise<void> => ports.batch([{ op: 'set', collection: 'meta', doc_id: 'mod', data: { beat: ports.now(), v: 1 } }])

// The rules the page declares when it is published.
export const PAGE_CAPABILITIES = {
  db: { rules: [{ path: '', read: 'view', write: 'owner' }, ...['details', 'commands', 'sessions', 'templates', 'marketplaces', 'flavors'].map(path => ({ path, read: 'owner', write: 'owner' }))] },
  user: {},
  room: { topics: { zerem_click: 'interact' } }, // a hint that wakes the mod; the click itself is the row in `commands`
}

// One page for each session. The link and the page hash are kept by session id; `livePageUrls` lists every page, so the lock on `commands` covers all of them.
// A new link on every open: the host shows a link it already opened once only when the link is new. The page ignores t. The session rides after ? and after #.
export const siteLink = (url: string, session: string) => `${url}?s=${session}&t=${Date.now()}#${session}`
// The probe: the answer of the last Artifact open, kept so a second open that shows nothing can be read.
export const OPEN_ANSWER_KEY = 'lastOpenAnswer'
export const urlKey = (session: string) => `livePageUrl:${session}`
export const hashKey = (session: string) => `livePageHash:${session}`
export const ALL_URLS_KEY = 'livePageUrls'

// The tools the mod calls on its own. In Auto mode they need an allow rule: the classifier has no request to judge.
export const ALLOW_TOOLS = ['Artifact', 'ArtifactData']

// The user settings text with the two rules added. Throws on text that is not a JSON object, so the file is never overwritten.
export function withAllowRules(text: string | undefined): string {
  const settings = text?.trim() ? JSON.parse(text) : {}
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw new Error('settings.json is not a JSON object')
  const allow: unknown[] = settings.permissions?.allow ?? []
  settings.permissions = { ...settings.permissions, allow: [...allow, ...ALLOW_TOOLS.filter(t => !allow.includes(t))] }
  return `${JSON.stringify(settings, null, 2)}\n`
}
