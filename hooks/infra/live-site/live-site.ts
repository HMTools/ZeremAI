import type { FileSystem } from '../ports/ports'
import type { Doc } from '../flow-manager/flow-files'
import type { Flow } from '../flow-types/flow-types'
import { findApprovalStep } from '../approval-gate/approval-gate'
import { cut, flowIdOf } from '../live-page/live-page'
import type { DocWrite } from '../live-page/live-page'
import type { TemplateInfo } from '../flow-pane/flow-pane'
import type { CatalogEntry, MarketplaceInfo } from '../templates/templates'

// The live site writes more than the flow state: `sessions/<id>` (who is alive, which flows each holds), `templates/<category>~<name>` and
// `marketplaces/<name>`. It reads one thing back: `commands/<id>`, the actions the user presses on the site. A row is data, never an order:
// `checkCommand` decides if the mod may run it.

export type Row = { id: string; data: Doc; version: number }

// The documents of a list or query answer: one JSON line each, after a line that says how many.
export function parseDocs(text: string): Row[] {
  const rows: Row[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('{"id":')) continue
    try { const d = JSON.parse(line); if (typeof d.id === 'string' && d.data && typeof d.data === 'object' && typeof d.version === 'number') rows.push({ id: d.id, data: d.data, version: d.version }) } catch { /* not a document line */ }
  }
  return rows
}

// A short hash of the page and its rules: when it changes, the mod publishes the page again. Not a secret, only a change detector (FNV-1a).
export function hashOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16)
}

const PLAIN = /^[\w.-]+$/ // a name that is safe in a path and a document id
const MAX = 2000

// What a command may touch: the flows of this session (with their files), and every flow in active/ (the ones Continue could resume).
export type CommandWorld = { session: string; bound: Record<string, { dir: string; flow: Flow }>; active: Record<string, string> }

export async function commandWorld(files: FileSystem, session: string, bound: string[], active: string[]): Promise<CommandWorld> {
  const read = async (dir: string): Promise<Flow | undefined> => { try { return JSON.parse(await files.read(`${dir}/flow.json`)) } catch { /* unreadable */ } }
  const world: CommandWorld = { session, bound: Object.create(null), active: Object.create(null) }
  for (const dir of bound) { const flow = await read(dir); if (flow) world.bound[flowIdOf(flow as Doc, dir)] = { dir, flow } }
  for (const dir of active) { const flow = await read(dir); if (flow) world.active[flowIdOf(flow as Doc, dir)] = dir }
  return world
}

type Spec = { need: string[]; maybe?: string[]; open?: true; flow?: 'step' | 'bound' | 'active'; plain?: string[] }
const SPEC: Record<string, Spec> = {
  'approve': { need: ['flowId', 'stepId'], flow: 'step', plain: ['flowId', 'stepId'] },
  'request-changes': { need: ['flowId', 'stepId', 'reason'], flow: 'step', plain: ['flowId', 'stepId'] },
  'continue': { need: ['flowId'], maybe: ['note'], flow: 'active', plain: ['flowId'] },
  'close': { need: ['flowId'], flow: 'bound', plain: ['flowId'] },
  'new-flow': { need: ['template'], open: true }, // one more key for each field of the template
  'fill-fields': { need: ['template', 'text'], maybe: ['values'] },
  'install-template': { need: ['marketplace', 'category', 'name'], plain: ['marketplace', 'category', 'name'] },
  'remove-template': { need: ['category', 'name'], plain: ['category', 'name'] },
  'refresh-marketplaces': { need: [] },
}
const TEMPLATE = /^[\w.-]+\/[\w.-]+$/
const KEY = /^[\w.-]{1,100}$/
const short = (v: unknown) => String(v).slice(0, 40)

export type Checked = { error: string } | { cmd: { action: string; args: Record<string, string> }; dir?: string }

// The row as the page wrote it → the command to run, or the reason to refuse it in plain words.
export function checkCommand(data: unknown, world: CommandWorld): Checked {
  const d = data as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return { error: 'The command is not an object.' }
  const action = typeof d.action === 'string' ? d.action : ''
  const spec = Object.prototype.hasOwnProperty.call(SPEC, action) ? SPEC[action] : undefined
  if (!spec) return { error: `Unknown action: ${short(d.action)}` }
  if (d.session !== world.session) return { error: 'This command is for another session.' }
  if (!d.args || typeof d.args !== 'object' || Array.isArray(d.args)) return { error: 'The command has no arguments.' }
  const args: Record<string, string> = Object.create(null)
  for (const [k, v] of Object.entries(d.args)) {
    if (!KEY.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') return { error: `Bad argument name: ${short(k)}` }
    if (typeof v !== 'string' || v.length > MAX) return { error: `Bad value for ${k}.` }
    if (!spec.open && !spec.need.includes(k) && !spec.maybe?.includes(k)) return { error: `Unexpected argument: ${k}` }
    args[k] = v
  }
  for (const k of spec.need) if (!args[k]?.trim()) return { error: `Missing: ${k}` }
  for (const k of spec.plain ?? []) if (!PLAIN.test(args[k])) return { error: `Not a plain name: ${k}` }
  if ('template' in args && !TEMPLATE.test(args.template)) return { error: 'The template must be category/name.' }
  const cmd = { action, args }
  if (spec.flow === 'active') return world.active[args.flowId] ? { cmd, dir: world.active[args.flowId] } : { error: 'That flow is not in the list of running flows.' }
  if (!spec.flow) return { cmd }
  const hit = world.bound[args.flowId]
  if (!hit) return { error: 'That flow is not bound to this session.' }
  if (spec.flow === 'step' && findApprovalStep(hit.flow)?.id !== args.stepId) return { error: 'That step no longer waits for approval.' }
  return { cmd, dir: hit.dir }
}

// The row of one session: its folder, a heartbeat, and the flows it holds. The page treats a beat older than 3 minutes as a closed session.
// The title that Claude Code shows in its sidebar: the last `ai-title` line of the transcript. Empty when there is none.
// ponytail: reads the whole transcript; the caller caches it. Read only the tail if a transcript is ever too big.
export async function sessionTitle(files: FileSystem, session: string, folder: string): Promise<string> {
  try {
    const text = await files.read(`${await files.home()}/.claude/projects/${folder.replace(/[^a-zA-Z0-9]/g, '-')}/${session}.jsonl`)
    const hits = text.match(/"type":"ai-title","aiTitle":"(?:[^"\\]|\\.)*"/g)
    return hits ? String(JSON.parse(`{${hits[hits.length - 1]}}`).aiTitle).slice(0, 80) : ''
  } catch { return '' }
}

export async function sessionDoc(files: FileSystem, session: string, dirs: string[], folder: string, beat: string, openedAt?: string, title?: string): Promise<DocWrite> {
  const flows: string[] = []
  for (const dir of dirs) { try { flows.push(flowIdOf(JSON.parse(await files.read(`${dir}/flow.json`)), dir)) } catch { /* the flow is gone */ } }
  return { op: 'set', collection: 'sessions', doc_id: session, data: { folder, name: folder.split('/').filter(Boolean).pop() ?? folder, beat, flows, ...(openedAt ? { openedAt } : {}), ...(title ? { title } : {}) } }
}

const fieldsOf = (t?: TemplateInfo) => (t?.fields ?? []).map(f => ({ name: f.name, required: f.required, type: 'text', description: f.description, example: f.example }))

// The catalog of the marketplaces joined with the installed templates (they know the fields), and one row for each marketplace.
// ponytail: a template that is neither installed nor in a cache any more keeps its old row; delete rows when a reader shows that.
export function templateDocs(entries: CatalogEntry[], templates: TemplateInfo[], markets: MarketplaceInfo[]): DocWrite[] {
  const rows = new Map<string, Doc>()
  const installed = (category: string, name: string) => templates.find(t => t.category === category && t.name === name)
  for (const e of entries) {
    const t = installed(e.category, e.name)
    rows.set(`${e.category}~${e.name}`, { name: e.name, category: e.category, title: e.title, description: e.description, installed: e.state !== 'available', state: e.state, marketplace: e.marketplace, ...(t ? { steps: t.stepCount } : {}), fields: e.state === 'available' ? [] : fieldsOf(t) })
  }
  for (const t of templates) {
    const id = `${t.category}~${t.name}`
    if (!rows.has(id)) rows.set(id, { name: t.name, category: t.category, title: t.title, description: t.purpose, installed: true, state: 'installed', steps: t.stepCount, fields: fieldsOf(t) })
  }
  const docs: DocWrite[] = [...rows].filter(([id]) => PLAIN.test(id.replace('~', '.'))).map(([id, data]) => ({ op: 'set', collection: 'templates', doc_id: id, data: cut(data) as Doc }))
  for (const m of markets) {
    if (!PLAIN.test(m.name)) continue
    const count = entries.filter(e => e.marketplace === m.name).length
    docs.push({ op: 'set', collection: 'marketplaces', doc_id: m.name, data: { name: m.name, templates: count, enabled: m.enabled, cached: m.cached, ...(m.lastSynced ? { refreshedAt: m.lastSynced } : {}) } })
  }
  return docs
}
