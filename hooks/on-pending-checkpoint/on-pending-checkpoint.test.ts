import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`
const flow = JSON.stringify({ status: 'running', steps: [], currentState: { activeStep: { id: 's7' } } })

// fake disk: one flow folder bound to `bound`; the gate is open or not
function world(on: On, { gate = true, bound = 'S1' } = {}) {
  const all: Record<string, string> = { [`${DIR}/flow.json`]: flow }
  mock.env(on, { HOME: '/h' })
  mock.store(on, { [`session:${bound}`]: [DIR], ...(gate ? { 'gate:S1': { dir: DIR, stepId: 's7' } } : {}) })
  on('session.id', async () => ({ value: 'S1' }))
  on('fs.list', async (_$, e) => ({ value: e.path === ACTIVE ? [{ name: 'p1', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.exists', async (_$, e) => ({ value: e.path in all }))
  on('fs.read', async (_$, e) => ({ value: all[e.path] }))
  on('tool.call', async () => ({ result: 'done', text: 'done' }) as never)
}
const call = ($: any, tool: string, extra = {}) => $.tool.call({ tool, file_path: '/x', content: 'y', ...extra })
const bash = ($: any, command: string) => call($, 'Bash', { command })

// research passes: reads, MCP tools and a subagent
for (const tool of ['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'mcp__x__y']) {
  test(`gate open: ${tool} passes`, async ($, on) => {
    world(on)
    expect((await call($, tool)).deny).toBeUndefined()
  })
}
// writes, edits and Bash wait for the click
for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'TodoWrite']) {
  test(`gate open: ${tool} is refused`, async ($, on) => {
    world(on)
    const r = await call($, tool, { file_path: '/x/notes.md' })
    expect(r.deny).toContain('Approval needed')
    expect(r.deny).toContain('Step ID: s7')
  })
}
test('gate open: Bash is refused', async ($, on) => {
  world(on)
  expect((await bash($, 'ls')).deny).toContain('Approval needed')
})
test('gate open: a command of the flow script passes this check (the gate of the script decides which ones run)', async ($, on) => {
  world(on)
  const r: any = await bash($, "python3 /x/scripts/flow_manager.py log-interaction --json '{}'")
  expect(r.deny === undefined || !String(r.deny).includes('Approval needed')).toBe(true)
})
test('gate open: reading the script is a plain Bash command, so it is refused', async ($, on) => {
  world(on)
  expect((await bash($, 'cat /x/scripts/flow_manager.py')).deny).toContain('Approval needed')
})
test('gate open: a subagent writing is refused too', async ($, on) => {
  world(on)
  expect((await call($, 'Write', { agentId: 'a1' })).deny).toContain('Approval needed')
})
test('no gate: Write passes', async ($, on) => {
  world(on, { gate: false })
  expect((await call($, 'Write', { file_path: '/x/notes.md' })).deny).toBeUndefined()
})
test('gate of a session with no flow folder: Write passes', async ($, on) => {
  world(on, { bound: 'other' })
  expect((await call($, 'Write', { file_path: '/x/notes.md' })).deny).toBeUndefined()
})
