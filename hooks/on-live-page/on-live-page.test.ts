import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/h/.claude/zeremai'
const ACTIVE = `${ROOT}/active`
const DIR = `${ACTIVE}/p1`
const URL = 'https://claude.ai/artifact/AbC123'
const flow = { id: 'f1', name: 'Fix', status: 'running', metadata: { template: 'bug', lastUpdated: 'then' }, currentState: { activeStep: { id: 's1' } }, steps: [{ id: 's1', number: 1, name: 'Design', status: 'pending' }] }
const waiting = { ...flow, steps: [{ id: 's1', number: 1, name: 'Design', status: 'in_progress', approvalRequired: true, stepDefinition: { output: { description: 'The design' } } }] }
const other = { id: 'f2', name: 'Other', status: 'running', metadata: { template: 'bug', lastUpdated: 'then' }, currentState: { activeStep: { id: 'x1' } }, steps: [{ id: 'x1', number: 1, name: 'Plan', status: 'pending' }] }
const template = { type: 'template', name: 'bug', category: 'dev', metadata: { title: 'Bug' }, parameters: { required: ['workItemId'], optional: [], definitions: { workItemId: { example: '7' } } }, steps: [{ name: 'Design', stepRef: 'r1' }] }
const remote = { type: 'template', name: 'deploy', category: 'ops', metadata: { title: 'Deploy' }, parameters: { required: [], optional: [] }, steps: [] }
const OK = JSON.stringify({ status: 'ok', files_written: ['flow.json'] })
const ok = { value: { exitCode: 0, stdout: '', stderr: '', timedOut: false } } as never

type Opts = { url?: string; fail?: boolean; page?: boolean; noOpen?: boolean; noFragment?: boolean; stale?: number; flowDoc?: object; gate?: boolean }

// A fake disk with one flow, a store, an in-memory page database that checks versions the way the real one does, and stand-ins for the engine's
// tools (Bash, ArtifactData, Artifact) and for the flow script. `db` is the page database, `data` the batches the mod sent.
function world(on: On, { url = '', fail = false, page = true, noOpen = false, noFragment = false, stale = 0, flowDoc = flow, gate = false }: Opts = {}) {
  const all: Record<string, string> = {
    [`${DIR}/flow.json`]: JSON.stringify(flowDoc),
    [`${ROOT}/templates/flows/dev/bug/bug.json`]: JSON.stringify(template),
    [`${ROOT}/config/marketplaces.json`]: JSON.stringify({ marketplaces: [{ name: 'm1', url: 'u', branch: 'main', enabled: true, priority: 1 }] }),
    [`${ROOT}/cache/sources/m1/templates/flows/ops/deploy/deploy.json`]: JSON.stringify(remote),
  }
  const store: Record<string, unknown> = { 'session:S1': [DIR] }
  if (url) store.livePageUrl = url
  if (gate) store['gate:S1'] = { dir: DIR, stepId: 's1' }
  const db = new Map<string, { data: any; version: number }>([['meta/mod', { data: {}, version: 7 }]])
  const fault = { run: '' }
  const data: any[] = [], published: any[] = [], reads: string[] = [], opened: string[] = [], toasts: string[] = [], sent: { text: string; asUser?: boolean }[] = [], ran: string[][] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  on('store.get', async (_$, e: any) => ({ value: store[e.key] as never }))
  on('store.set', async (_$, e: any) => { store[e.key] = e.value; return { value: undefined } as never })
  on('store.delete', async (_$, e: any) => { delete store[e.key]; return { value: undefined } as never })
  on('session.id', async () => ({ value: 'S1' }))
  on('session.cwd', async () => ({ value: '/work' }))
  on('fs.list', async (_$, e) => {
    const names = [...new Set(Object.keys(all).filter(p => p.startsWith(`${e.path}/`)).map(p => p.slice(e.path.length + 1).split('/')[0]))]
    return { value: names.map(name => ({ name, kind: Object.keys(all).some(p => p.startsWith(`${e.path}/${name}/`)) ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.exists', async (_$, e) => ({ value: e.path in all || (page && e.path.endsWith('/skills/live-flow/page.html')) || Object.keys(all).some(p => p.startsWith(`${e.path}/`)) }))
  on('fs.read', async (_$, e) => ({ value: all[e.path] ?? '<html>' }))
  on('fs.write', async (_$, e) => { all[e.path] = e.text; return { value: undefined } })
  on('ui.toast', async (_$, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('ui.status', async () => ({ value: undefined }) as never)
  on('prompt.submit', async (_$, e: any) => { sent.push({ text: e.text, asUser: e.origin?.asUser ?? e.asUser }); return { text: e.text } })
  on('session.start', async () => ({ cwd: '/work' }) as never)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('model.complete', async (_$, e: any) => ({ value: { isAnswered: true, text: /Fill the fields/.test(e.prompt) ? '{"workItemId":"7421","junk":"x"}' : '{"reason":"Wants it","response":"Done"}', usage: {} } }) as never)
  // The flow script, and the commands a template job runs.
  on('process.run', async (_$, e: any) => {
    const argv: string[] = e.argv
    ran.push(argv)
    if (argv[0] === 'git') return { value: { exitCode: 0, stdout: 'abc123\n', stderr: '', timedOut: false } } as never
    if (argv[0] === 'rm' && fault.run) return { value: { exitCode: 1, stdout: '', stderr: `${fault.run}\n    at run (stack.ts:1)`, timedOut: false } } as never
    if (argv[0] === 'rm') { for (const k of Object.keys(all)) if (k.startsWith(argv[2])) delete all[k]; return ok }
    if (argv[0] === 'cp') { for (const k of Object.keys(all)) if (k.startsWith(`${argv[2]}/`)) all[`${argv[3]}${k.slice(argv[2].length)}`] = all[k]; return ok }
    if (argv[0] === 'mkdir') return ok
    const [, , sub, , json] = argv
    const input = JSON.parse(json)
    let result: Record<string, unknown> = { status: 'error', message: `fake script: ${sub}` }
    if (sub === 'log-interaction') result = { status: 'ok' }
    else if (sub === 'approve-step') { const f = JSON.parse(all[`${input.flowDir}/flow.json`]); f.steps.find((s: any) => s.id === input.stepId).approved = true; all[`${input.flowDir}/flow.json`] = JSON.stringify(f); result = { status: 'ok' } }
    else if (sub === 'create-flow') { all[`${input.flowDir}/flow.json`] = JSON.stringify({ id: 'new1', name: 'bug', status: 'running', parameters: input.params, metadata: { lastUpdated: 'now' }, steps: [{ id: 'n1', number: 1, name: 'Design', status: 'pending' }] }); result = { status: 'ok' } }
    return { value: { exitCode: result.status === 'ok' ? 0 : 1, stdout: JSON.stringify(result), stderr: '', timedOut: false } } as never
  })
  // The page database. A write to a document that exists must name its version, or the whole batch is refused.
  const lines = (collection: string, keep: (d: any) => boolean = () => true) => [...db].filter(([k, v]) => k.startsWith(`${collection}/`) && keep(v.data))
    .map(([k, v]) => JSON.stringify({ id: k.slice(collection.length + 1), data: v.data, version: v.version, updatedAt: 'x' }))
  const holds = (e: any, d: any) => (e.query?.where ?? []).every(([f, op, val]: any[]) => (op === 'eq' ? d[f] === val : op === 'lt' ? String(d[f]) < val : true))
  on('tool.call', async (_$, e: any) => {
    if (e.tool === 'ArtifactData' && (e.action === 'list' || e.action === 'query')) { const l = lines(e.collection, d => holds(e, d)); return { result: {}, text: `${l.length} documents\n${l.join('\n')}` } as never }
    if (e.tool === 'ArtifactData') {
      data.push(e)
      if (fail) return { result: {}, isError: true, text: 'not allowed' } as never
      if (stale-- > 0) return { result: {}, isError: true, text: 'db batch write failed (version_mismatch)' } as never
      const bad = e.writes.find((x: any) => db.has(`${x.collection}/${x.doc_id}`) && db.get(`${x.collection}/${x.doc_id}`)!.version !== x.if_version)
      if (bad) return { result: {}, isError: true, text: `db batch write failed (version_mismatch): ${bad.collection}/${bad.doc_id} carried no matching if_version` } as never
      const out: string[] = []
      for (const x of e.writes) {
        const key = `${x.collection}/${x.doc_id}`, had = db.get(key)
        if (x.op === 'delete') { db.delete(key); out.push(`- delete "${x.collection}"/"${x.doc_id}"`); continue }
        const version = (had?.version ?? 0) + 1
        db.set(key, { data: x.op === 'update' ? { ...had?.data, ...x.data } : x.data, version })
        out.push(`- ${x.op} "${x.collection}"/"${x.doc_id}" (version ${version})`)
      }
      return { result: {}, text: out.join('\n') } as never
    }
    if (e.tool === 'Artifact' && e.action === 'open') {
      if (noOpen || (noFragment && e.url.includes('#'))) throw new Error('no browser')
      opened.push(e.url); return { result: {}, text: 'shown' } as never
    }
    if (e.tool === 'Artifact' && e.action === 'read') { reads.push(e.url); return { result: {}, text: '<html>' } as never }
    if (e.tool === 'Artifact') { published.push(e); return { result: {}, text: `Published ${e.file_path} at ${URL} (Version ${published.length})` } as never }
    return { result: { stdout: OK, stderr: '', interrupted: false } } as never
  })
  return { all, store, db, data, published, reads, opened, toasts, sent, ran, clock, fault }
}
type W = ReturnType<typeof world>
const command = (root: string) => `python3 ${root}/scripts/flow_manager.py update-step-status --json '${JSON.stringify({ flowDir: DIR, stepId: 's1', status: 'in_progress' })}'`
async function rootOf($: any): Promise<string> {
  const r: any = await $.tool.call({ tool: 'Bash', command: "python3 /nowhere/scripts/flow_manager.py x --json '{}'" })
  return /script only: (.*)\/scripts\/flow_manager\.py/.exec(r.deny)![1]
}
const open = ($: any, args = '') => $.command.run({ command: 'zeremai', args }) as Promise<{ text: string }>
const put = (w: W, id: string, action: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  w.db.set(`commands/${id}`, { data: { session: 'S1', at: `2026-10-13T10:00:0${id.length}`, action, args, status: 'new', ...extra }, version: 1 })
const row = (w: W, id: string) => w.db.get(`commands/${id}`)?.data
// A command runs on the timer: open the site (which starts it), let one tick pass, and wait until no command of this session is left.
const settle = async ($: any, w: W) => {
  await open($)
  await w.clock.advance(5000)
  await until(() => ![...w.db].some(([k, v]) => k.startsWith('commands/') && v.data.session === 'S1' && ['new', 'running'].includes(v.data.status)))
}
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)) }

// ── the push ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('with no page link stored, a flow command writes nothing to any page', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: 'Bash', command: command(await rootOf($)) })
  expect(w.data).toEqual([])
})

test('with a link stored, a flow command writes the flow once, and an unchanged flow writes nothing', async ($, on) => {
  const w = world(on, { url: URL })
  const root = await rootOf($)
  await $.tool.call({ tool: 'Bash', command: command(root) })
  const batch = w.data.find(d => d.writes.some((x: any) => x.collection === 'flows' && x.doc_id === 'f1'))
  expect(batch.url).toBe(URL)
  expect(batch.action).toBe('batch')
  const first = w.data.length
  await $.tool.call({ tool: 'Bash', command: command(root) })
  expect(w.data).toHaveLength(first)
})

test('a document that already exists is written with the version the database holds; a wrong version is learned once and retried', async ($, on) => {
  const w = world(on, { url: 'https://claude.ai/artifact/Pinned', stale: 1 })
  await open($)
  const beat = w.data.flatMap(d => d.writes).filter((x: any) => x.doc_id === 'mod')
  expect(w.data.flatMap(d => d.writes).filter((x: any) => x.doc_id === 'f1')).toHaveLength(2) // the first try failed on a wrong version, the retry went through
  expect(beat.map((x: any) => x.if_version)).toEqual([7, 8]) // pinned to the version the database holds, then to the one the last write returned
  expect(w.store.livePageError).toBeUndefined()
})

test('an error that an older copy of the module stored is cleared by the next good push', async ($, on) => {
  const w = world(on, { url: URL })
  w.store.livePageError = 'version_mismatch from before the reload'
  const r = await open($)
  expect(r.text).not.toContain('last write failed')
  expect(w.store.livePageError).toBeUndefined()
})

test('a page that refuses the write never breaks the flow command: the reason is kept', async ($, on) => {
  const w = world(on, { url: URL, fail: true })
  const r: any = await $.tool.call({ tool: 'Bash', command: command(await rootOf($)) })
  expect(JSON.parse(r.result.stdout).status).toBe('ok')
  expect(w.store.livePageError).toBe('not allowed')
})

test('the session row names the folder, the flows it holds and a beat; the templates and marketplaces are written once', async ($, on) => {
  const w = world(on)
  await open($)
  expect(w.db.get('sessions/S1')!.data).toMatchObject({ folder: '/work', name: 'work', flows: ['f1'] })
  expect(typeof w.db.get('sessions/S1')!.data.beat).toBe('string')
  expect(w.db.get('sessions/S1')!.data.openedAt).toBeDefined()
  expect(w.db.get('templates/dev~bug')!.data).toMatchObject({ installed: true, fields: [{ name: 'workItemId', required: true, example: '7' }] })
  expect(w.db.get('templates/ops~deploy')!.data).toMatchObject({ installed: false, state: 'available', marketplace: 'm1' })
  expect(w.db.get('marketplaces/m1')!.data).toMatchObject({ name: 'm1', templates: 1, enabled: true })
})

// ── the command word and the page ────────────────────────────────────────────────────────────────────────────────────

test('/zeremai publishes the page once with its rules, keeps the link, opens it with the session after #, and writes the flows', async ($, on) => {
  const w = world(on)
  const first = await open($)
  expect(first.text).toBe(`ZeremAI opened: ${URL}?s=S1#S1`)
  expect(w.published).toHaveLength(1)
  expect(w.published[0].file_path).toMatch(/skills\/live-flow\/page\.html$/)
  expect(w.published[0].pin).toBe(true)
  for (const path of ['details', 'commands', 'sessions', 'templates', 'marketplaces']) expect(w.published[0].capabilities.db.rules).toContainEqual({ path, read: 'owner', write: 'owner' })
  expect(w.published[0].capabilities.user).toEqual({})
  expect(w.store.livePageUrl).toBe(URL)
  expect(w.opened).toEqual([`${URL}?s=S1#S1`])
  expect(w.data.some(d => d.writes.some((x: any) => x.doc_id === 'f1'))).toBe(true)
  await open($)
  expect(w.published).toHaveLength(1) // the second run only opens the link
  expect(w.opened).toEqual([`${URL}?s=S1#S1`, `${URL}?s=S1#S1`])
})

test('every word of /zeremai opens the site, and "help" says what it does without publishing', async ($, on) => {
  const w = world(on)
  expect((await open($, 'help')).text).toContain('/zeremai')
  expect(w.published).toHaveLength(0)
  expect((await open($, 'new bug 7')).text).toContain('ZeremAI opened')
  expect(w.published).toHaveLength(1)
})

test('when the Artifact tool refuses a link with #, the plain link opens the site', async ($, on) => {
  const w = world(on, { url: URL, noFragment: true })
  const r = await open($)
  expect(r.text).toBe(`ZeremAI opened: ${URL}?s=S1#S1`)
  expect(w.opened).toEqual([URL])
})

test('"sync" writes the row of the session and opens nothing', async ($, on) => {
  const w = world(on, { url: URL })
  expect((await open($, 'sync')).text).toBe('')
  expect(w.db.get('sessions/S1')!.data.openedAt).toBeDefined()
  expect(w.opened).toEqual([])
})

test('/zeremai prints the link when the page cannot be opened', async ($, on) => {
  const w = world(on, { url: URL, noOpen: true })
  const r = await open($)
  expect(r.text).toBe(`ZeremAI link: ${URL}?s=S1#S1`)
  expect(w.opened).toEqual([])
})

test('/zeremai says so when the page file is missing', async ($, on) => {
  world(on, { page: false })
  expect((await open($)).text).toContain('Could not set up ZeremAI')
})

test('a changed page publishes again to the same link with the same rules; an unchanged page does not', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  await open($)
  await open($)
  expect(w.published).toHaveLength(1)
  w.all[`${root}/skills/live-flow/page.html`] = '<html>version 2'
  await open($)
  expect(w.published).toHaveLength(2)
  expect(w.published[1].url).toBe(URL)
  expect(w.published[1].icon).toBeUndefined()
  expect(w.published[1].capabilities).toEqual(w.published[0].capabilities)
  expect(w.reads).toEqual([URL]) // the tool wants a read before it changes a page
  await open($)
  expect(w.published).toHaveLength(2)
})

test('the first flow start shows one message about the site, and only while no page exists', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  const create = `python3 ${root}/scripts/flow_manager.py create-flow --json '${JSON.stringify({ flowDir: DIR, templatePath: `${ROOT}/templates/flows/dev/bug/bug.json`, name: 'Fix' })}'`
  await $.tool.call({ tool: 'Bash', command: create })
  await $.tool.call({ tool: 'Bash', command: create })
  expect(w.toasts).toEqual(['ZeremAI opens a live site for all your flows. Run /zeremai.'])
  w.store.livePageUrl = URL
  w.store.livePageTipped = undefined
  await $.tool.call({ tool: 'Bash', command: create })
  expect(w.toasts).toHaveLength(1)
})

test('the band above the prompt starts the timer: a session with a stored link writes its row without any command', async ($, on) => {
  const w = world(on, { url: URL })
  const band = await $.ui.mount({ plugin: 'zeremai', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', viewport: { columns: 100, rows: 30 },
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 60, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as any)
  await until(() => w.db.has('sessions/S1'))
  expect(w.db.get('sessions/S1')!.data.flows).toEqual(['f1'])
  await band.unmount()
})

// ── the commands from the site ───────────────────────────────────────────────────────────────────────────────────────

test('approve: the same call the pane button made writes approved, the answer is logged, and the agent reads it as a prompt', async ($, on) => {
  const w = world(on, { url: URL, flowDoc: waiting, gate: true })
  put(w, 'c1', 'approve', { flowId: 'f1', stepId: 's1' })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'done', result: 'Approved. Claude carries on.' })
  expect(JSON.parse(w.all[`${DIR}/flow.json`]).steps[0].approved).toBe(true)
  expect(w.ran.some(a => a[2] === 'log-interaction')).toBe(true)
  await until(() => w.sent.length > 0) // the prompt is sent without waiting for the turn
  expect(w.sent[0].text).toContain('approved step 1')
  expect(w.store['gate:S1']).toBeUndefined()
  const states = w.data.flatMap(d => d.writes).filter((x: any) => x.collection === 'commands').map((x: any) => x.data.status)
  expect(states).toEqual(['running', 'done']) // the page sees it run, then finish
})

test('request-changes sends the reason to the agent and does not approve', async ($, on) => {
  const w = world(on, { url: URL, flowDoc: waiting, gate: true })
  put(w, 'c1', 'request-changes', { flowId: 'f1', stepId: 's1', reason: 'Use two tables' })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'done' })
  expect(JSON.parse(w.all[`${DIR}/flow.json`]).steps[0].approved).toBeUndefined()
  await until(() => w.sent.length > 0)
  expect(w.sent[0].text).toContain('Use two tables')
})

test('approve before the agent asked is refused in plain words, and nothing is approved', async ($, on) => {
  const w = world(on, { url: URL, flowDoc: waiting }) // no gate: the agent has not asked yet
  put(w, 'c1', 'approve', { flowId: 'f1', stepId: 's1' })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'error', result: 'The agent has not asked for approval yet.' })
  expect(JSON.parse(w.all[`${DIR}/flow.json`]).steps[0].approved).toBeUndefined()
  expect(w.sent).toEqual([])
})

test('a bad row, an unknown action and a step that does not wait each end as an error with a reason, and run nothing', async ($, on) => {
  const w = world(on, { url: URL, flowDoc: flow })
  put(w, 'c1', 'approve', { flowId: 'f1', stepId: 's1' }) // the step is pending, it does not wait
  put(w, 'c22', 'rm-rf', {})
  put(w, 'c333', 'approve', { flowId: 'f1', stepId: 5 })
  put(w, 'c4444', 'close', { flowId: 'f2' }) // not a flow of this session
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'error', result: 'That step no longer waits for approval.' })
  expect(row(w, 'c22')).toMatchObject({ status: 'error', result: 'Unknown action: rm-rf' })
  expect(row(w, 'c333')).toMatchObject({ status: 'error', result: 'Bad value for stepId.' })
  expect(row(w, 'c4444')).toMatchObject({ status: 'error', result: 'That flow is not bound to this session.' })
  expect(w.ran.filter(a => a[2] === 'approve-step')).toEqual([])
  expect(w.store['session:S1']).toEqual([DIR])
})

test('a command for another session is left alone', async ($, on) => {
  const w = world(on, { url: URL, flowDoc: waiting, gate: true })
  put(w, 'c1', 'approve', { flowId: 'f1', stepId: 's1' }, { session: 'S2' })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'new' })
  expect(w.sent).toEqual([])
})

test('commands run one at a time, the oldest first', async ($, on) => {
  const w = world(on, { url: URL })
  put(w, 'bb', 'refresh-marketplaces', {}, { at: '2026-10-13T10:00:02' })
  put(w, 'aa', 'refresh-marketplaces', {}, { at: '2026-10-13T10:00:01' })
  await settle($, w)
  const order = w.data.flatMap(d => d.writes).filter((x: any) => x.collection === 'commands').map((x: any) => `${x.doc_id}:${x.data.status}`)
  expect(order).toEqual(['aa:running', 'aa:done', 'bb:running', 'bb:done'])
  expect(row(w, 'aa').result).toBe('m1: updated')
})

test('continue binds a running flow to this session and hands it to the agent', async ($, on) => {
  const w = world(on, { url: URL })
  w.all[`${ACTIVE}/p2/flow.json`] = JSON.stringify(other)
  put(w, 'c1', 'continue', { flowId: 'f2', note: 'Retry' })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'done', result: 'Resumed. Claude carries on.' })
  expect(w.store['session:S1']).toEqual([DIR, `${ACTIVE}/p2`])
  await until(() => w.sent.length > 0)
  expect(w.sent[0]).toMatchObject({ asUser: true })
  expect(w.sent[0].text).toContain('I resumed the flow "Other"')
  expect(w.sent[0].text).toContain('Retry')
  expect(w.db.get('sessions/S1')!.data.flows).toEqual(['f1', 'f2']) // the row follows the change at once
})

test('close lets this session go of the flow; the files stay', async ($, on) => {
  const w = world(on, { url: URL })
  put(w, 'c1', 'close', { flowId: 'f1' })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'done' })
  expect(w.store['session:S1']).toEqual([])
  expect(w.all[`${DIR}/flow.json`]).toBeDefined()
  expect(w.db.get('sessions/S1')!.data.flows).toEqual([])
})

test('new-flow creates the flow from the template fields, binds it to this session and hands it to the agent', async ($, on) => {
  const w = world(on, { url: URL })
  put(w, 'c1', 'new-flow', { template: 'dev/bug', workItemId: '7421', ignored: 'x' })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'done', result: 'Started. Claude carries on.' })
  const made = w.ran.find(a => a[2] === 'create-flow')!
  expect(JSON.parse(made[4])).toMatchObject({ params: { workItemId: '7421' }, projectPath: '/work' }) // only the fields of the template, in this session's folder
  expect((w.store['session:S1'] as string[]).length).toBe(2)
  await until(() => w.sent.length > 0)
  expect(w.sent[0].text).toContain('I started the flow')
})

test('new-flow with a missing required field, or a template that is not installed, ends as an error', async ($, on) => {
  const w = world(on, { url: URL })
  put(w, 'c1', 'new-flow', { template: 'dev/bug', workItemId: ' ' })
  put(w, 'c22', 'new-flow', { template: 'dev/none' })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'error' }) // the empty required field is refused before the script runs
  expect(row(w, 'c22')).toMatchObject({ status: 'error', result: 'That template is not installed.' })
  expect(w.ran.filter(a => a[2] === 'create-flow')).toEqual([])
})

test('fill-fields answers with the fields the model could fill, from a fresh call when there is nothing to fork', async ($, on) => {
  const w = world(on, { url: URL })
  put(w, 'c1', 'fill-fields', { template: 'dev/bug', text: 'refunds fail for 0', values: JSON.stringify({ workItemId: 'typed', other: 'x' }) })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'done' })
  expect(JSON.parse(row(w, 'c1').result)).toEqual({ workItemId: '7421' }) // a name that is not a field is dropped
})

test('install and remove a template, and refresh the marketplaces; the template rows follow', async ($, on) => {
  const w = world(on, { url: URL })
  put(w, 'c1', 'install-template', { marketplace: 'm1', category: 'ops', name: 'deploy' })
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'done', result: 'Installed.' })
  expect(w.all[`${ROOT}/templates/flows/ops/deploy/deploy.json`]).toBeDefined()
  expect(w.db.get('templates/ops~deploy')!.data).toMatchObject({ installed: true, state: 'installed' })
  put(w, 'c22', 'remove-template', { category: 'ops', name: 'deploy' })
  await settle($, w)
  expect(row(w, 'c22')).toMatchObject({ status: 'done', result: 'Removed.' })
  expect(w.all[`${ROOT}/templates/flows/ops/deploy/deploy.json`]).toBeUndefined()
  expect(w.db.get('templates/ops~deploy')!.data).toMatchObject({ installed: false, state: 'available' })
})

test('a step that fails ends the row as an error in one plain line, never a stack', async ($, on) => {
  const w = world(on, { url: URL })
  put(w, 'c1', 'remove-template', { category: 'dev', name: 'bug' })
  w.fault.run = 'permission denied'
  await settle($, w)
  expect(row(w, 'c1')).toMatchObject({ status: 'error', result: 'rm failed: permission denied' })
})

test('the timer picks up a command that arrives later, and removes rows older than one day on the beat', async ($, on) => {
  const w = world(on, { url: URL })
  await settle($, w)
  put(w, 'c1', 'refresh-marketplaces', {})
  w.db.set('commands/old', { data: { session: 'S1', at: '1960-01-01T00:00:00.000Z', action: 'close', args: {}, status: 'done' }, version: 1 })
  await w.clock.advance(5000)
  await until(() => row(w, 'c1').status === 'done')
  expect(row(w, 'c1').status).toBe('done')
  for (let i = 0; i < 5; i++) await w.clock.advance(5000) // the sixth tick since the start is the beat
  await until(() => !w.db.has('commands/old'))
  expect(w.db.has('commands/old')).toBe(false)
  expect(w.db.has('commands/c1')).toBe(true) // a new row stays
})

test('the agent cannot write a command row (it runs as the owner and could approve for itself), but it can read them', async ($, on) => {
  const w = world(on, { url: URL })
  put(w, 'c1', 'close', { flowId: 'f1' })
  const set: any = await $.tool.call({ tool: 'ArtifactData', action: 'set', url: URL, collection: 'commands', doc_id: 'x', data: { session: 'S1' } })
  expect(set.deny).toContain('written by the site only')
  const batch: any = await $.tool.call({ tool: 'ArtifactData', action: 'batch', url: URL, writes: [{ op: 'update', collection: 'commands', doc_id: 'c1', data: { status: 'new' }, if_version: 1 }] })
  expect(batch.deny).toContain('written by the site only')
  expect(w.data).toEqual([]) // nothing reached the database
  const read: any = await $.tool.call({ tool: 'ArtifactData', action: 'list', url: URL, collection: 'commands' })
  expect(read.deny).toBeUndefined()
  const other: any = await $.tool.call({ tool: 'ArtifactData', action: 'batch', url: URL, writes: [{ op: 'set', collection: 'notes', doc_id: 'n', data: {} }] })
  expect(other.deny).toBeUndefined() // the rest of the database, and other pages, are not guarded
  const elsewhere: any = await $.tool.call({ tool: 'ArtifactData', action: 'batch', url: 'https://claude.ai/artifact/Other', writes: [{ op: 'set', collection: 'commands', doc_id: 'x', data: {} }] })
  expect(elsewhere.deny).toBeUndefined()
})
