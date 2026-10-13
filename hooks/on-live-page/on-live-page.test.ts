import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`
const URL = 'https://claude.ai/artifact/AbC123'
const flow = { id: 'f1', name: 'Fix', status: 'running', metadata: { template: 'bug', lastUpdated: 'then' }, currentState: { activeStep: { id: 's1' } }, steps: [{ id: 's1', number: 1, name: 'Design', status: 'pending' }] }
const OK = JSON.stringify({ status: 'ok', files_written: ['flow.json'] })

// A fake disk with one flow, a store, and stand-ins for the engine's Bash, ArtifactData and Artifact tools.
function world(on: On, { url = '', fail = false, page = true, noOpen = false, stale = 0 } = {}) {
  const all: Record<string, string> = { [`${DIR}/flow.json`]: JSON.stringify(flow) }
  const store: Record<string, unknown> = { 'session:S1': [DIR] }
  if (url) store.livePageUrl = url
  const data: any[] = [], published: any[] = [], opened: string[] = [], toasts: string[] = []
  mock.env(on, { HOME: '/h' })
  mock.clock(on)
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
  on('prompt.submit', async () => ({ drop: 'test' }))
  on('session.start', async () => ({ cwd: '/work' }) as never)
  on('tool.call', async (_$, e: any) => {
    if (e.tool === 'ArtifactData' && e.action === 'list') return { result: {}, text: `1 document\n${JSON.stringify({ id: 'mod', data: {}, version: 7 })}` } as never
    if (e.tool === 'ArtifactData') {
      data.push(e)
      if (fail) return { result: {}, isError: true, text: 'not allowed' } as never
      if (stale-- > 0) return { result: {}, isError: true, text: 'db batch write failed (version_mismatch)' } as never
      return { result: {}, text: e.writes.map((x: any) => `- ${x.op} "${x.collection}"/"${x.doc_id}" (version ${(x.if_version ?? 0) + 1})`).join('\n') } as never
    }
    if (e.tool === 'Artifact' && e.action === 'open') { if (noOpen) throw new Error('no browser'); opened.push(e.url); return { result: {}, text: 'shown' } as never }
    if (e.tool === 'Artifact') { published.push(e); return { result: {}, text: `Published ${e.file_path} at ${URL} (Version 1)` } as never }
    return { result: { stdout: OK, stderr: '', interrupted: false } } as never
  })
  return { all, store, data, published, opened, toasts }
}
const command = (root: string) => `python3 ${root}/scripts/flow_manager.py update-step-status --json '${JSON.stringify({ flowDir: DIR, stepId: 's1', status: 'in_progress' })}'`
async function rootOf($: any): Promise<string> {
  const r: any = await $.tool.call({ tool: 'Bash', command: "python3 /nowhere/scripts/flow_manager.py x --json '{}'" })
  return /script only: (.*)\/scripts\/flow_manager\.py/.exec(r.deny)![1]
}

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
  await $.command.run({ command: 'zeremai', args: 'live' })
  const beat = w.data.flatMap(d => d.writes).filter((x: any) => x.doc_id === 'mod')
  expect(w.data.flatMap(d => d.writes).filter((x: any) => x.doc_id === 'f1')).toHaveLength(2) // the first try failed on a wrong version, the retry went through
  expect(beat.map((x: any) => x.if_version)).toEqual([7, 8]) // pinned to the version the database holds, then to the one the last write returned
  expect(w.store.livePageError).toBeUndefined()
})

test('a page that refuses the write never breaks the flow command: the reason is kept', async ($, on) => {
  const w = world(on, { url: URL, fail: true })
  const r: any = await $.tool.call({ tool: 'Bash', command: command(await rootOf($)) })
  expect(JSON.parse(r.result.stdout).status).toBe('ok')
  expect(w.store.livePageError).toBe('not allowed')
})

test('/zeremai live publishes the page once with its rules, keeps the link, and writes the flows', async ($, on) => {
  const w = world(on)
  const first: any = await $.command.run({ command: 'zeremai', args: 'live' })
  expect(first.text).toContain(URL)
  expect(w.published).toHaveLength(1)
  expect(w.published[0].file_path).toMatch(/skills\/live-flow\/page\.html$/)
  expect(w.published[0].capabilities.db.rules).toContainEqual({ path: 'details', read: 'owner', write: 'owner' })
  expect(w.store.livePageUrl).toBe(URL)
  expect(w.published[0].pin).toBe(true)
  expect(first.text).toContain('opened')
  expect(w.opened).toEqual([URL])
  expect(w.data.some(d => d.writes.some((x: any) => x.doc_id === 'f1'))).toBe(true)
  await $.command.run({ command: 'zeremai', args: 'live' })
  expect(w.published).toHaveLength(1) // the second run only opens the link
  expect(w.opened).toEqual([URL, URL])
})

test('/zeremai live prints the link when the page cannot be opened', async ($, on) => {
  const w = world(on, { url: URL, noOpen: true })
  const r: any = await $.command.run({ command: 'zeremai', args: 'live' })
  expect(r.text).toBe(`Live page link: ${URL}`)
  expect(w.opened).toEqual([])
})

const BAND = { plugin: 'zeremai', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', viewport: { columns: 100, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 60, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const

test('the band shows a Live page button only when a link is stored, and a press opens the page', async ($, on) => {
  const w = world(on)
  const before = await $.ui.mount(BAND)
  expect(await before.find({ type: 'Button', key: 'band-live' })).toBeUndefined()
  await before.unmount()
  w.store.livePageUrl = URL
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Button', key: 'band-live' })).toBeDefined()
  await band.press({ key: 'band-live' })
  for (let i = 0; i < 100 && !w.opened.length; i++) await new Promise(r => setTimeout(r, 5)) // the press starts the command and does not wait for it
  expect(w.toasts).toEqual([])
  expect(w.opened).toEqual([URL])
})

test('a press that the Artifact tool cannot open goes to the system opener, then to the link in a toast', async ($, on) => {
  const w = world(on, { url: URL, noOpen: true })
  const ran: string[][] = []
  let code = 0
  on('process.run', async (_$, e: any) => { ran.push(e.argv); return { value: { exitCode: code, stdout: '', stderr: '', timedOut: false } } as never })
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'band-live' })
  for (let i = 0; i < 100 && !ran.length; i++) await new Promise(r => setTimeout(r, 5))
  expect(ran[0]).toEqual(['open', URL])
  expect(w.toasts).toEqual([])
  code = 1
  await band.press({ key: 'band-live' })
  for (let i = 0; i < 100 && !w.toasts.length; i++) await new Promise(r => setTimeout(r, 5))
  expect(w.toasts).toEqual([`Live page: ${URL}`])
})

const createCommand = (root: string) => `python3 ${root}/scripts/flow_manager.py create-flow --json '${JSON.stringify({ flowDir: DIR, templatePath: '/h/.claude/zeremai/templates/flows/dev/bug/bug.json', name: 'Fix' })}'`

test('the first flow start shows one message about the page, and only while no page exists', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  await $.tool.call({ tool: 'Bash', command: createCommand(root) })
  await $.tool.call({ tool: 'Bash', command: createCommand(root) })
  expect(w.toasts).toEqual(['A live page shows all your flows. Run /zeremai live.'])
  w.store.livePageUrl = URL
  w.store.livePageTipped = undefined
  await $.tool.call({ tool: 'Bash', command: createCommand(root) })
  expect(w.toasts).toHaveLength(1)
})

test('/zeremai live says so when the page file is missing', async ($, on) => {
  world(on, { page: false })
  const r: any = await $.command.run({ command: 'zeremai', args: 'live' })
  expect(r.text).toContain('Could not set up the live page')
})
