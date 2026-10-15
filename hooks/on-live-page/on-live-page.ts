import type { Register } from 'claude-code'
import { approveStep, runScript, runsScript, scriptNote } from '../infra/flow-manager/script'
import { slash } from '../infra/flow-manager/move'
import { findFlowDir, sessionKey } from '../infra/flow-repository/flow-repository'
import { approveFromPane, requestChangesFromPane } from '../infra/approval-gate/approval-gate'
import type { AnswerLog, Approver } from '../infra/approval-gate/approval-gate'
import { logInteraction } from '../infra/log-first/log-first'
import { fillQuestion, parseAnswer } from '../infra/flow-pane/fill-fields'
import { listFlows, listTemplates, resumeFlow, startFlow } from '../infra/flow-pane/flow-pane'
import type { Started } from '../infra/flow-pane/flow-pane'
import { stepLine } from '../infra/flow-pane/step-line'
import { catalog, installTemplate, listMarketplaces, refreshMarketplaces, removeTemplate } from '../infra/templates/templates'
import type { TemplatePorts } from '../infra/templates/templates'
import { ALL_URLS_KEY, PAGE_CAPABILITIES, hashKey, heartbeat, pushDocs, pushFlows, urlKey } from '../infra/live-page/live-page'
import type { LivePorts } from '../infra/live-page/live-page'
import { checkCommand, commandWorld, hashOf, parseDocs, sessionDoc, sessionTitle, templateDocs } from '../infra/live-site/live-site'
import type { Row } from '../infra/live-site/live-site'
import type { FileSystem, Gate, GateStore, ManagerPorts } from '../infra/ports/ports'
import { startCountingAgain } from '../on-agent-stopping/on-agent-stopping'

// /zeremai opens the ZeremAI site: one page, published once, that shows every flow and does what the old pane did. The mod writes the state of every
// active flow to the page's database (after each flow script command, every 5 seconds, and a heartbeat every 30 seconds) and reads the actions the
// user presses on the page back from the `commands` collection on the same timer. A row is data, never an order: see checkCommand.
// With no link stored, nothing here does anything. A failed write never touches a flow: the reason is kept in the store as `livePageError`.

const COMMANDS = ['zeremai', 'zeremai:zeremai']
// The page of this session: its link is kept by session id.
const urlOf = async ($: any) => (await $.store.get(urlKey(await $.session.id()))) as string | undefined
const ERR_KEY = 'livePageError'
const TIP_KEY = 'livePageTipped'
const PUSH_MS = 5000
const BEAT_EVERY = 6 // pushes: 6 × 5 s = 30 s
const DAY_MS = 86_400_000
const HELP = ['/zeremai       open the ZeremAI site (it is published the first time)', '/zeremai help  this text'].join('\n')

const last = new Map<string, string>() // the text of each document at the last push
let timer: { cancel(): void } | undefined
let starting = false
let ticks = 0
let busy = false
let draining = false
let lastBeat = ''
let ruleShown = false // the permission rule is said once for each run of the mod

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300)

// ArtifactData and Artifact are deferred tools: a call before they are loaded fails, so load them once with ToolSearch and call again.
async function call($: any, input: Record<string, unknown>): Promise<any> {
  const run = () => $.tool.call(input)
  const result = await run().catch(async (error: unknown) => {
    if (!/no tool named/.test(String((error as Error)?.message))) throw error
    await $.tool.call({ tool: 'ToolSearch', query: 'select:Artifact,ArtifactData', max_results: 2 })
    return run()
  })
  if (result.deny || result.isError) throw new Error(String(result.deny ?? result.text ?? 'the tool failed'))
  return result
}

// The database refuses a write to a document that exists unless it names the version it last saw. The mod keeps the version of each document it wrote
// or read, learns the rest with one list of the collection (ponytail: first 1000 documents), and learns again when a write says the version is wrong.
const versions = new Map<string, number>() // `url collection/doc` → version
type Write = { op: string; collection: string; doc_id: string; data?: unknown; if_version?: number }
const keyOf = (url: string, w: Write) => `${url} ${w.collection}/${w.doc_id}`
const seed = (url: string, collection: string, rows: Row[]) => rows.forEach(r => versions.set(`${url} ${collection}/${r.id}`, r.version))

async function learn($: any, url: string, collection: string): Promise<void> {
  seed(url, collection, parseDocs(String((await call($, { tool: 'ArtifactData', action: 'list', url, collection, query: { limit: 1000 } })).text ?? '')))
}

async function writeBatch($: any, url: string, writes: Write[]): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    for (const collection of new Set(writes.filter(w => !versions.has(keyOf(url, w))).map(w => w.collection))) await learn($, url, collection)
    const pinned = writes.map(w => (versions.has(keyOf(url, w)) ? { ...w, if_version: versions.get(keyOf(url, w)) } : w))
    try {
      const text = String((await call($, { tool: 'ArtifactData', action: 'batch', url, writes: pinned })).text ?? '')
      for (const [, collection, id, version] of text.matchAll(/- (?:set|update) "([^"]+)"\/"([^"]+)" \(version (\d+)\)/g)) versions.set(`${url} ${collection}/${id}`, Number(version))
      for (const w of pinned) if (w.op === 'delete') versions.delete(keyOf(url, w))
      return
    } catch (error) {
      if (attempt > 0 || !/version_mismatch/.test(String((error as Error)?.message))) throw error
      for (const key of [...versions.keys()]) if (key.startsWith(`${url} `)) versions.delete(key)
    }
  }
}

// ── what the mod builds from `$` (a mod cannot share a function that takes `$` across files) ─────────────────────────

const filesOf = ($: any): FileSystem => ({
  home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
  list: path => $.fs.list(path),
  exists: path => $.fs.exists(path),
  read: path => $.fs.read(path),
})
const linksOf = ($: any): ManagerPorts['links'] => ({
  get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
  add: async (sessionId, dir) => {
    const dirs = ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? []
    await $.store.set(sessionKey(sessionId), [...dirs.filter(d => d !== dir), dir]) // the newest goes last, and answers first
  },
})
async function pythonOf($: any): Promise<string> { return (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3' } // Windows has no python3 command
const managerPorts = ($: any): ManagerPorts => ({
  files: filesOf($),
  write: (path, text) => $.fs.write(path, text),
  move: async () => { throw new Error('The site does not move folders.') }, // only the old pane deleted a flow
  now: () => new Date().toISOString(),
  uuid: () => crypto.randomUUID(),
  pluginRoot: slash($.plugin.root),
  cwd: () => $.session.cwd(),
  sessionId: () => $.session.id(),
  links: linksOf($),
  script: async (sub, input) => runScript(argv => $.process.run(argv, { timeoutMs: 60_000 }), await pythonOf($), slash($.plugin.root), sub, input),
})
const templatePortsOf = async ($: any): Promise<TemplatePorts> => ({
  files: filesOf($),
  write: (path, text) => $.fs.write(path, text),
  now: () => new Date().toISOString(),
  pluginRoot: slash($.plugin.root),
  windows: (await $.env.get('OS')) === 'Windows_NT',
  run: argv => $.process.run(argv, { timeoutMs: 120_000 }), // a clone can take a while
})
const gatesOf = ($: any): GateStore => ({
  get: async sessionId => ((await $.store.get(`gate:${sessionId}`)) as Gate | undefined) ?? undefined,
  set: (sessionId, gate) => $.store.set(`gate:${sessionId}`, gate),
  clear: sessionId => $.store.delete(`gate:${sessionId}`),
})
// The answer of the user on the site is logged by the mod, like a prompt (a model writes the details).
const answerLog = ($: any): AnswerLog => (dir, request) => logInteraction({ files: filesOf($), links: linksOf($), complete: r => $.model.complete(r), script: managerPorts($).script }, dir, request)
// The script writes `approved` (approve-step).
const approverOf = ($: any): Approver => async (dir, stepId) => approveStep(argv => $.process.run(argv, { timeoutMs: 60_000 }), await pythonOf($), slash($.plugin.root), dir, stepId)

const portsOf = ($: any, url: string): LivePorts => ({
  files: filesOf($),
  batch: writes => writeBatch($, url, writes as Write[]),
  now: () => new Date().toISOString(),
})

// ── the push ───────────────────────────────────────────────────────────────────────────────────────────────────────

let title = ''
let titleAt = 0

async function push($: any, beat = false): Promise<void> {
  const url = await urlOf($)
  if (!url || busy) return
  busy = true
  try {
    const ports = portsOf($, url)
    await pushFlows(ports, last)
    if (beat || !lastBeat) lastBeat = ports.now()
    const session = await $.session.id()
    const cwd = await $.session.cwd()
    if (Date.now() - titleAt > 300_000) { title = await sessionTitle(ports.files, session, cwd); titleAt = Date.now() } // the title changes rarely
    await pushDocs(ports, last, [await sessionDoc(ports.files, session, await linksOf($).get(session), cwd, lastBeat, (await $.store.get(`openedAt:${session}`)) as string | undefined, title)])
    if (beat) await heartbeat(ports)
    if ((await $.store.get(ERR_KEY)) !== undefined) await $.store.delete(ERR_KEY) // also an error that an older copy of this module stored, before a reload
  } catch (error) {
    await $.store.set(ERR_KEY, message(error)).catch(() => {})
  }
  busy = false
}

// The templates and marketplaces change rarely: at the start of the timer and after an install, a removal or a refresh.
async function pushTemplates($: any): Promise<void> {
  const url = await urlOf($)
  if (!url) return
  try {
    const ports = await templatePortsOf($)
    const [entries, templates, markets] = await Promise.all([catalog(ports), listTemplates(filesOf($)), listMarketplaces(ports)])
    await pushDocs(portsOf($, url), last, templateDocs(entries, templates, markets))
  } catch (error) { await $.store.set(ERR_KEY, message(error)).catch(() => {}) }
}

// ── the commands from the site ─────────────────────────────────────────────────────────────────────────────────────

// The agent reads an answer or a flow as a prompt. Not awaited: it resolves when the turn starts. A refusal is kept, so the page is not the only one that knows.
function submit($: any, input: { text: string; asUser?: boolean }): void {
  void Promise.resolve($.prompt.submit(input)).catch((error: unknown) => $.store.set(ERR_KEY, `The prompt did not reach Claude: ${message(error)}`).catch(() => {}))
}

// A flow is handed to the agent as the user's own prompt, like the old pane did.
async function handOff($: any, started: Started): Promise<void> {
  if ('error' in started) throw new Error(started.error)
  let text = started.text
  try {
    text += `\n${scriptNote(slash($.plugin.root), await pythonOf($))}` // the agent runs the flow script with Bash, one command form
    await showStepLine($, started.dir)
    startCountingAgain()
    if (!ruleShown) {
      ruleShown = true
      try { await $.ui.toast(`Claude runs the flow script with Bash. To skip the prompts, allow Bash(${await pythonOf($)} ${slash($.plugin.root)}/scripts/flow_manager.py *) in your settings.`) } catch { /* a surface that cannot show a toast */ }
    }
  } catch (error) { throw new Error(`The flow started, but setup failed: ${message(error)}. Press Continue to try again.`) }
  submit($, { text, asUser: true })
}

// The line under the prompt. A surface that cannot draw it (VS Code, print mode) throws or ignores: the flow goes on without it.
async function showStepLine($: any, dir: string | undefined): Promise<void> {
  try { await $.ui.status(dir ? await stepLine(filesOf($), dir) : undefined) } catch { /* no line */ }
}

// The session lets go of the flow. The files stay; the guards and the line under the prompt stop. A parent flow, if there is one, answers again.
async function closeFlow($: any, dir: string): Promise<void> {
  const id = await $.session.id()
  await $.store.set(sessionKey(id), (await linksOf($).get(id)).filter(d => d !== dir))
  await showStepLine($, await findFlowDir(filesOf($), linksOf($), id))
}

// Claude fills the fields from the text. A fork of the session knows what was talked about; a new session has nothing to fork, so a fresh call answers.
async function fillFields($: any, args: Record<string, string>): Promise<string> {
  const template = (await listTemplates(filesOf($))).find(t => `${t.category}/${t.name}` === args.template)
  if (!template) throw new Error('That template is not installed.')
  let typed: Record<string, string> = {}
  try { typed = Object.fromEntries(Object.entries(JSON.parse(args.values || '{}')).filter(([k, v]) => typeof v === 'string' && template.fields.some(f => f.name === k))) as Record<string, string> } catch { /* no typed values */ }
  const question = fillQuestion(template, template.purpose, typed, args.text)
  let reply: any = await $.model.fork({ prompt: question })
  if (!reply.isAnswered && reply.reason === 'nothing-to-fork') reply = await $.model.complete({ model: 'sonnet', prompt: question, timeoutMs: 30_000 })
  if (!reply.isAnswered) throw new Error(`Claude gave no answer (${reply.reason}).`)
  const parsed = parseAnswer(template, reply.text)
  if ('error' in parsed) throw new Error(parsed.error)
  return JSON.stringify(parsed.answer)
}

// Continue: a blocked step runs again, and the flow goes back to the agent. The page and the button above the prompt both call this.
export async function continueFlow($: any, dir: string, note?: string): Promise<void> {
  await handOff($, await resumeFlow(managerPorts($), dir, note))
}

// One checked command → what it did, in a line the page shows. The existing calls are the ones the old pane buttons made.
async function execute($: any, { action, args }: { action: string; args: Record<string, string> }, dir?: string): Promise<string> {
  const files = filesOf($)
  const session = await $.session.id()
  switch (action) {
    case 'approve':
    case 'request-changes': {
      const answer = action === 'approve'
        ? await approveFromPane(files, approverOf($), gatesOf($), session, dir!, args.stepId, answerLog($))
        : await requestChangesFromPane(files, approverOf($), gatesOf($), session, dir!, args.stepId, args.reason, answerLog($))
      if ('error' in answer) throw new Error(answer.error)
      submit($, { text: answer.text }) // the answer reaches the agent as a prompt, like the dialog's answer
      return action === 'approve' ? 'Approved. Claude carries on.' : 'Sent. Claude changes the step.'
    }
    case 'continue': await continueFlow($, dir!, args.note?.trim() || undefined); return 'Resumed. Claude carries on.'
    case 'close': await closeFlow($, dir!); return 'Closed. This session no longer works on that flow.'
    case 'new-flow': {
      const template = (await listTemplates(files)).find(t => `${t.category}/${t.name}` === args.template)
      if (!template) throw new Error('That template is not installed.')
      const values = Object.fromEntries(template.fields.filter(f => args[f.name] !== undefined).map(f => [f.name, args[f.name]]))
      await handOff($, await startFlow(managerPorts($), template, values))
      return 'Started. Claude carries on.'
    }
    case 'fill-fields': return fillFields($, args)
    case 'install-template': await installTemplate(await templatePortsOf($), { marketplace: args.marketplace, category: args.category, name: args.name }); await pushTemplates($); return 'Installed.'
    case 'remove-template': await removeTemplate(await templatePortsOf($), { category: args.category, name: args.name }); await pushTemplates($); return 'Removed.'
    case 'refresh-marketplaces': { const lines = await refreshMarketplaces(await templatePortsOf($)); await pushTemplates($); return lines.join('\n') || 'Refreshed.' }
  }
  throw new Error('Unknown action.') // checkCommand lets only the actions above through
}

const setStatus = ($: any, url: string, id: string, data: Record<string, unknown>) =>
  writeBatch($, url, [{ op: 'update', collection: 'commands', doc_id: id, data }])

// The new commands of this session, one at a time, oldest first. Each row goes 'running', then 'done' or 'error' with a short result.
async function drain($: any): Promise<void> {
  const url = await urlOf($)
  if (!url || draining) return
  draining = true
  let ran = false
  try {
    const session = await $.session.id()
    const rows = parseDocs(String((await call($, { tool: 'ArtifactData', action: 'query', url, collection: 'commands', query: { where: [['status', 'eq', 'new'], ['session', 'eq', session]], limit: 20 } })).text ?? ''))
      .sort((a, b) => String(a.data.at).localeCompare(String(b.data.at)))
    const files = filesOf($)
    for (const row of rows) {
      ran = true
      seed(url, 'commands', [row])
      const world = await commandWorld(files, session, await linksOf($).get(session), (await listFlows(files)).map(f => f.dir)) // read again: the command before may have changed the flows
      const checked = checkCommand(row.data, world)
      if ('error' in checked) { await setStatus($, url, row.id, { status: 'error', result: checked.error }); continue }
      await setStatus($, url, row.id, { status: 'running' })
      let status = 'done', result: string
      try { result = await execute($, checked.cmd, checked.dir) } catch (error) { status = 'error'; result = message(error) }
      await setStatus($, url, row.id, { status, result: result.slice(0, 2000) })
    }
  } catch (error) { await $.store.set(ERR_KEY, message(error)).catch(() => {}) }
  draining = false
  if (ran) await push($)
}

// Rows older than one day go, whoever wrote them.
async function prune($: any): Promise<void> {
  const url = await urlOf($)
  if (!url) return
  try {
    const cutoff = new Date(Date.now() - DAY_MS).toISOString()
    const rows = parseDocs(String((await call($, { tool: 'ArtifactData', action: 'query', url, collection: 'commands', query: { where: [['at', 'lt', cutoff]], limit: 50 } })).text ?? ''))
    if (!rows.length) return
    seed(url, 'commands', rows)
    await writeBatch($, url, rows.map(r => ({ op: 'delete', collection: 'commands', doc_id: r.id })))
  } catch { /* the rows stay until the next beat */ }
}

// One timer for the mod. A mod has no file watcher. `session.start` is the hook that fires at the start of the session and again after each reload of the
// plugin (a reload cancels the timers, and the band above the prompt does not draw on every surface). The engine refuses a module that registers `session.start`
// twice with no matcher (on-flow-tools has that one), so it is registered here with a matcher, once for each value of `isInteractive`.
async function ensureTimer($: any): Promise<void> {
  if (timer || starting) return
  starting = true
  try {
    if (!(await urlOf($))) return
    await ensureCurrent($)
    try {
      timer = $.clock.every(PUSH_MS, async () => {
        const beat = ++ticks % BEAT_EVERY === 0
        await push($, beat)
        await drain($)
        if (beat) await prune($)
      })
    } catch { return /* no timer: flow commands still push */ }
    await push($, true)
    await pushTemplates($)
  } finally { starting = false }
}

// ── the page ───────────────────────────────────────────────────────────────────────────────────────────────────────

const pagePath = ($: any) => `${slash($.plugin.root)}/skills/live-flow/page.html`

// The page file ships in skills/live-flow. If the Artifact tool refuses a path outside the project, a copy in the project folder goes instead.
// With `existing`, the same artifact gets the new page and the new rules. The tool wants a read before it changes a page this session did not publish.
async function publish($: any, existing?: string): Promise<string> {
  const page = pagePath($)
  if (!(await $.fs.exists(page))) throw new Error('skills/live-flow/page.html is missing from the plugin')
  const input = (file_path: string) => existing
    ? { tool: 'Artifact', url: existing, file_path, capabilities: PAGE_CAPABILITIES }
    : { tool: 'Artifact', file_path, icon: 'flow', description: 'Every flow and its steps, live.', capabilities: PAGE_CAPABILITIES, pin: true }
  if (existing) await call($, { tool: 'Artifact', action: 'read', url: existing }).catch(() => {})
  const result = await call($, input(page)).catch(async () => {
    const copy = `${slash(await $.session.cwd())}/.claude/zeremai-live-page.html`
    await $.fs.write(copy, await $.fs.read(page))
    return call($, input(copy))
  })
  const link = String(result.text ?? '').match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/)?.[0] ?? existing
  if (!link) throw new Error(`published, but no link in the answer: ${String(result.text ?? '').slice(0, 200)}`)
  return link
}

const hashOfPage = async ($: any) => hashOf(`${await $.fs.read(pagePath($))}${JSON.stringify(PAGE_CAPABILITIES)}`)

// The page and its rules change between versions of the plugin: when they differ from what was published, publish again to the same link.
async function ensureCurrent($: any): Promise<void> {
  const url = await urlOf($)
  if (!url) return
  try {
    const hash = await hashOfPage($)
    if ((await $.store.get(hashKey(await $.session.id()))) === hash) return
    await publish($, url)
    await $.store.set(hashKey(await $.session.id()), hash)
    last.clear()
  } catch (error) { await $.store.set(ERR_KEY, `The page was not updated: ${message(error)}`).catch(() => {}) }
}

// The link that names this session: the site sends its actions to the session that opened it. A bare token after #: a #key=value never reaches the page.
// It also rides after ?, in case the host passes the query and not the fragment.
const siteUrl = async ($: any, url: string) => { const id = await $.session.id(); return `${url}?s=${id}#${id}` }

// The Artifact tool shows the page in the surface the user works in. A surface that cannot (print mode, no tool) refuses: the link is in the answer anyway.
async function openPage($: any, url: string): Promise<boolean> {
  try { await call($, { tool: 'Artifact', action: 'open', url }); return true } catch { return false }
}

// One message, once, when the first flow starts and the page does not exist yet.
async function tip($: any): Promise<void> {
  if ((await urlOf($)) || (await $.store.get(TIP_KEY))) return
  await $.store.set(TIP_KEY, true)
  try { await $.ui.toast('ZeremAI opens a live site for all your flows. Run /zeremai.') } catch { /* a surface with no toast */ }
}

const createdFlow = (command: string, result: any): boolean => {
  if (!/\bcreate-flow\b/.test(command)) return false
  try { return JSON.parse(String(result?.result?.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '').status === 'ok' } catch { return false }
}

export const register: Register = on => {
  // Only the site writes to `commands` of the live page. The agent runs as the owner, so it could write an approval itself: a call that does not come from
  // this plugin (the engine's, the model's) can read the rows but never write them. `next.origin` is set by the host, not by the caller.
  on('tool.call', { tool: 'ArtifactData' }, async ($, e, next) => {
    const urls = new Set([...(((await $.store.get(ALL_URLS_KEY)) as string[] | undefined) ?? []), await urlOf($), (await $.store.get('livePageUrl')) as string | undefined]) // every page of the mod, and the old shared one
    const action = (e as any).action as string
    const collections: unknown[] = action === 'batch' ? ((e as any).writes ?? []).map((w: any) => w?.collection) : [(e as any).collection]
    const writes = !['get', 'list', 'query', 'profiles'].includes(action)
    if (writes && next.origin.plugin !== $.plugin.name && urls.has(String((e as any).url).split(/[?#]/)[0]) && collections.some(c => typeof c !== 'string' || c === 'commands' || c.startsWith('commands/'))) {
      return { deny: 'The commands of the ZeremAI site are written by the site only. Only the user presses its buttons.' } as never
    }
    return next(e)
  })

  // The script has run when `next` answers, whichever hook sits above or beneath this one.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (runsScript((e as any).command)) {
      await ensureTimer($); await push($)
      if (createdFlow((e as any).command, result)) await tip($)
    }
    return result
  })

  // The heartbeat must not depend on a surface that draws the band: it starts with the session, and again after each reload of the plugin.
  for (const isInteractive of [true, false]) {
    on('session.start', { isInteractive }, async ($, e, next) => {
      void ensureTimer($).catch(error => $.store.set(ERR_KEY, message(error)).catch(() => {}))
      return next(e)
    })
  }

  // The band above the prompt draws at the start of the session: the only hook that is sure to run before the user does anything. It draws nothing.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!timer && !starting) void ensureTimer($).catch(() => {})
    return next(e)
  })

  // Every word of /zeremai opens the site. It is published the first time.
  on('command.run', { command: COMMANDS }, async ($, e) => {
    if (String(e.args ?? '').trim().split(/\s+/)[0]?.toLowerCase() === 'help') return { text: HELP } as never
    try {
      let url = await urlOf($)
      if (!url) {
        url = await publish($)
        await $.store.set(urlKey(await $.session.id()), url)
        await $.store.set(ALL_URLS_KEY, [...new Set([...(((await $.store.get(ALL_URLS_KEY)) as string[] | undefined) ?? []), url])])
        await $.store.set(hashKey(await $.session.id()), await hashOfPage($))
        last.clear()
      } else await ensureCurrent($)
      await ensureTimer($)
      await $.store.set(`openedAt:${await $.session.id()}`, new Date().toISOString()) // the page picks the session that opened it last, when its link has no session
      await push($, true) // the commands wait for the timer: the host refuses a prompt from inside a command hook
      const link = await siteUrl($, url)
      const opened = (await openPage($, link)) || (await openPage($, url)) // a fragment may be refused: the plain link opens the site, the page then picks the newest session
      const problem = (await $.store.get(ERR_KEY)) as string | undefined
      return { text: `ZeremAI ${opened ? 'opened' : 'link'}: ${link}${problem ? `\nThe last write failed: ${problem}` : ''}` } as never
    } catch (error) {
      return { text: `Could not set up ZeremAI: ${message(error)}` } as never
    }
  })
}
