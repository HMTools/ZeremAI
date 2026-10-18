import type { Register } from 'claude-code'
import { approveStep, loopsOver, runScript, runsScript, scriptNote } from '../infra/flow-manager/script'
import { removeCommands, slash } from '../infra/flow-manager/move'
import { findFlowDir, sessionKey } from '../infra/flow-repository/flow-repository'
import { approveFromPane, goBackFromPane, requestChangesFromPane } from '../infra/approval-gate/approval-gate'
import type { AnswerLog, Approver } from '../infra/approval-gate/approval-gate'
import { approveEntry, logInteraction } from '../infra/log-first/log-first'
import { fillQuestion, parseAnswer } from '../infra/flow-pane/fill-fields'
import { listFlows, listTemplates, purgeFlow, resumeFlow, startFlow } from '../infra/flow-pane/flow-pane'
import type { Started } from '../infra/flow-pane/flow-pane'
import { stepLine } from '../infra/flow-pane/step-line'
import { addMarketplace, catalog, installTemplate, listMarketplaces, refreshMarketplaces, removeMarketplace, removeTemplate, syncFirstRun, toggleMarketplace, updateMarketplace } from '../infra/templates/templates'
import type { TemplatePorts } from '../infra/templates/templates'
import { runMarketplaceCommand } from '../infra/templates/marketplace-command'
import { ALLOW_TOOLS, OPEN_ANSWER_KEY, siteLink, ALL_URLS_KEY, PAGE_CAPABILITIES, withAllowRules, describeTool, hashKey, heartbeat, pushDocs, pushFlows, pushOne, themeDoc, urlKey, writeTheme } from '../infra/live-page/live-page'
import type { Activity, LivePorts } from '../infra/live-page/live-page'
import { checkCommand, commandWorld, flavorDocs, hashOf, parseDocs, sessionDoc, sessionTitle, templateDocs } from '../infra/live-site/live-site'
import type { Row } from '../infra/live-site/live-site'
import type { FileSystem, Gate, GateStore, ManagerPorts } from '../infra/ports/ports'
import { findUpdate, installUpdate, isNewer, runningVersion } from '../infra/plugin-update/plugin-update'
import type { UpdatePorts, UpdateRecord } from '../infra/plugin-update/plugin-update'
import { startCountingAgain } from '../on-agent-stopping/on-agent-stopping'

// /zeremai:init opens the ZeremAI site: one page, published once, that shows every flow and does what the old pane did. The mod writes the state of every
// active flow to the page's database (after each flow script command, a change every 10 seconds, and a heartbeat every 30 seconds) and reads the actions the
// user presses on the page back from the `commands` collection on the same timer (every 30 seconds idle, every 2 seconds while a click is likely). A row is data, never an order: see checkCommand.
// With no link stored, nothing here does anything. A failed write never touches a flow: the reason is kept in the store as `livePageError`.

const COMMANDS = ['zeremai:init']
// The page of this session: its link is kept by session id.
async function urlOf($: any) {
  return (await $.store.get(urlKey(await $.session.id()))) as string | undefined
}
const ERR_KEY = 'livePageError'
const TIP_KEY = 'livePageTipped'
// A mod has no way to hear the page, so it asks the database. Every ArtifactData call is a tool call, and each tool call runs every PreToolUse and PostToolUse
// hook of the machine (an org can set one that starts a process for each call). So the mod asks each second only while a click is likely, and every 5 s otherwise.
const TICK_MS = 1000
const IDLE_EVERY = 30 // ticks between two reads while no click is likely (the hint from the page wakes the drain at once: this is the backup)
const HOT_EVERY = 2 // ticks between two reads while a click is likely
const HOT_TICKS = 30 // a read each HOT_EVERY ticks for this many ticks after a command or a hint from the page
const WAITING_TICKS = 60 // and for this many after a flow starts to wait for the user
const PUSH_EVERY = 10 // ticks: the flows are checked every 10 s, and a change is written
const BEAT_EVERY = 30 // ticks: the heartbeat goes in with every third push (the page says "Live" for a beat younger than 60 s)
const PRUNE_EVERY = 600 // ticks
const DAY_MS = 86_400_000
const HELP = ['/zeremai:init       start the session and open the ZeremAI site (it is published the first time)', '/zeremai:init help  this text'].join('\n')

const last = new Map<string, string>() // the text of each document at the last push
const acts = new Map<string, Activity>() // the last tool call of the agent, for each flow folder of the session
let timer: { cancel(): void } | undefined
let starting = false
let ticks = 0
let hotUntil = 0 // the tick until which the mod reads clicks each second
const waitingNow = new Set<string>() // the flows that wait for the user, as of the last look
let busy = false
let again = false // a push was asked while one ran: it runs once more when that one ends
let handedAt = '' // when the last prompt went to Claude, for the command row
let draining = false
let lastBeat = ''
let ruleShown = false // the permission rule is said once for each run of the mod

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300)

// ArtifactData and Artifact are deferred tools: a call before they are loaded fails, so load them once with ToolSearch and call again.
class NoVerdict extends Error {
  constructor() {
    super(`Auto mode refused the ${ALLOW_TOOLS.join(' and ')} call: allow both in permissions.allow of ~/.claude/settings.json, then run /zeremai:init again.`)
  }
}

const calls: number[] = [] // when the mod made each tool call in the last minute
function callsLastMinute(): number {
  while (calls.length && Date.now() - calls[0] > 60_000) calls.shift()
  return calls.length
}

async function call($: any, input: Record<string, unknown>): Promise<any> {
  calls.push(Date.now())
  const run = () => $.tool.call(input)
  const result = await run().catch(async (error: unknown) => {
    if (!/no tool named/.test(String((error as Error)?.message))) throw error
    await $.tool.call({ tool: 'ToolSearch', query: 'select:Artifact,ArtifactData', max_results: 2 })
    return run()
  })
  // Auto mode: a mod's call carries no user request, so the classifier gives no verdict, and the same call again gets the same answer. An allow rule skips the classifier.
  if (/gave no verdict/.test(String(result.deny ?? result.text ?? ''))) throw new NoVerdict()
  const final = result
  if (final.deny || final.isError) throw new Error(String(final.deny ?? final.text ?? 'the tool failed'))
  return final
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

// With `claim`, a version mismatch is not retried: another writer got there first, so the answer is false and the caller does nothing.
async function writeBatch($: any, url: string, writes: Write[], claim = false): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    for (const collection of new Set(writes.filter(w => !versions.has(keyOf(url, w))).map(w => w.collection))) await learn($, url, collection)
    const pinned = writes.map(w => (versions.has(keyOf(url, w)) ? { ...w, if_version: versions.get(keyOf(url, w)) } : w))
    try {
      const text = String((await call($, { tool: 'ArtifactData', action: 'batch', url, writes: pinned })).text ?? '')
      for (const [, collection, id, version] of text.matchAll(/- (?:set|update) "([^"]+)"\/"([^"]+)" \(version (\d+)\)/g)) versions.set(`${url} ${collection}/${id}`, Number(version))
      for (const w of pinned) if (w.op === 'delete') versions.delete(keyOf(url, w))
      return true
    } catch (error) {
      if (attempt > 0 || !/version_mismatch/.test(String((error as Error)?.message))) throw error
      for (const key of [...versions.keys()]) if (key.startsWith(`${url} `)) versions.delete(key)
      if (claim) return false
    }
  }
}

// ── what the mod builds from `$` (a mod cannot share a function that takes `$` across files) ─────────────────────────

function filesOf($: any): FileSystem {
  return {
    home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
  }
}
function linksOf($: any): ManagerPorts['links'] {
  return {
    get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
    add: async (sessionId, dir) => {
      const dirs = ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? []
      await $.store.set(sessionKey(sessionId), [...dirs.filter(d => d !== dir), dir]) // the newest goes last, and answers first
    },
  }
}
async function pythonOf($: any): Promise<string> {
  return (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3'
} // Windows has no python3 command
function managerPorts($: any): ManagerPorts {
  return {
    files: filesOf($),
    write: (path, text) => $.fs.write(path, text),
    move: async () => {
      throw new Error('The site does not move folders.')
    }, // only the old pane moved a flow
    remove: async path => {
      // The mods file API cannot remove a folder: run the platform's own command. Windows sets OS=Windows_NT in every shell.
      const windows = (await $.env.get('OS')) === 'Windows_NT'
      for (const argv of removeCommands(windows, path)) {
        const run = await $.process.run(argv)
        if (run.exitCode !== 0) throw new Error(`${argv[0]} failed: ${(run.stderr || run.stdout).trim()}`)
      }
    },
    now: () => new Date().toISOString(),
    uuid: () => crypto.randomUUID(),
    pluginRoot: slash($.plugin.root),
    cwd: () => $.session.cwd(),
    sessionId: () => $.session.id(),
    links: linksOf($),
    script: async (sub, input) => runScript(argv => $.process.run(argv, { timeoutMs: 60_000 }), await pythonOf($), slash($.plugin.root), sub, input),
  }
}
async function templatePortsOf($: any): Promise<TemplatePorts> {
  return {
    files: filesOf($),
    write: (path, text) => $.fs.write(path, text),
    now: () => new Date().toISOString(),
    pluginRoot: slash($.plugin.root),
    windows: (await $.env.get('OS')) === 'Windows_NT',
    run: argv => $.process.run(argv, { timeoutMs: 120_000 }), // a clone can take a while
  }
}
function gatesOf($: any): GateStore {
  return {
    get: async sessionId => ((await $.store.get(`gate:${sessionId}`)) as Gate | undefined) ?? undefined,
    set: (sessionId, gate) => $.store.set(`gate:${sessionId}`, gate),
    clear: sessionId => $.store.delete(`gate:${sessionId}`),
  }
}
// The answer of the user on the site is logged by the mod, like a prompt (a model writes the details).
function answerLog($: any): AnswerLog {
  return (dir, request, plain) =>
    logInteraction({ files: filesOf($), links: linksOf($), complete: r => $.model.complete(r), script: managerPorts($).script }, dir, request, plain ? approveEntry : undefined)
}
// The script writes `approved` (approve-step).
function approverOf($: any): Approver {
  return async (dir, stepId) => approveStep(argv => $.process.run(argv, { timeoutMs: 60_000 }), await pythonOf($), slash($.plugin.root), dir, stepId)
}

// The script sends the flow back (route-step) and starts the count of loops again (reset-loops).
function loopsOf($: any) {
  return loopsOver(argv => $.process.run(argv, { timeoutMs: 60_000 }), () => pythonOf($), slash($.plugin.root))
}

function portsOf($: any, url: string): LivePorts {
  return {
    files: filesOf($),
    batch: writes => writeBatch($, url, writes as Write[]),
    now: () => new Date().toISOString(),
    activity: dir => acts.get(dir),
  }
}

// ── a new version of the plugin ────────────────────────────────────────────────────────────────────────────────────
// At each session start the mod asks Claude Code for the newest version (see ../infra/plugin-update). It says so once for each version, and writes `meta/update`
// for the banner on the site. A failed check stays quiet: it never touches a flow.
const UPDATE_KEY = 'pluginUpdate'
const TOLD_KEY = 'pluginUpdateToldFor'
const updatePortsOf = ($: any): UpdatePorts => ({ run: argv => $.process.run(argv, { timeoutMs: 120_000 }), read: path => $.fs.read(path), home: () => filesOf($).home(), pluginRoot: slash($.plugin.root) })

async function checkForUpdate($: any): Promise<void> {
  const ports = updatePortsOf($)
  const record = (await $.store.get(UPDATE_KEY)) as UpdateRecord | undefined
  const running = await runningVersion(ports)
  if (record && record.state !== 'current' && running && !isNewer(record.latest, running)) await $.store.set(UPDATE_KEY, { ...record, current: running, state: 'current' }) // after the restart
  const found = await findUpdate(ports)
  if (!found) return
  if (record?.latest !== found.latest || record.state === 'current') await $.store.set(UPDATE_KEY, found)
  if ((await $.store.get(TOLD_KEY)) !== found.latest) {
    await $.store.set(TOLD_KEY, found.latest)
    try {
      await $.ui.toast(`ZeremAI ${found.latest} is out (you have ${found.current}). Run /zeremai:init and press Update now.`)
    } catch {
      /* a surface with no toast */
    }
  }
  void push($).catch(() => {})
}

const TPL_TOLD_KEY = 'templateUpdatesToldFor'
// Pull every marketplace, then name the installed templates that have a newer version. One message for each set of versions.
async function checkTemplates($: any): Promise<void> {
  const ports = await templatePortsOf($)
  await refreshMarketplaces(ports) // a failed pull keeps the old copy and says so in its own line: nothing to do here
  const ups = (await catalog(ports)).filter(e => e.state === 'update')
  void pushTemplates($).catch(() => {})
  const key = ups.map(e => `${e.category}/${e.name}@${e.version}`).sort().join(',')
  if (!ups.length || (await $.store.get(TPL_TOLD_KEY)) === key) return
  await $.store.set(TPL_TOLD_KEY, key)
  try {
    const names = ups.slice(0, 2).map(e => `${e.title} ${e.version}`).join(', ')
    await $.ui.toast(`${ups.length} template${ups.length > 1 ? 's have' : ' has'} updates: ${names}${ups.length > 2 ? ', …' : ''}. Open the site to review.`)
  } catch {
    /* a surface with no toast */
  }
}

async function updatePlugin($: any): Promise<string> {
  const record = (await $.store.get(UPDATE_KEY)) as UpdateRecord | undefined
  if (!record || record.state === 'current') return 'Already on the newest version.'
  if (record.state === 'restart' || record.state === 'updating') return `ZeremAI ${record.latest} is installed. Restart Claude Code to use it.`
  await $.store.set(UPDATE_KEY, { ...record, state: 'updating' })
  await push($)
  const done = await installUpdate(updatePortsOf($), record)
  await $.store.set(UPDATE_KEY, done)
  await push($)
  if (done.state === 'failed') throw new Error(done.error)
  return `Updated to ${done.latest}. Restart Claude Code to use it.`
}

// ── the push ───────────────────────────────────────────────────────────────────────────────────────────────────────

let title = ''
let titleAt = 0

async function push($: any, beat = false): Promise<void> {
  const url = await urlOf($)
  if (!url) return
  if (busy) {
    again = true
    return
  }
  busy = true
  try {
    const ports = portsOf($, url)
    await pushFlows(ports, last)
    if (beat || !lastBeat) lastBeat = ports.now()
    const session = await $.session.id()
    const cwd = await $.session.cwd()
    if (Date.now() - titleAt > 300_000) {
      title = await sessionTitle(ports.files, session, cwd)
      titleAt = Date.now()
    } // the title changes rarely
    const update = (await $.store.get(UPDATE_KEY)) as UpdateRecord | undefined
    await pushDocs(ports, last, [...(update ? [{ op: 'set' as const, collection: 'meta', doc_id: 'update', data: update }] : []), await themeDoc(ports.files), await sessionDoc(ports.files, session, await linksOf($).get(session), cwd, lastBeat, (await $.store.get(`openedAt:${session}`)) as string | undefined, title)])
    await pushDocs(ports, last, await flavorDocs(ports.files), ['flavors']) // a flow can propose a flavor at any time
    if (beat) await heartbeat(ports)
    if ((await $.store.get(ERR_KEY)) !== undefined) await $.store.delete(ERR_KEY) // also an error that an older copy of this module stored, before a reload
  } catch (error) {
    await $.store.set(ERR_KEY, message(error)).catch(() => {})
  }
  busy = false
  if (again) {
    again = false
    await push($, beat)
  }
}

// The templates and marketplaces change rarely: at the start of the timer and after an install, a removal or a refresh.
async function pushTemplates($: any): Promise<void> {
  const url = await urlOf($)
  if (!url) return
  try {
    const ports = await templatePortsOf($)
    const [entries, templates, markets] = await Promise.all([catalog(ports), listTemplates(filesOf($)), listMarketplaces(ports)])
    await pushDocs(portsOf($, url), last, templateDocs(entries, templates, markets), ['templates', 'marketplaces'])
  } catch (error) {
    await $.store.set(ERR_KEY, message(error)).catch(() => {})
  }
}

// ── the commands from the site ─────────────────────────────────────────────────────────────────────────────────────

// The agent reads an answer or a flow as a prompt. Not awaited: it resolves when the turn starts. A refusal is kept, so the page is not the only one that knows.
function submit($: any, input: { text: string; asUser?: boolean }): void {
  handedAt = new Date().toISOString()
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
      try {
        await $.ui.toast(`Claude runs the flow script with Bash. To skip the prompts, allow Bash(${await pythonOf($)} ${slash($.plugin.root)}/scripts/flow_manager.py *) in your settings.`)
      } catch {
        /* a surface that cannot show a toast */
      }
    }
  } catch (error) {
    throw new Error(`The flow started, but setup failed: ${message(error)}. Press Continue to try again.`)
  }
  submit($, { text, asUser: true })
}

// The line under the prompt. A surface that cannot draw it (VS Code, print mode) throws or ignores: the flow goes on without it.
async function showStepLine($: any, dir: string | undefined): Promise<void> {
  try {
    await $.ui.status(dir ? await stepLine(filesOf($), dir) : undefined)
  } catch {
    /* no line */
  }
}

// The session lets go of the flow. The files stay; the guards and the line under the prompt stop. A parent flow, if there is one, answers again.
// `from` is another session that loses the flow (Take over). ponytail: its agent is not told and may finish its turn; add a message if that shows up.
async function closeFlow($: any, dir: string, from?: string): Promise<void> {
  const id = from ?? (await $.session.id())
  await $.store.set(
    sessionKey(id),
    (await linksOf($).get(id)).filter(d => d !== dir),
  )
  if (from) return
  await showStepLine($, await findFlowDir(filesOf($), linksOf($), id))
}

// Claude fills the fields from the text. A fork of the session knows what was talked about; a new session has nothing to fork, so a fresh call answers.
async function fillFields($: any, args: Record<string, string>): Promise<string> {
  const template = (await listTemplates(filesOf($))).find(t => `${t.category}/${t.name}` === args.template)
  if (!template) throw new Error('That template is not installed.')
  let typed: Record<string, string> = {}
  try {
    typed = Object.fromEntries(Object.entries(JSON.parse(args.values || '{}')).filter(([k, v]) => typeof v === 'string' && template.fields.some(f => f.name === k))) as Record<string, string>
  } catch {
    /* no typed values */
  }
  const question = fillQuestion(template, template.purpose, typed, args.text)
  let reply: any = await $.model.fork({ prompt: question })
  if (!reply.isAnswered && reply.reason === 'nothing-to-fork') reply = await $.model.complete({ model: 'sonnet', prompt: question, timeoutMs: 30_000 })
  if (!reply.isAnswered) throw new Error(`Claude gave no answer (${reply.reason}).`)
  const parsed = parseAnswer(template, reply.text)
  if ('error' in parsed) throw new Error(parsed.error)
  return JSON.stringify(parsed.answer)
}

// Continue: a blocked step runs again, and the flow goes back to the agent. The page and the button above the prompt both call this.
async function continueFlow($: any, dir: string, note?: string): Promise<void> {
  await handOff($, await resumeFlow(managerPorts($), dir, note))
}

// View, edit and send-as-PR of a template are skills, so the session gets a prompt that names the skill and the folder. Same hand-off as New flow.
async function handTemplate($: any, action: string, args: Record<string, string>): Promise<string> {
  const folder = `${slash((await filesOf($).home()) ?? '')}/.claude/zeremai/templates/flows/${args.category}/${args.name}`
  if (action === 'view-template') submit($, { text: `Use the zeremai:view-template skill on the template folder ${folder}`, asUser: true })
  else if (action === 'edit-template') submit($, { text: `Use the zeremai:edit-template skill on the template folder ${folder}. The change I want: ${args.request}`, asUser: true })
  else submit($, { text: `Use the zeremai:edit-template skill in send mode on the template folder ${folder}. Send my changes to the marketplace ${args.marketplace} as a pull request.`, asUser: true })
  return 'Sent. Claude carries on in the session.'
}

// One checked command → what it did, in a line the page shows. The existing calls are the ones the old pane buttons made.
async function execute($: any, { action, args }: { action: string; args: Record<string, string> }, dir?: string): Promise<string> {
  const files = filesOf($)
  const session = await $.session.id()
  switch (action) {
    case 'approve':
    case 'request-changes':
    case 'route': {
      const answer =
        action === 'approve'
          ? await approveFromPane(files, approverOf($), gatesOf($), session, dir!, args.stepId, answerLog($))
          : action === 'route'
            ? await goBackFromPane(files, approverOf($), gatesOf($), session, dir!, args.stepId, args.label, args.reason, answerLog($), loopsOf($))
            : await requestChangesFromPane(files, approverOf($), gatesOf($), session, dir!, args.stepId, args.reason, answerLog($), loopsOf($))
      if ('error' in answer) throw new Error(answer.error)
      submit($, { text: answer.text }) // the answer reaches the agent as a prompt, like the dialog's answer
      return action === 'approve' ? 'Approved. Claude carries on.' : action === 'route' ? 'Sent back. Claude starts that step again.' : 'Sent. Claude changes the step.'
    }
    case 'continue':
      if (args.from && args.from !== session) await closeFlow($, dir!, args.from) // Take over: the old session loses the flow first
      await continueFlow($, dir!, args.note?.trim() || undefined)
      return 'Resumed. Claude carries on.'
    case 'close':
      await closeFlow($, dir!)
      return 'Closed. This session no longer works on that flow.'
    case 'delete':
      await purgeFlow(managerPorts($), dir!) // the folder of any running flow; the next push removes its rows from the page
      await showStepLine($, await findFlowDir(filesOf($), linksOf($), session))
      return 'Deleted. The flow folder is gone.'
    case 'new-flow': {
      const template = (await listTemplates(files)).find(t => `${t.category}/${t.name}` === args.template)
      if (!template) throw new Error('That template is not installed.')
      const values = Object.fromEntries(template.fields.filter(f => args[f.name] !== undefined).map(f => [f.name, args[f.name]]))
      await handOff($, await startFlow(managerPorts($), template, values))
      return 'Started. Claude carries on.'
    }
    case 'fill-fields':
      return fillFields($, args)
    case 'install-template':
      await installTemplate(await templatePortsOf($), { marketplace: args.marketplace, category: args.category, name: args.name })
      await pushTemplates($)
      return 'Installed.'
    case 'remove-template':
      await removeTemplate(await templatePortsOf($), { category: args.category, name: args.name })
      await pushTemplates($)
      return 'Removed.'
    case 'view-template':
    case 'edit-template':
    case 'send-template':
      return handTemplate($, action, args)
    case 'set-theme': {
      await writeTheme(filesOf($), (path, text) => $.fs.write(path, text), args.mode)
      const url = await urlOf($)
      if (url) await pushDocs(portsOf($, url), last, [await themeDoc(filesOf($))])
      return 'Saved.'
    }
    case 'add-marketplace': {
      const ports = await templatePortsOf($)
      await addMarketplace(ports, { name: args.name, url: args.url, branch: args.branch ?? '', priority: args.priority ?? '' })
      const lines = await refreshMarketplaces(ports, { onlyMissing: true })
      await pushTemplates($)
      return lines.join('\n') || 'Added.'
    }
    case 'update-marketplace':
      await updateMarketplace(await templatePortsOf($), args.name, { name: args.newName || args.name, url: args.url, branch: args.branch ?? '', priority: args.priority ?? '' })
      await pushTemplates($)
      return 'Saved. Refresh to read the marketplace again.'
    case 'toggle-marketplace':
      await toggleMarketplace(await templatePortsOf($), args.name)
      await pushTemplates($)
      return 'Done.'
    case 'remove-marketplace':
      await removeMarketplace(await templatePortsOf($), args.name)
      await pushTemplates($)
      return 'Removed. Installed templates stay.'
    case 'save-flavor':
    case 'accept-flavor':
    case 'accept-all-flavors':
    case 'remove-flavor': {
      const done = await managerPorts($).script(action === 'save-flavor' ? 'set-flavor' : action, args) // the flow script is the only writer of the flavors folder
      if (done.status !== 'ok') throw new Error(String(done.message ?? 'The flavor was not saved.'))
      const url = await urlOf($)
      if (url) await pushDocs(portsOf($, url), last, await flavorDocs(filesOf($)), ['flavors'])
      if (action === 'accept-all-flavors') return `Accepted ${done.accepted ?? 0}${done.skipped ? `, skipped ${done.skipped} that no longer apply` : ''}. Steps use them now.`
      return action === 'save-flavor' ? 'Saved.' : action === 'accept-flavor' ? 'Accepted. Steps use it now.' : 'Removed.'
    }
    case 'update-plugin':
      return updatePlugin($)
    case 'refresh-marketplaces': {
      const lines = await refreshMarketplaces(await templatePortsOf($))
      await pushTemplates($)
      return lines.join('\n') || 'Refreshed.'
    }
  }
  throw new Error('Unknown action.') // checkCommand lets only the actions above through
}

function setStatus($: any, url: string, id: string, data: Record<string, unknown>) {
  return writeBatch($, url, [{ op: 'update', collection: 'commands', doc_id: id, data }])
}

// The new commands of this session, one at a time, oldest first. Each row goes 'running', then 'done' or 'error' with a short result.
async function drain($: any): Promise<void> {
  const url = await urlOf($)
  if (!url || draining) return
  draining = true
  let ran = false
  try {
    const session = await $.session.id()
    const rows = parseDocs(
      String(
        (
          await call($, {
            tool: 'ArtifactData',
            action: 'query',
            url,
            collection: 'commands',
            query: {
              where: [
                ['status', 'eq', 'new'],
                ['session', 'eq', session],
              ],
              limit: 20,
            },
          })
        ).text ?? '',
      ),
    ).sort((a, b) => String(a.data.at).localeCompare(String(b.data.at)))
    const files = filesOf($)
    for (const row of rows) {
      ran = true
      seed(url, 'commands', [row])
      const world = await commandWorld(
        files,
        session,
        await linksOf($).get(session),
        (await listFlows(files)).map(f => f.dir),
      ) // read again: the command before may have changed the flows
      const checked = checkCommand(row.data, world)
      if ('error' in checked) {
        await setStatus($, url, row.id, { status: 'error', result: checked.error, doneAt: new Date().toISOString() })
        continue
      }
      // The claim: a write that names the version of the row. A second drain (an older copy of the module, a wake-up) that lost the race runs nothing.
      if (!(await writeBatch($, url, [{ op: 'update', collection: 'commands', doc_id: row.id, data: { status: 'running', pickedAt: new Date().toISOString() } }], true))) continue
      handedAt = ''
      let status = 'done',
        result: string
      try {
        result = await execute($, checked.cmd, checked.dir)
      } catch (error) {
        status = 'error'
        result = message(error)
      }
      const done = { op: 'update', collection: 'commands', doc_id: row.id, data: { status, result: result.slice(0, 2000), doneAt: new Date().toISOString(), ...(handedAt ? { handedAt } : {}) } }
      // "done" and the state it made go in one write, so the page never says done while the flow on screen is old. A command with no flow folder pushes first.
      if (checked.dir) await pushOne(portsOf($, url), last, checked.dir, [done as never])
      else {
        await push($)
        await writeBatch($, url, [done])
      }
    }
  } catch (error) {
    await $.store.set(ERR_KEY, message(error)).catch(() => {})
  }
  draining = false
  if (ran) {
    hotUntil = ticks + HOT_TICKS // the next click is likely close
    await push($)
  }
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
    await writeBatch(
      $,
      url,
      rows.map(r => ({ op: 'delete', collection: 'commands', doc_id: r.id })),
    )
  } catch {
    /* the rows stay until the next beat */
  }
}

// A flow that has just started to wait for the user (read from local files, no tool call): the click is likely close.
async function lookForWaiting($: any): Promise<void> {
  const now = new Set((await listFlows(filesOf($))).filter(f => f.kind === 'waiting' || f.kind === 'blocked').map(f => f.dir))
  if ([...now].some(dir => !waitingNow.has(dir))) hotUntil = Math.max(hotUntil, ticks + WAITING_TICKS)
  waitingNow.clear()
  for (const dir of now) waitingNow.add(dir)
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
      // A click is read first, and never waits for a push: the push (every flow, the session title) runs on the side. See IDLE_EVERY and HOT_TICKS for how often.
      timer = $.clock.every(TICK_MS, async () => {
        ticks++
        // Not awaited, so each one needs its own catch: a rejection nobody handles can take the whole mod down.
        if (ticks % PUSH_EVERY === 0) {
          void lookForWaiting($).catch(() => {})
          void push($, ticks % BEAT_EVERY === 0).catch(() => {})
        }
        if (ticks % PRUNE_EVERY === 0) void prune($).catch(() => {})
        if (ticks < hotUntil ? ticks % HOT_EVERY === 0 : ticks % IDLE_EVERY === 0) await drain($).catch(() => {})
      })
    } catch {
      return /* no timer: flow commands still push */
    }
    await push($, true)
    await pushTemplates($)
    // The first sync runs on the side, so the site opens at once; the list updates when it ends. A failure is kept, and the next start tries again.
    void templatePortsOf($)
      .then(syncFirstRun)
      .then(lines => (lines.length ? pushTemplates($) : undefined))
      .catch(error => $.store.set(ERR_KEY, message(error)).catch(() => {}))
  } finally {
    starting = false
  }
}

// ── the page ───────────────────────────────────────────────────────────────────────────────────────────────────────

function pagePath($: any) {
  return `${slash($.plugin.root)}/skills/live-flow/page.html`
}

// The page file ships in skills/live-flow. If the Artifact tool refuses a path outside the project, a copy in the project folder goes instead.
// With `existing`, the same artifact gets the new page and the new rules. The tool wants a read before it changes a page this session did not publish.
async function publish($: any, existing?: string): Promise<string> {
  const page = pagePath($)
  if (!(await $.fs.exists(page))) throw new Error('skills/live-flow/page.html is missing from the plugin')
  const input = (file_path: string) =>
    existing
      ? { tool: 'Artifact', url: existing, file_path, capabilities: PAGE_CAPABILITIES }
      : { tool: 'Artifact', file_path, icon: 'flow', description: 'Every flow and its steps, live.', capabilities: PAGE_CAPABILITIES, pin: true }
  if (existing) await call($, { tool: 'Artifact', action: 'read', url: existing }).catch(() => {})
  const result = await call($, input(page)).catch(async (error: unknown) => {
    if (error instanceof NoVerdict) throw error // a copy of the file cannot fix a refusal
    const copy = `${slash(await $.session.cwd())}/.claude/zeremai-live-page.html`
    await $.fs.write(copy, await $.fs.read(page))
    return call($, input(copy))
  })
  const link = String(result.text ?? '').match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/)?.[0] ?? existing
  if (!link) throw new Error(`published, but no link in the answer: ${String(result.text ?? '').slice(0, 200)}`)
  return link
}

// One click: the user says yes, and the mod adds the two rules to the user settings. A file it cannot read as JSON is left alone.
async function offerRules($: any): Promise<string> {
  const help = new NoVerdict().message
  const home = await filesOf($).home()
  if (!home) return help
  const path = `${slash(home)}/.claude/settings.json`
  const yes = 'Add the rules'
  if ((await $.ui.ask(`Auto mode refused ZeremAI's ${ALLOW_TOOLS.join(' and ')} calls. Add them to permissions.allow in ${path}?`, [yes, 'Not now']).catch(() => '')) !== yes) return help
  try {
    await $.fs.write(path, withAllowRules((await $.fs.exists(path)) ? await $.fs.read(path) : undefined))
    return 'Rules added. Run /zeremai:init again.'
  } catch (error) {
    return `${help}\n(Could not edit the file: ${message(error)})`
  }
}

async function hashOfPage($: any) {
  return hashOf(`${await $.fs.read(pagePath($))}${JSON.stringify(PAGE_CAPABILITIES)}`)
}

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
  } catch (error) {
    await $.store.set(ERR_KEY, `The page was not updated: ${message(error)}`).catch(() => {})
  }
}

// The link that names this session: the site sends its actions to the session that opened it. A bare token after #: a #key=value never reaches the page.
// It also rides after ?, in case the host passes the query and not the fragment.
async function siteUrl($: any, url: string) {
  const id = await $.session.id()
  return siteLink(url, id)
}

// The Artifact tool shows the page in the surface the user works in. A surface that cannot (print mode, no tool) refuses: the link is in the answer anyway.
async function openPage($: any, url: string): Promise<boolean> {
  try {
    await $.store.set(OPEN_ANSWER_KEY, String((await call($, { tool: 'Artifact', action: 'open', url })).text ?? '')).catch(() => {})
    return true
  } catch {
    return false
  }
}

// One message, once, when the first flow starts and the page does not exist yet.
async function tip($: any): Promise<void> {
  if ((await urlOf($)) || (await $.store.get(TIP_KEY))) return
  await $.store.set(TIP_KEY, true)
  try {
    await $.ui.toast('ZeremAI opens a live site for all your flows. Run /zeremai.')
  } catch {
    /* a surface with no toast */
  }
}

const createdFlow = (command: string, result: any): boolean => {
  if (!/\bcreate-flow\b/.test(command)) return false
  try {
    return (
      JSON.parse(
        String(result?.result?.stdout ?? '')
          .trim()
          .split('\n')
          .filter(Boolean)
          .pop() ?? '',
      ).status === 'ok'
    )
  } catch {
    return false
  }
}

async function noteTool($: any, e: any, origin: string | undefined): Promise<void> {
  const text = origin === $.plugin.name || runsScript(e.command) ? undefined : describeTool(e) // the flow script is the mod's own work
  if (!text) return
  const at = new Date().toISOString()
  for (const dir of await linksOf($).get(await $.session.id())) acts.set(dir, { text, at })
}

export const register: Register = on => {
  // What the agent does now shows on the page as one line. A call of this plugin is not the agent's. The line goes out with the next push.
  // The engine allows one `tool.call` hook with no matcher (on-pending-checkpoint has it), so the tools are named; Bash is in the hook below.
  on('tool.call', { tool: ['Edit', 'Write', 'Read', 'Grep', 'Glob', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent'] }, async ($, e, next) => {
    await noteTool($, e, next.origin.plugin)
    return next(e)
  })

  // Only the site writes to `commands` of the live page. The agent runs as the owner, so it could write an approval itself: a call that does not come from
  // this plugin (the engine's, the model's) can read the rows but never write them. `next.origin` is set by the host, not by the caller.
  on('tool.call', { tool: 'ArtifactData' }, async ($, e, next) => {
    const urls = new Set([...(((await $.store.get(ALL_URLS_KEY)) as string[] | undefined) ?? []), await urlOf($), (await $.store.get('livePageUrl')) as string | undefined]) // every page of the mod, and the old shared one
    const action = (e as any).action as string
    const collections: unknown[] = action === 'batch' ? ((e as any).writes ?? []).map((w: any) => w?.collection) : [(e as any).collection]
    const writes = !['get', 'list', 'query', 'profiles'].includes(action)
    if (
      writes &&
      next.origin.plugin !== $.plugin.name &&
      urls.has(String((e as any).url).split(/[?#]/)[0]) &&
      collections.some(c => typeof c !== 'string' || c === 'commands' || c.startsWith('commands/'))
    ) {
      return { deny: 'The commands of the ZeremAI site are written by the site only. Only the user presses its buttons.' } as never
    }
    return next(e)
  })

  // The script has run when `next` answers, whichever hook sits above or beneath this one.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    await noteTool($, e, next.origin.plugin)
    const result = await next(e)
    if (runsScript((e as any).command)) {
      await ensureTimer($)
      await push($)
      if (createdFlow((e as any).command, result)) await tip($)
    }
    return result
  })

  // A click on the page also sends a hint on the room. The hint carries nothing we use: it only wakes the drain, which reads the rows from the database and
  // checks each one. The hook takes the event, so the model never reads it. If the room is off, the timer above still reads the click, within 30 seconds when idle.
  on('session.receive', async ($, e, next) => {
    if ((e as any).event?.source !== 'artifact-room') return next(e)
    hotUntil = ticks + HOT_TICKS
    void drain($).catch(() => {})
    return { consumed: 'zeremai click hint' } as never
  })

  // The heartbeat must not depend on a surface that draws the band: it starts with the session, and again after each reload of the plugin.
  for (const isInteractive of [true, false]) {
    on('session.start', { isInteractive }, async ($, e, next) => {
      void ensureTimer($).catch(error => $.store.set(ERR_KEY, message(error)).catch(() => {}))
      void checkForUpdate($).catch(() => {})
      void checkTemplates($).catch(() => {})
      return next(e)
    })
  }

  // The band above the prompt draws at the start of the session: the only hook that is sure to run before the user does anything. It draws nothing.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!timer && !starting) void ensureTimer($).catch(() => {})
    return next(e)
  })

  // Every word of /zeremai:init opens the site. It is published the first time.
  on('command.run', { command: COMMANDS }, async ($, e) => {
    if (
      String(e.args ?? '')
        .trim()
        .split(/\s+/)[0]
        ?.toLowerCase() === 'help'
    )
      return { text: HELP } as never
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
      return { text: `ZeremAI ${opened ? 'opened' : 'link'}: ${link}\nTool calls of the mod in the last minute: ${callsLastMinute()}${problem ? `\nThe last write failed: ${problem}` : ''}` } as never
    } catch (error) {
      if (error instanceof NoVerdict) return { text: await offerRules($) } as never
      return { text: `Could not set up ZeremAI: ${message(error)}` } as never
    }
  })

  // /zeremai:marketplace <verb>: the Marketplaces screen as words. An open site reads the change at once.
  on('command.run', { command: ['zeremai:marketplace'] }, async ($, e) => {
    const yes = 'Yes, remove'
    const text = await runMarketplaceCommand(await templatePortsOf($), String(e.args ?? ''), async q => (await $.ui.ask(q, [yes, 'Cancel']).catch(() => '')) === yes)
    await pushTemplates($)
    return { text } as never
  })
}
