import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`
const NEW = `${ACTIVE}/new1`
const flowFile = JSON.stringify({ status: 'running', metadata: { lastUpdated: 'then' }, currentState: { activeStep: { id: 's1' } }, steps: [{ id: 's1', name: 'Design', status: 'pending' }] })
const OK = JSON.stringify({ status: 'ok', files_written: ['flow.json'] })

// A fake disk with one flow folder bound to session S1. `bash` collects the commands that reach Bash (the engine runs them: here a stand-in
// answers). `script` collects what the mod itself runs with $.process.run, which is the flow script.
function world(on: On, { bound = 'S1', stdout = OK } = {}) {
  const all: Record<string, string> = { [`${DIR}/flow.json`]: flowFile }
  const bash: string[] = [], script: { sub: string; input: any }[] = []
  const toasts: string[] = [], lines: string[] = []
  mock.env(on, { HOME: '/h' })
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
  on('process.run', async (_$, e: any) => {
    const [, , sub, , json] = e.argv as string[]
    script.push({ sub, input: JSON.parse(json) })
    const out = sub === 'list-findings' ? JSON.stringify({ status: 'ok', findings: [{ id: 'f1' }, { id: 'f2' }] }) : OK
    return { value: { exitCode: 0, stdout: out, stderr: '', timedOut: false } } as never
  })
  on('prompt.submit', async () => ({ drop: 'test' }))
  on('tool.call', async (_$, e: any) => {
    bash.push(e.command)
    if (stdout === OK && String(e.command).includes(' create-flow ')) all[`${NEW}/flow.json`] = flowFile // the script writes the new flow
    return { result: { stdout, stderr: '', interrupted: false } } as never
  })
  on('session.start', async () => ({ cwd: '/work' }) as never)
  on('ui.toast', async (_$, e: any) => { toasts.push(e.text); return { value: undefined } as never })
  on('ui.status', async (_$, e: any) => { lines.push(e.text); return { value: undefined } as never })
  return { all, bash, script, store, toasts, lines }
}
const cmd = (root: string, sub: string, input: unknown) => `python3 ${root}/scripts/flow_manager.py ${sub} --json '${JSON.stringify(input)}'`
// The plugin folder of the test, read from the refusal of a command that names another script.
async function rootOf($: any): Promise<string> {
  const r: any = await $.tool.call({ tool: 'Bash', command: "python3 /nowhere/scripts/flow_manager.py x --json '{}'" })
  return /script only: (.*)\/scripts\/flow_manager\.py/.exec(r.deny)![1]
}

test('a script command that follows the rules reaches Bash, and the step line follows the step', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  const command = cmd(root, 'update-step-status', { flowDir: DIR, stepId: 's1', status: 'in_progress' })
  const r: any = await $.tool.call({ tool: 'Bash', command })
  expect(w.bash).toEqual([command])
  expect(JSON.parse(r.result.stdout).status).toBe('ok')
  expect(w.lines.at(-1)).toBe('Step 1 of 1 · Design')
})
test('a call with a wrong input never reaches Bash, and the model reads why', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  const r: any = await $.tool.call({ tool: 'Bash', command: cmd(root, 'update-step-status', { flowDir: DIR, stepId: 's1', status: 'nope' }) })
  expect(r.deny).toContain('Invalid status "nope"')
  expect(w.bash).toEqual([])
})
test('a call for a folder of another session never reaches Bash', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  const r: any = await $.tool.call({ tool: 'Bash', command: cmd(root, 'update-step-status', { flowDir: `${ACTIVE}/zzz`, stepId: 's1', status: 'in_progress' }) })
  expect(r.deny).toContain('not a flow of this session')
  expect(w.bash).toEqual([])
})
test('a session with no flow can run create-flow only, and the new flow is then bound', async ($, on) => {
  const w = world(on, { bound: 'other' })
  const root = await rootOf($)
  const r: any = await $.tool.call({ tool: 'Bash', command: cmd(root, 'update-step-status', { flowDir: DIR, stepId: 's1', status: 'in_progress' }) })
  expect(r.deny).toContain('No flow is bound')
  await $.tool.call({ tool: 'Bash', command: cmd(root, 'create-flow', { flowDir: NEW, templatePath: '/h/.claude/zeremai/templates/t.json' }) })
  expect(w.bash).toHaveLength(1)
  expect(w.store['session:S1']).toEqual([NEW])
})
test('create-flow that fails binds nothing', async ($, on) => {
  const w = world(on, { stdout: JSON.stringify({ status: 'error', message: 'Template not found' }) })
  const root = await rootOf($)
  await $.tool.call({ tool: 'Bash', command: cmd(root, 'create-flow', { flowDir: NEW, templatePath: '/h/.claude/zeremai/templates/t.json' }) })
  expect(w.store['session:S1']).toEqual([DIR])
})
test('the agent can never run approve-step', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  const r: any = await $.tool.call({ tool: 'Bash', command: cmd(root, 'approve-step', { flowDir: DIR, stepId: 's1' }) })
  expect(r.deny).toContain('Only the user approves')
  expect(w.bash).toEqual([])
})

test('the log is owed: the mod logs the user\'s prompt through the script, then the call goes on; the next call needs no log', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  await $.prompt.submit({ text: 'make the header blue' })
  const command = cmd(root, 'update-step-status', { flowDir: DIR, stepId: 's1', status: 'in_progress' })
  await $.tool.call({ tool: 'Bash', command })
  expect(w.script).toHaveLength(1)
  expect(w.script[0].sub).toBe('log-interaction')
  expect(w.script[0].input).toMatchObject({ flowDir: DIR, stepId: 's1', request: 'User requested: make the header blue' })
  expect(w.bash).toEqual([command])
  await $.tool.call({ tool: 'Bash', command })
  expect(w.script).toHaveLength(1) // logged once
})
test('a subagent\'s own call is not logged first', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  await $.prompt.submit({ text: 'go' })
  await $.tool.call({ tool: 'Bash', command: cmd(root, 'update-step-status', { flowDir: DIR, stepId: 's1', status: 'in_progress' }), agentId: 'a1' })
  expect(w.script).toEqual([])
  expect(w.bash).toHaveLength(1)
})
test('log-interaction by the agent clears the debt, so the next call is not logged by the mod', async ($, on) => {
  const w = world(on)
  const root = await rootOf($)
  await $.prompt.submit({ text: 'go' })
  await $.tool.call({ tool: 'Bash', command: cmd(root, 'log-interaction', { flowDir: DIR, stepId: 's1', request: 'r', reason: 'r', response: 'r' }) })
  await $.tool.call({ tool: 'Bash', command: cmd(root, 'update-step-status', { flowDir: DIR, stepId: 's1', status: 'in_progress' }) })
  expect(w.script).toEqual([])
})
test('a Bash command that does not run the script goes on as before', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'cat scripts/flow_manager.py' })
  expect(w.bash).toEqual(['ls', 'cat scripts/flow_manager.py'])
})

test('a session start with open findings shows one message, read with the script; the pane command is registered', async ($, on) => {
  const w = world(on)
  await $.session.start({ source: 'startup', cwd: '/work' })
  expect(w.script.map(c => c.sub)).toEqual(['list-findings'])
  expect(w.script[0].input).toEqual({ status: 'open' })
  expect(w.toasts).toEqual(['2 improvement findings wait. Run /zeremai:apply-improvements to review them.'])
})
