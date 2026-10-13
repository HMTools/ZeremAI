import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/h/.claude/zeremai'
const URL = 'https://claude.ai/artifact/AbC123'
const flow = { name: 'Old fix', metadata: { lastUpdated: '2026-01-01T10:00:00Z', projectPaths: ['/work'] }, parameters: {}, steps: [{ id: 'a', number: 0, name: 'Design', status: 'pending' }] }
const BAND = {
  plugin: 'zeremai', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', viewport: { columns: 100, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 60, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

// A fake disk (path → text), a store, and stand-ins for the Artifact tool (`opened`) and the system opener (`ran`).
function world(on: On, disk: Record<string, unknown>, { url = '', noOpen = false, opener = 0 } = {}) {
  const files: Record<string, string> = Object.fromEntries(Object.entries(disk).map(([k, v]) => [k, JSON.stringify(v)]))
  const under = (folder: string) => Object.keys(files).filter(p => p.startsWith(`${folder}/`))
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const store: Record<string, unknown> = {}
  if (url) store.livePageUrl = url
  const toasts: string[] = [], opened: string[] = [], ran: string[][] = []
  let code = opener
  on('store.get', async (_$, e: any) => ({ value: store[e.key] }))
  on('store.set', async (_$, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('session.id', async () => ({ value: 'S1' }))
  on('session.cwd', async () => ({ value: '/work' }))
  on('fs.list', async (_$, e) => ({ value: [...new Set(under(e.path).map(p => p.slice(e.path.length + 1).split('/')[0]))].map(name => ({ name, kind: under(`${e.path}/${name}`).length ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.exists', async (_$, e) => ({ value: e.path in files || under(e.path).length > 0 }))
  on('fs.read', async (_$, e) => ({ value: files[e.path] }))
  on('ui.toast', async (_$, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('process.run', async (_$, e: any) => { ran.push(e.argv); return { value: { exitCode: code, stdout: '', stderr: '', timedOut: false } } as never })
  on('tool.call', async (_$, e: any) => {
    if (e.tool === 'Artifact' && e.action === 'open') { if (noOpen) return { result: {}, isError: true, text: 'no browser' } as never; opened.push(e.url); return { result: {}, text: 'shown' } as never }
    return { result: {}, text: '' } as never
  })
  return { files, store, toasts, opened, ran, clock, fail: () => { code = 1 } }
}

const press = async (band: any) => { await band.press({ key: 'band-open' }); await new Promise(r => setTimeout(r, 30)) } // the press starts the open and does not wait for it

test('the band names the bound flow and its state, and ends with the ZeremAI link', async ($, on) => {
  const dir = `${HOME}/active/p1`
  const w = world(on, { [`${dir}/flow.json`]: { ...flow, steps: [{ id: 'a', number: 3, name: 'Gate', status: 'awaiting_approval' }] } })
  w.store['session:S1'] = [dir]
  const band = await $.ui.mount(BAND)
  await w.clock.advance(5000)
  expect(await band.find({ type: 'Text', text: '▲ Old fix · step 1/1 · approve step 3' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'band-open' })).toBeDefined()
})

test('a step that waits puts a count on the button above the prompt', async ($, on) => {
  const w = world(on, { [`${HOME}/active/p1/flow.json`]: { ...flow, steps: [{ id: 'a', number: 0, name: 'Approve', status: 'awaiting_approval' }] } })
  const band = await $.ui.mount(BAND)
  await w.clock.advance(5000)
  expect(await band.find({ type: 'Text', text: '▲1 approve' })).toBeDefined()
})

test('a flow that starts to wait raises one toast within 5 seconds', async ($, on) => {
  const w = world(on, { [`${HOME}/active/p1/flow.json`]: flow })
  const band = await $.ui.mount(BAND) // the first look: nothing needs the user, and no toast
  await w.clock.advance(5000)
  expect(w.toasts).toEqual([])
  w.files[`${HOME}/active/p1/flow.json`] = JSON.stringify({ ...flow, steps: [{ id: 'a', number: 0, name: 'Approve', status: 'awaiting_approval' }] })
  await w.clock.advance(5000)
  await w.clock.advance(5000)
  expect(w.toasts).toEqual(['Old fix waits for you']) // not raised again for the same flow
  await band.unmount()
})

test('a press opens the site with the session after #, through the Artifact tool', async ($, on) => {
  const w = world(on, {}, { url: URL })
  await press(await $.ui.mount(BAND))
  expect(w.opened).toEqual([`${URL}#S1`])
  expect(w.ran).toEqual([])
})

test('a press that the Artifact tool cannot open goes to the system opener', async ($, on) => {
  const w = world(on, {}, { url: URL, noOpen: true })
  await press(await $.ui.mount(BAND))
  expect(w.ran[0]).toEqual(['open', `${URL}#S1`])
  expect(w.toasts).toEqual([])
})

test('a press that nothing can open shows the link in a toast', async ($, on) => {
  const w = world(on, {}, { url: URL, noOpen: true, opener: 1 })
  await press(await $.ui.mount(BAND))
  expect(w.toasts).toEqual([`ZeremAI: ${URL}#S1`])
})

test('a press with no site set up says what to run', async ($, on) => {
  const w = world(on, {})
  await press(await $.ui.mount(BAND))
  expect(w.toasts).toEqual(['Run /zeremai once to set up the site.'])
  expect(w.opened).toEqual([])
})
