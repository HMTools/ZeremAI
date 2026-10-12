import type { Register } from 'claude-code'
import { findFlowDir, readFlow, sessionKey } from '../infra/flow-repository/flow-repository'
import { approveFromPane, gateForPane, requestChangesFromPane } from '../infra/approval-gate/approval-gate'
import type { AnswerLog } from '../infra/approval-gate/approval-gate'
import { logInteraction } from '../infra/log-first/log-first'
import type { Approver } from '../infra/approval-gate/approval-gate'
import type { PaneAnswer } from '../infra/approval-gate/approval-gate'
import type { Gate, GateStore } from '../infra/ports/ports'
import type { FileSystem, ManagerPorts } from '../infra/ports/ports'
import { fillFields, fillQuestion, parseAnswer } from '../infra/flow-pane/fill-fields'
import type { TemplateInfo } from '../infra/flow-pane/flow-pane'
import { boundView, fingerprint, stepDetail, listFlows, listTemplates, resumeFlow, waitingCount } from '../infra/flow-pane/flow-pane'
import { activityOf, ago } from '../infra/flow-pane/activity'
import { bandView } from '../infra/flow-pane/band'
import type { Started } from '../infra/flow-pane/flow-pane'
import { LOOK, needsUser, symbolOf } from '../infra/flow-pane/status-look'
import { moveCommands, slash } from '../infra/flow-manager/move'
import { approveStep, runScript, scriptNote } from '../infra/flow-manager/script'
import { richKit } from './rich-ui'
import { pandaSvg, poseOf } from '../infra/flow-pane/panda'
import { filesView, logView, memoryView, tabCounts } from '../infra/flow-pane/flow-views'
import { stepLine } from '../infra/flow-pane/step-line'
import { catalog, listMarketplaces } from '../infra/templates/templates'
import type { TemplatePorts } from '../infra/templates/templates'
import { startCountingAgain } from '../on-agent-stopping/on-agent-stopping'
import { COMMANDS, PANE, REFRESH_MS, TABS, say, st } from './pane-state'
import type { Ctx } from './ctx'
import { boundScreen } from './screens/bound'
import { continueScreen } from './screens/continue'
import { formScreen, newScreen } from './screens/new'
import { sourcesScreen } from './screens/sources'

// The command /zeremai opens a pane. With no flow bound to the session it has three tabs. New: pick a template, fill its fields, Create.
// Continue: pick a flow (this folder or all folders). Templates: refresh the marketplaces, install, update or remove a template. Either way the mod does the files and the session link itself, lists the flow
// tools, and sends the agent one message (see handoff in infra/flow-pane). The agent then runs the steps with the flow-run skill.
// With a flow bound to the session, the pane shows that one flow and its steps. A button above the prompt opens the pane, and a timer keeps the waiting count current.


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
const portsOf = ($: any): ManagerPorts => ({
  files: filesOf($),
  write: (path, text) => $.fs.write(path, text),
  move: async (from, to) => {
    const windows = (await $.env.get('OS')) === 'Windows_NT'
    for (const argv of moveCommands(windows, from, to)) {
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
})
async function pythonOf($: any): Promise<string> { return (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3' } // Windows has no python3 command
// The answer of the user in the pane is logged by the mod, like a prompt (a model writes the details).
const answerLog = ($: any): AnswerLog => (dir, request) => logInteraction({ files: filesOf($), links: linksOf($), complete: r => $.model.complete(r), script: portsOf($).script }, dir, request)
// The script writes `approved` (approve-step).
const approverOf = ($: any): Approver => async (dir, stepId) => approveStep(argv => $.process.run(argv, { timeoutMs: 60_000 }), await pythonOf($), slash($.plugin.root), dir, stepId)

const templatePortsOf = async ($: any): Promise<TemplatePorts> => ({
  files: filesOf($),
  write: (path, text) => $.fs.write(path, text),
  now: () => new Date().toISOString(),
  pluginRoot: slash($.plugin.root),
  windows: (await $.env.get('OS')) === 'Windows_NT',
  run: argv => $.process.run(argv, { timeoutMs: 120_000 }), // a clone can take a while
})

// The line under the prompt. Mods cannot share a function that takes `$` across files, so on-flow-tools has the same one.
async function showStepLine($: any, dir: string): Promise<void> {
  try { await $.ui.status(await stepLine(filesOf($), dir)) } catch { /* a surface that cannot draw it */ }
}

// Run one template job, then read the catalog and the installed templates again. A failure is shown in the pane.
// `busy` names the job: its button says so while the job runs, and a second press does nothing.
async function templateJob($: any, job: (ports: TemplatePorts) => Promise<string | void>, busy?: string): Promise<void> {
  if (st.busy) return
  try {
    const ports = await templatePortsOf($)
    st.sure = undefined // any other action takes the first Remove press back
    st.busy = busy
    if (busy) $.ui.invalidate('ui.render') // draw the busy button before the job starts
    say('success', (await job(ports)) ?? '')
    ;[st.entries, st.templates, st.markets] = await Promise.all([catalog(ports), listTemplates(filesOf($)), listMarketplaces(ports)])
  } catch (error) { say('error', error instanceof Error ? error.message : String(error)) }
  st.busy = undefined
  $.ui.invalidate('ui.render')
}

// Claude fills the Start form from the text. A fork of the session knows what was talked about; a new session has nothing to fork, so a fresh call answers.
// The reply is only text for the fields: it is read as JSON, and the user presses Create.
async function fillJob($: any, template: TemplateInfo, purpose: string, text: string): Promise<void> {
  if (st.busy) return
  if (!text.trim()) { say('error', 'Write what you want first.'); $.ui.invalidate('ui.render'); return }
  st.busy = 'fill'
  $.ui.invalidate('ui.render') // draw the busy button before the call starts
  try {
    const question = fillQuestion(template, purpose, st.values, text)
    let reply: any = await $.model.fork({ prompt: question })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork') reply = await $.model.complete({ model: 'sonnet', prompt: question, timeoutMs: 30_000 })
    if (!reply.isAnswered) say('error', `Claude gave no answer (${reply.reason}).`)
    else {
      const parsed = parseAnswer(template, reply.text)
      if ('error' in parsed) say('error', parsed.error)
      else {
        const done = fillFields(template, st.values, parsed.answer)
        st.values = done.values
        st.filled = new Set([...st.filled, ...done.filled])
        st.offers = done.offers
        st.openFields = done.open
        say('success', done.filled.length || Object.keys(done.offers).length ? '' : 'Nothing in your text fits a field.')
      }
    }
  } catch (error) { say('error', error instanceof Error ? error.message : String(error)) }
  st.busy = undefined
  $.ui.invalidate('ui.render')
}

// The flow is bound. Show its steps in the pane and hand it to the agent as the user's own prompt.
// The prompt hook skips prompts from the plugin, so the work it does for a user prompt is done here.
const gatesOf = ($: any): GateStore => ({
  get: async sessionId => ((await $.store.get(`gate:${sessionId}`)) as Gate | undefined) ?? undefined,
  set: (sessionId, gate) => $.store.set(`gate:${sessionId}`, gate),
  clear: sessionId => $.store.delete(`gate:${sessionId}`),
})
// The approval step of a flow, and what the pane may do with it: the same facts the approval dialog works from.
async function paneGate($: any, dir: string) {
  return gateForPane(await readFlow(filesOf($), dir), await gatesOf($).get(await $.session.id()), dir)
}
// An answer from the gate card: an error shows in the pane, an approval or a change request reaches the agent as a prompt, like the dialog's answer.
async function answerGate($: any, answer: PaneAnswer): Promise<void> {
  if ('error' in answer) say('error', answer.error)
  else { say('info', ''); st.changing = false; st.reason = ''; $.prompt.submit({ text: answer.text }) } // not awaited: it resolves when the turn starts
  $.ui.invalidate('ui.render')
}
// The session lets go of the bound flow. The files stay; the guards and the line under the prompt stop. A parent flow, if there is one, is bound again.
async function closeFlow($: any): Promise<void> {
  const id = await $.session.id()
  const dirs = (((await $.store.get(sessionKey(id))) as string[] | undefined) ?? []).filter(d => d !== st.boundDir)
  await $.store.set(sessionKey(id), dirs)
  try { await $.ui.status(undefined) } catch { /* a surface that cannot draw it */ }
  st.boundDir = await findFlowDir(filesOf($), linksOf($), id)
  st.view = 'list'
  st.tab = 'continue'
  st.shown = st.boundDir
  st.openStep = undefined
  say('success', 'Closed. This session no longer works on that flow.')
  $.ui.invalidate('ui.render')
}
async function resumeAndHandOff($: any, dir: string, note?: string): Promise<void> { await handOff($, await resumeFlow(portsOf($), dir, note)) }
let ruleShown = false // the permission rule is said once for each run of the mod
async function handOff($: any, started: Started, toast?: string): Promise<void> {
  if ('error' in started) { say('error', started.error); $.ui.invalidate('ui.render'); return }
  // The pane moves to the new flow first: a setup step that fails or hangs must not keep the user on the form (Create and Resume both come here).
  st.boundDir = started.dir
  st.view = 'flow'
  st.shown = started.dir
  st.openStep = undefined
  st.section = 'steps'
  st.message = ''
  $.ui.invalidate('ui.render')
  let text = started.text
  try {
    text += `\n${scriptNote(slash($.plugin.root), await pythonOf($))}` // the agent runs the flow script with Bash, one command form
    await showStepLine($, started.dir)
    startCountingAgain()
    if (toast) { try { await $.ui.toast(toast) } catch { /* a surface that cannot show a toast */ } }
    if (!ruleShown) {
      ruleShown = true
      try { await $.ui.toast(`Claude runs the flow script with Bash. To skip the prompts, allow Bash(${await pythonOf($)} ${slash($.plugin.root)}/scripts/flow_manager.py *) in your settings.`) } catch { /* a surface that cannot show a toast */ }
    }
  } catch (error) {
    say('error', `The flow started, but setup failed: ${error instanceof Error ? error.message : String(error)}. Press Resume to try again.`)
    $.ui.invalidate('ui.render')
    return // the agent gets nothing
  }
  $.prompt.submit({ text, asUser: true }) // not awaited: it resolves when the turn starts
}

// Read every flow again, and say so with a toast when one starts to need the user. The first look raises none.
// The pane redraws only when the list, or what the open bound view reads, changed. A redraw cannot then swallow a click.
async function refresh($: any): Promise<void> {
  let changed = true
  st.ticks++
  let expired = false
  if (st.message && st.ticks - st.at >= 2) { say('info', ''); expired = true } // a result stays for 5 to 10 seconds
  if (st.sure && st.ticks - st.sureAt >= 1) { st.sure = undefined; expired = true } // the first Delete or Remove press is taken back
  try {
    st.flows = await listFlows(filesOf($))
    const now = Date.now()
    const print = fingerprint(st.flows) + st.flows.map(p => `${activityOf(p.kind, p.lastLogMs, now)?.text ?? ''}${ago(p.updatedMs, now)}`).join('|') // the minute text is part of what the pane draws
    const viewPrint = await viewFingerprint($)
    changed = expired || print !== st.lastPrint || viewPrint !== st.lastViewPrint
    st.lastPrint = print
    st.lastViewPrint = viewPrint
    const needing = st.flows.filter(p => needsUser(p.kind))
    if (st.primed) for (const p of needing) if (!st.seen.has(p.dir)) await $.ui.toast(`${p.name} ${LOOK[p.kind].word}`)
    st.seen = new Set(needing.map(p => p.dir))
    st.primed = true
  } catch { /* keep the last list */ }
  if (changed) $.ui.invalidate('ui.render')
}

// What the open tab of a bound flow reads: only that tab (the counts of the other two come from folder listings).
export async function readViews(files: FileSystem, dir: string) {
  const [mem, logs, rows, counts] = await Promise.all([
    st.section === 'memory' ? memoryView(files, dir) : Promise.resolve({ topics: [], history: [], diffs: [] } as Awaited<ReturnType<typeof memoryView>>),
    st.section === 'logs' ? logView(files, dir) : Promise.resolve([] as Awaited<ReturnType<typeof logView>>),
    st.section === 'files' ? filesView(files, dir) : Promise.resolve([] as Awaited<ReturnType<typeof filesView>>),
    tabCounts(files, dir),
  ])
  return { mem, logs, rows, counts }
}
// A text that changes when what the pane would draw for the bound flow changes.
async function viewFingerprint($: any): Promise<string> {
  if (st.view !== 'flow' || !st.shown) return ''
  const files = filesOf($)
  const detail = st.openStep ? await stepDetail(files, st.shown, st.openStep) : undefined
  return JSON.stringify([await boundView(files, st.shown), detail, detail ? undefined : await readViews(files, st.shown), await paneGate($, st.shown)])
}

// The saved folder switch, and the timer that keeps the count and the badge current. A mod has no file watcher.
async function ensureLoaded($: any): Promise<void> {
  if (!st.loaded) {
    st.loaded = true
    st.allFolders = (await $.store.get('allFolders')) === true
    st.favorites = new Set(((await $.store.get('favorites')) as string[] | undefined) ?? [])
    st.debugClicks = (await $.store.get('debugClicks')) === true
    const look = await $.store.get('look')
    if (typeof look === 'number' && look >= 0 && look <= 4) st.look = look
  }
  if (!st.timer) {
    try { st.timer = $.clock.every(REFRESH_MS, () => refresh($)) } catch { /* no timer: the pane refreshes when it opens */ }
    void refresh($)
  }
}

// Open the pane the way the command does: the bound flow if the session has one, else the list. A tab name picks the list.
async function openPane($: any, named?: (typeof TABS)[number], rest = ''): Promise<void> {
  const files = filesOf($)
  await ensureLoaded($)
  ;[st.templates, st.flows] = await Promise.all([listTemplates(files), listFlows(files)])
  try { const ports = await templatePortsOf($); [st.entries, st.markets] = await Promise.all([catalog(ports), listMarketplaces(ports)]) } catch { /* no catalog: the list shows what is installed */ }
  st.detailKey = undefined
  st.boundDir = await findFlowDir(files, linksOf($), await $.session.id())
  st.view = !named && st.boundDir ? 'flow' : 'list'
  st.shown = st.boundDir
  st.openStep = undefined
  st.section = 'steps'
  st.tab = named ?? (st.templates.length || !st.flows.length ? 'new' : 'continue')
  st.chosen = undefined
  st.values = {}
  st.message = ''
  st.firstArg = rest
  await $.ui.open({ id: PANE, title: 'Flow', focus: true, closeOnEscape: true })
}

// A file never opens inside the pane. The terminal hands it to the editor (`code`). Desktop hands it to the system opener, which is the
// nearest thing the mods API has to a built-in viewer. Says why, with the path, when nothing opened.
async function openInViewer($: any, path: string, surface: string): Promise<string> {
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const tries: string[][] = surface === 'desktop'
    ? windows ? [['cmd', '/c', 'start', '', path]] : [['open', path], ['xdg-open', path]]
    : [['code', '--goto', path]]
  for (const argv of tries) {
    const run = await $.process.run(argv).catch(() => undefined)
    if (run && run.exitCode === 0) return ''
  }
  return `Could not open the file with ${tries.map(t => t[0]).join(' or ')}. The file is ${path}`
}

const HELP = ['/zeremai          open the pane: the bound flow, or the list', '/zeremai new      pick a template and start a flow', '/zeremai continue pick a flow to go on with',
  '/zeremai templates  add or refresh marketplaces', '/zeremai <text>   start from a template, with the text in its first field', '/zeremai debug    toasts for each press, to find a lost click', '/zeremai look 0-4  how much color Desktop draws; 0 is none'].join('\n')
const WORDS = ['new', 'continue', 'templates', 'help', 'debug', 'look']
// The number of single-letter edits between two words: enough to tell a typo from a first field.
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) { const tmp = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp }
  }
  return row[b.length]
}

export const register: Register = on => {
  // The command is registered in on-flow-tools: a plugin can have only one session.start hook without a matcher.
  // A first word that is a tab name opens that tab. Any other text goes to the first field, as before.
  on('command.run', { command: COMMANDS }, async ($, e) => {
    const text = String(e.args ?? '').trim()
    const [word = '', ...others] = text.split(/\s+/)
    if (word.toLowerCase() === 'debug') { // /zeremai debug: show a toast for each press and focus move, to find a lost click
      await ensureLoaded($)
      st.debugClicks = !st.debugClicks
      await $.store.set('debugClicks', st.debugClicks)
      return { text: `Click debug ${st.debugClicks ? 'on: each press and focus move shows a toast' : 'off'}` } as never
    }
    if (word.toLowerCase() === 'look') { // /zeremai look 0..4: if the pane draws nothing on Desktop, a color the app refuses is the cause; 0 is the old look
      await ensureLoaded($)
      const level = Number(others[0])
      if (!Number.isInteger(level) || level < 0 || level > 4) return { text: `Look is ${st.look}. Give 0 to 4: 0 no color, 1 cards and group titles, 2 + the ground, 3 + colored buttons and chips, 4 + the ground fills the height.` } as never
      st.look = level
      await $.store.set('look', level)
      $.ui.invalidate('ui.render')
      return { text: `Look ${level} set.` } as never
    }
    if (word.toLowerCase() === 'help') return { text: HELP } as never
    const named = TABS.find(t => t === word.toLowerCase())
    const close = !named && !others.length ? WORDS.find(w => word.length > 3 && distance(w, word.toLowerCase()) <= 2) : undefined
    if (close) return { text: `Did you mean "/zeremai ${close}"? Text that is not a tab name goes into the first field of the template you pick.` } as never
    await openPane($, named, named ? others.join(' ') : text)
    return {}
  })

  // The debug switch: say what reached the mod, and how long after the last draw.
  on('ui.press', async ($, e, next) => {
    if (st.debugClicks && e.requestId === PANE) await $.ui.toast(`press ${e.element}  +${((Date.now() - st.lastDraw) / 1000).toFixed(1)} s since the last draw`)
    return next(e)
  })
  on('ui.focus', async ($, e, next) => {
    if (st.debugClicks && e.requestId === PANE) await $.ui.toast(`focus ${e.element ?? '(engine)'}  +${((Date.now() - st.lastDraw) / 1000).toFixed(1)} s since the last draw`)
    return next(e)
  })

  // After /clear, /resume and /branch the saved folder switch is read again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    st.loaded = false
    await ensureLoaded($)
    return next(e)
  })

  // The button above the prompt: always there, with the count of flows that need the user. Key 1 opens the pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await ensureLoaded($)
    const { Box, Button, Text } = $.ui.resolve(e)
    const band = bandView(st.flows, st.boundDir, Date.now())
    const theirs = await next(e).catch(() => undefined) // a mod after this one that fails must not blank the button
    return Box({
      flexDirection: 'column',
      children: [
        // The parts carry a theme color each (a state is also a word and a symbol, never color alone).
        Button({ key: 'band-open', plain: true, dimColor: !band.hot && !st.boundDir, onPress: () => openPane($),
          children: band.parts.map(part => (part.tone ? Text({ children: [part.text], ...(part.tone === 'dim' ? { dimColor: true } : { color: part.tone }) }) : part.text)) }),
        ...(theirs ? [theirs] : []), // keep what the mods after this one draw
      ],
    })
  })

  // A press on a node of the graph (a Client on Desktop). The data comes from code that runs on the drawing side: check it.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { go?: unknown; id?: unknown; dir?: unknown } | null
    if (e.element !== 'graph' || !data || typeof data !== 'object') return next(e)
    if (data.go === 'step' && typeof data.id === 'string') st.openStep = data.id
    else if (data.go === 'open' && typeof data.dir === 'string') { st.shown = data.dir; st.openStep = undefined }
    else return {}
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Input, Svg, Client } = $.ui.resolve(e) as any // Svg and Client: the Desktop app (and Client the terminal) only
    const redraw = () => $.ui.invalidate('ui.render')
    const show = (to: typeof st.tab) => () => { st.tab = to; st.message = ''; st.form = undefined; st.sure = undefined; redraw() }
    const line = (text: string, props: Record<string, unknown> = {}) => Text({ children: [text], ...props })
    const narrow = ((e.props as any).bodyColumns ?? 60) < 52 // short labels, no bar
    const rich = !!Svg && e.surface === 'desktop' // Desktop draws small SVG pictures (see infra/flow-pane/rich): status nodes, bars, a ring. The terminal never does.
    const picture = (source: string, alt: string, width: number, height: number) => Svg({ source, alt, width, height, isInteractive: true })
    const k = rich ? richKit({ Box, Text, Button, Svg }, st.look) : undefined // the Desktop look: cards, pills, chips (see rich-ui)
    // A tab-like button: the open one is the primary button on Desktop, and the other dim text elsewhere.
    const toggle = (key: string, label: string, active: boolean, onPress: () => void) => (k ? k.tab(key, label, active, onPress) : Button({ key, label, plain: true, dimColor: !active, onPress }))
    // A row of tabs: one segmented control on Desktop.
    const tabRow = (buttons: unknown[], right: unknown[] = []) => (k ? k.segmented(buttons, right) : Box({ flexDirection: 'row', columnGap: narrow ? 1 : 3, children: buttons }))
    // A navigation button: a real secondary button on Desktop, plain text elsewhere.
    const nav = (key: string, label: string, onPress: () => void) => Button({ key, label, ...(k ? { variant: 'secondary' } : { plain: true }), onPress })
    const cwd: string = await $.session.cwd()
    const need = waitingCount(st.flows)
    const bound = st.view === 'flow' && st.shown ? await boundView(filesOf($), st.shown) : undefined
    const detail = bound && st.openStep ? await stepDetail(filesOf($), bound.dir, st.openStep) : undefined
    // A draw reads only the open tab. The two tab counts come from folder listings (tabCounts), not from the views.
    st.lastDraw = Date.now()
    const views = bound && !detail ? await readViews(filesOf($), bound.dir) : undefined

    // The two tabs: buttons in a row, and on Desktop a rail with an icon for each.
    const badge = need ? ` ${symbolOf('waiting', false)}${need}` : ''
    const tabDefs = [
      { name: 'new', key: 'tab-new', label: 'New', short: 'New', go: show('new') },
      { name: 'continue', key: 'tab-continue', label: `Continue${badge}`, short: `Cont${badge}`, go: show('continue') },
      { name: 'templates', key: 'tab-sources', label: 'Sources', short: 'Src', go: show('templates') },
    ] as const
    const tabs = tabRow(tabDefs.map(t => toggle(t.key, narrow ? t.short : t.label, st.tab === t.name, t.go)))

    // A card: a round border, the status symbol and word, the step, and a bar. A flow that needs the user has a yellow border.
    const card = (cardKey: string, children: unknown[], hot = false) => Box({
      key: cardKey, flexDirection: 'column', borderStyle: 'round', borderColor: hot ? 'warning' : 'inactive',
      paddingLeft: 1, paddingRight: 1, hover: { borderColor: 'claude' }, children,
    })
    const ctx: Ctx = {
      e, Box, Text, Button, Input, Svg, Client, line, narrow, rich, picture, k, toggle, tabRow, nav, card, redraw, cwd, bound, detail, views,
      files: filesOf($), ports: () => portsOf($), store: { set: (key: string, value: unknown) => $.store.set(key, value) },
      gate: bound ? await paneGate($, bound.dir) : undefined,
      approve: async stepId => answerGate($, await approveFromPane(filesOf($), approverOf($), gatesOf($), await $.session.id(), bound!.dir, stepId, answerLog($))),
      requestChanges: async (stepId, reason) => answerGate($, await requestChangesFromPane(filesOf($), approverOf($), gatesOf($), await $.session.id(), bound!.dir, stepId, reason, answerLog($))),
      close: () => closeFlow($),
      templateJob: (job, busy) => templateJob($, job, busy), fill: (template, purpose, text) => fillJob($, template, purpose, text), resume: (dir, note) => resumeAndHandOff($, dir, note), handOff: (started, toast) => handOff($, started, toast), openInViewer: (path, surface) => openInViewer($, path, surface), refresh: () => refresh($),
    }
    // One strip at the top for every result and error. A symbol and a color say which: never color alone.
    const tone = { info: 'inactive', success: 'success', error: 'error' }[st.kind]
    const strip = st.message ? [k
      ? Box({ key: 'strip', flexDirection: 'row', columnGap: 1, borderStyle: 'round', borderColor: tone, paddingLeft: 1, paddingRight: 1, children: [line({ info: '•', success: '✓', error: '✕' }[st.kind], { color: tone }), line(st.message, { color: tone })] })
      : Box({ key: 'strip', flexDirection: 'row', columnGap: 1, children: [line({ info: '•', success: '✓', error: '✕' }[st.kind], { color: tone }), line(st.message, { color: tone })] })] : []
    let body: unknown[]
    if (st.tab === 'templates') body = await sourcesScreen(ctx)
    else if (st.tab === 'continue') body = await continueScreen(ctx)
    else if (!st.chosen) body = await newScreen(ctx)
    else body = await formScreen(ctx)
    // On Desktop the whole screen sits on one slate ground, not the black of the app.
    const screen = (children: unknown[]) => (k ? k.ground(children) : Box({ flexDirection: 'column', children }))
    if (bound) return screen([...strip, await boundScreen(ctx)])
    // On Desktop the surfer panda stands before the tabs; its pose follows the notice at the top.
    const panda = rich ? pandaSvg(poseOf(st.kind, st.message)) : undefined
    const header = panda ? Box({ key: 'header', flexDirection: 'row', columnGap: 2, alignItems: 'center', children: [picture(panda.source, 'Surfer panda', panda.width, panda.height), tabs] }) : tabs
    return screen([...strip, header, line(' '), ...body])
  })
}
