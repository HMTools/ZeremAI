import type { FileSystem } from '../ports/ports'
import type { Doc } from '../flow-manager/flow-files'
import type { CatalogEntry } from '../templates/templates'
import type { TemplateInfo } from './flow-pane'

// The templates list and the template detail of the New tab. Pure functions and file reads: the pane draws what they return.

export type TemplateState = 'installed' | 'update' | 'available'
export type TemplateRow = { key: string; category: string; name: string; title: string; purpose: string; steps?: number; state: TemplateState; template?: TemplateInfo; entry?: CatalogEntry }
export const FAVORITES = '__favorites__' // the filter chip that shows only the starred templates

// One list: every template of the catalog with its state, and the installed ones the catalog does not know. Start needs `template`.
export function mergeTemplates(templates: TemplateInfo[], entries: CatalogEntry[]): TemplateRow[] {
  const rows = new Map<string, TemplateRow>()
  for (const t of templates) rows.set(`${t.category}/${t.name}`, { key: `${t.category}/${t.name}`, category: t.category, name: t.name, title: t.title, purpose: t.purpose, steps: t.stepCount, state: 'installed', template: t })
  for (const e of entries) {
    const key = `${e.category}/${e.name}`
    const have = rows.get(key)
    if (have) rows.set(key, { ...have, title: e.title || have.title, purpose: e.description || have.purpose, state: e.state === 'update' ? 'update' : 'installed', entry: e })
    else rows.set(key, { key, category: e.category, name: e.name, title: e.title, purpose: e.description, state: 'available', entry: e })
  }
  return [...rows.values()]
}

// What the list shows: the search words must all appear; a category or the favorites chip narrows it; favorites go first.
export function matches(rows: TemplateRow[], query: string, category: string | undefined, favorites: ReadonlySet<string>): TemplateRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return rows
    .filter(r => (!category ? true : category === FAVORITES ? favorites.has(r.key) : r.category === category))
    .filter(r => { const hay = `${r.title} ${r.name} ${r.category} ${r.purpose}`.toLowerCase(); return words.every(w => hay.includes(w)) })
    .sort((a, b) => Number(favorites.has(b.key)) - Number(favorites.has(a.key)) || a.key.localeCompare(b.key))
}

// The New list in parts: starred templates, the last ones you started, the rest by category, and the ones you do not have.
// A template shows once. `lastUsed` holds template names, newest first.
export type TemplateGroups = { favorites: TemplateRow[]; last: TemplateRow[]; groups: { category: string; rows: TemplateRow[] }[]; missing: TemplateRow[] }
export function groupRows(rows: TemplateRow[], favorites: ReadonlySet<string>, lastUsed: string[], withTop: boolean): TemplateGroups {
  const have = rows.filter(r => r.state !== 'available')
  const fav = withTop ? have.filter(r => favorites.has(r.key)) : []
  const last: TemplateRow[] = []
  for (const name of withTop ? lastUsed : []) {
    const r = have.find(x => x.name === name || x.key === name)
    if (r && !fav.includes(r) && !last.includes(r) && last.length < 3) last.push(r)
  }
  const groups: TemplateGroups['groups'] = []
  for (const r of have) {
    if (fav.includes(r) || last.includes(r)) continue
    const g = groups.find(x => x.category === r.category)
    if (g) g.rows.push(r); else groups.push({ category: r.category, rows: [r] })
  }
  return { favorites: fav, last, groups: groups.sort((a, b) => a.category.localeCompare(b.category)), missing: rows.filter(r => r.state === 'available') }
}

// The templates of your flows, newest first, once each.
export const lastUsedNames = (flows: { template?: string; updatedMs?: number }[]): string[] =>
  [...new Set(flows.filter(p => p.template).sort((a, b) => (b.updatedMs ?? 0) - (a.updatedMs ?? 0)).map(p => p.template!))]

export type Access = 'R' | 'W' | 'R/W' | ''
export type TemplateStep = { number: number; name: string; approval: boolean; purpose: string; guidance: string[]; substeps: string[]; output: string; reads: string[]; writes: string[] }
export type TemplateDetail = {
  path: string; name: string; category: string; purpose: string
  parameters: { name: string; required: boolean; description: string; example: string }[]
  steps: TemplateStep[]
  flow: { topics: string[]; cells: Record<string, Access[]> } // for each topic, one mark for each step
}

const readDoc = async (files: FileSystem, path: string): Promise<Doc | undefined> => {
  try { return JSON.parse(await files.read(path)) } catch { /* unreadable: leave it out */ }
}
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : x && typeof x === 'object' ? JSON.stringify(x) : String(x))) : typeof v === 'string' && v ? [v] : [])
// A description can be text or an object with a description in it.
const textOf = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as Doc).description === 'string' ? (v as Doc).description : '')
const topicName = (t: string) => t.replace(/\.json$/, '')

// Every step file in the template folder, by its id (a step names its file by id: stepRef).
async function stepFiles(files: FileSystem, dir: string): Promise<Map<string, Doc>> {
  const found = new Map<string, Doc>()
  const walk = async (path: string, depth: number) => {
    for (const e of await files.list(path).catch(() => [])) {
      const full = `${path}/${e.name}`
      if (e.kind === 'dir') { if (depth < 2) await walk(full, depth + 1) } else if (e.name.endsWith('.json')) {
        const doc = await readDoc(files, full)
        if (doc?.type === 'step' && doc.id) found.set(doc.id, doc)
      }
    }
  }
  await walk(dir, 0)
  return found
}

// A template with its step files: purpose, parameters, each step's definition, and which step reads or writes which memory topic.
export async function templateDetail(files: FileSystem, path: string): Promise<TemplateDetail | undefined> {
  const t = await readDoc(files, path)
  if (!t) return
  const refs = await stepFiles(files, path.slice(0, path.lastIndexOf('/')))
  const { required = [], optional = [], definitions = {} } = t.parameters ?? {}
  const param = (name: string, isRequired: boolean) => ({ name, required: isRequired, description: textOf(definitions[name]?.description ?? definitions[name]), example: String(definitions[name]?.example ?? '') })
  const steps: TemplateStep[] = ((t.steps ?? []) as Doc[]).map((s, i) => {
    const def = refs.get(s.stepRef) ?? s.stepDefinition ?? {}
    const guidance: Doc = def.guidance ?? {}
    return {
      number: s.number ?? i + 1, name: s.name ?? def.name ?? `Step ${i + 1}`, approval: s.approvalRequired === true || def.approvalRequired === true,
      purpose: def.metadata?.purposeAndUsage ?? '',
      guidance: [...strings(guidance.prerequisites), ...strings(def.bestPractices ?? guidance.bestPractices)].slice(0, 6),
      substeps: ((def.substeps ?? []) as Doc[]).map((x, n) => `${x.number ?? n + 1} ${x.name ?? ''}`.trim()),
      output: textOf(def.output),
      reads: strings(def.memoryFileUsage?.readFrom).map(topicName), writes: strings(def.memoryFileUsage?.writeTo).map(topicName),
    }
  })
  const topics = [...new Set(steps.flatMap(s => [...s.writes, ...s.reads]))].sort()
  const cells: Record<string, Access[]> = Object.fromEntries(topics.map(topic => [topic, steps.map((s): Access => {
    const r = s.reads.includes(topic), w = s.writes.includes(topic)
    return r && w ? 'R/W' : w ? 'W' : r ? 'R' : ''
  })]))
  return {
    path, name: t.name ?? '', category: t.category ?? '', purpose: t.metadata?.purposeAndUsage ?? '',
    parameters: [...required.map((n: string) => param(n, true)), ...optional.map((n: string) => param(n, false))],
    steps, flow: { topics, cells },
  }
}
