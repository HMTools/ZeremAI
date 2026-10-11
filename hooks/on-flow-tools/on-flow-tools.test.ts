import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`
const NEW = `${ACTIVE}/new1`
const TOOL = (name: string) => `mcp__zeremai__${name}`
const flowFile = JSON.stringify({ status: 'running', metadata: { lastUpdated: 'then' }, currentState: {}, steps: [{ id: 's1', name: 'Design', status: 'pending' }] })

// fake disk: one flow folder bound to session S1, and a template to create another from; writes land on the disk
function world(on: On, { bound = 'S1', env = { HOME: '/h' } as Record<string, string> } = {}) {
  const all: Record<string, string> = {
    [`${DIR}/flow.json`]: flowFile,
    '/t/tpl.json': JSON.stringify({ name: 'T', steps: [{ name: 'Only', stepRef: '' }] }),
  }
  const registered: string[] = []
  const toasts: string[] = [], lines: string[] = []
  mock.env(on, env)
  const store: Record<string, unknown> = { [`session:${bound}`]: [DIR] }
  on('store.get', async (_$, e: any) => ({ value: store[e.key] as never }))
  on('store.set', async (_$, e: any) => { store[e.key] = e.value; return { value: undefined } as never })
  on('store.delete', async (_$, e: any) => { delete store[e.key]; return { value: undefined } as never })
  on('session.id', async () => ({ value: 'S1' }))
  on('session.cwd', async () => ({ value: '/work' }))
  on('fs.list', async (_$, e) => {
    const names = [...new Set(Object.keys(all).filter(p => p.startsWith(`${e.path}/`)).map(p => p.slice(e.path.length + 1).split('/')[0]))]
    return { value: names.map(name => ({ name, kind: Object.keys(all).some(p => p.startsWith(`${e.path}/${name}/`)) ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.exists', async (_$, e) => ({ value: e.path in all || Object.keys(all).some(p => p.startsWith(`${e.path}/`)) }))
  on('fs.read', async (_$, e) => ({ value: all[e.path] }))
  on('fs.write', async (_$, e) => { all[e.path] = e.text; return { value: undefined } })
  on('tool.register', async (_$, e: any) => { registered.push(e.name); return { value: { tool: `mcp__zeremai__${e.name}` } } as never })
  on('prompt.submit', async () => ({ drop: 'test' }))
  on('tool.call', async () => ({ result: 'done', text: 'done' }) as never)
  on('session.start', async () => ({ cwd: '/work' }) as never)
  on('ui.toast', async (_$, e: any) => { toasts.push(e.text); return { value: undefined } as never })
  on('ui.status', async (_$, e: any) => { lines.push(e.text); return { value: undefined } as never })
  return { all, registered, store, toasts, lines }
}
const answer = (r: any) => JSON.parse(r.result.content[0].text)

test('a flow tool runs and answers with the script-style result', async ($, on) => {
  const w = world(on)
  const r = await $.tool.call({ tool: TOOL('update_step_status'), flowDir: DIR, stepId: 's1', status: 'in_progress' })
  expect(answer(r)).toEqual({ status: 'ok', files_written: ['flow.json'] })
  expect(JSON.parse(w.all[`${DIR}/flow.json`]).steps[0].status).toBe('in_progress')
})
test('a failing rule is an error result, and the model can read the message', async ($, on) => {
  world(on)
  const r = await $.tool.call({ tool: TOOL('update_step_status'), flowDir: DIR, stepId: 'zzz', status: 'completed' })
  expect(r.result.isError).toBe(true)
  expect(answer(r)).toEqual({ status: 'error', message: 'Step zzz not found' })
})
test('create_flow binds the new flow to the session', async ($, on) => {
  const w = world(on)
  const r = await $.tool.call({ tool: TOOL('create_flow'), flowDir: NEW, templatePath: '/t/tpl.json' })
  expect(answer(r).status).toBe('ok')
  expect(w.store['session:S1']).toEqual([DIR, NEW]) // the newest goes last, and answers first
})
test('bind_flow links a resumed flow to the new session', async ($, on) => {
  const w = world(on, { bound: 'old' })
  const r = await $.tool.call({ tool: TOOL('bind_flow'), flowDir: DIR })
  expect(answer(r).status).toBe('ok')
  expect(w.store['session:S1']).toEqual([DIR])
})
test('bind_flow on a wrong folder is an error result', async ($, on) => {
  world(on)
  const r = await $.tool.call({ tool: TOOL('bind_flow'), flowDir: '/h/elsewhere' })
  expect(r.result.isError).toBe(true)
})
test('create_flow that fails binds nothing', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: TOOL('create_flow'), flowDir: NEW, templatePath: '/nope.json' })
  expect(w.store['session:S1']).toEqual([DIR])
})
test('a prompt in a session with a flow lists the tools, once', async ($, on) => {
  const w = world(on)
  await $.prompt.submit({ text: 'continue' })
  await $.prompt.submit({ text: 'and again' })
  expect(w.registered.length).toBe(17)
  expect(w.registered).toContain('create_flow')
  expect(w.registered).toContain('request_approval')
})
test('Windows has USERPROFILE and no HOME: the flow is still found', async ($, on) => {
  const w = world(on, { env: { USERPROFILE: '/h', OS: 'Windows_NT' } })
  await $.prompt.submit({ text: 'continue' })
  expect(w.registered.length).toBe(17)
})
test('a prompt in a session with no flow lists nothing', async ($, on) => {
  const w = world(on, { bound: 'other' })
  await $.prompt.submit({ text: 'hello' })
  expect(w.registered).toEqual([])
})

const finding = (status: string) => ({ id: 'f', status })
test('a session start with open findings shows one message; with none, nothing', async ($, on) => {
  const w = world(on)
  w.all['/h/.claude/zeremai/improvement-findings/T/pid.json'] = JSON.stringify({ findings: [finding('open'), finding('open'), finding('applied')] })
  await $.session.start({ source: 'startup', cwd: '/work' })
  expect(w.toasts).toEqual(['2 improvement findings wait. Run /zeremai:apply-improvements to review them.'])
  w.all['/h/.claude/zeremai/improvement-findings/T/pid.json'] = JSON.stringify({ findings: [finding('applied')] })
  await $.session.start({ source: 'startup', cwd: '/work' })
  expect(w.toasts).toHaveLength(1)
})
test('the line under the prompt follows the step tools, and clears when the flow finishes', async ($, on) => {
  const w = world(on)
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', timedOut: false } }) as never)
  await $.tool.call({ tool: TOOL('update_step_status'), flowDir: DIR, stepId: 's1', status: 'in_progress' })
  expect(w.lines.at(-1)).toBe('Step 1 of 1 · Design')
  await $.tool.call({ tool: TOOL('update_flow_status'), flowDir: DIR, status: 'completed' })
  expect(w.lines.at(-1)).toBe('')
})
