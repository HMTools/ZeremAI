import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`
const TOOL = 'mcp__zeremai__request_approval'
const step = { id: 's1', number: 1, name: 'Design', status: 'in_progress', approvalRequired: true }
const flowJson = (steps: unknown[] = [step]) => JSON.stringify({ status: 'running', steps })

// fake disk: one flow folder bound to session S1; writes land in `written`
// The answer to the dialog is not tested here: a test has no screen, so $.ui.ask is dismissed. askGate's own test covers every answer.
function world(on: On, { steps = [step] as unknown[], bound = 'S1' } = {}) {
  const all: Record<string, string> = { [`${DIR}/flow.json`]: flowJson(steps) }
  const written: Record<string, string> = {}
  mock.env(on, { HOME: '/h' })
  mock.store(on, { [`session:${bound}`]: [DIR] })
  on('session.id', async () => ({ value: 'S1' }))
  on('fs.list', async (_$, e) => ({ value: e.path === ACTIVE ? [{ name: 'p1', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.exists', async (_$, e) => ({ value: e.path in all }))
  on('fs.read', async (_$, e) => ({ value: all[e.path] }))
  on('fs.write', async (_$, e) => { written[e.path] = e.text; return { value: undefined } })
  on('tool.call', async () => ({ result: 'done', text: 'done' }) as never)
  return written
}
const request = ($: any) => $.tool.call({ tool: TOOL })
const text = (r: any) => r.result.content[0].text

test('request_approval: the dialog is dismissed, nothing is written, the gate stays open', async ($, on) => {
  const written = world(on)
  expect(text(await request($))).toContain('only the user can approve')
  expect(written).toEqual({})
  expect((await $.tool.call({ tool: 'Write', file_path: '/x/notes.md', content: 'y' })).deny).toContain('Approval needed')
})
test('request_approval: no step waits', async ($, on) => {
  world(on, { steps: [{ ...step, approved: true }] })
  expect(text(await request($))).toContain('No step is waiting for approval')
})
test('request_approval: no flow for the session', async ($, on) => {
  world(on, { bound: 'other' })
  expect(text(await request($))).toContain('No flow is bound')
})
const P = `${DIR}/flow.json`
test('hand edit: Write on flow.json is refused', async ($, on) => {
  world(on)
  expect((await $.tool.call({ tool: 'Write', file_path: P, content: '{}' })).deny).toContain('Do not edit them by hand')
})
test('hand edit: Edit on flow.json is refused', async ($, on) => {
  world(on)
  expect((await $.tool.call({ tool: 'Edit', file_path: P, old_string: 'a', new_string: 'b' })).deny).toContain('Do not edit them by hand')
})
test('hand edit: Bash that writes flow.json is refused', async ($, on) => {
  world(on)
  expect((await $.tool.call({ tool: 'Bash', command: `sed -i 's/false/true/' ${P}` })).deny).toContain('Do not edit them by hand')
})
test('hand edit: a Write to another file passes', async ($, on) => {
  world(on)
  expect((await $.tool.call({ tool: 'Write', file_path: `${DIR}/notes.md`, content: 'y' })).deny).toBeUndefined()
})
test('hand edit: reading flow.json passes', async ($, on) => {
  world(on)
  expect((await $.tool.call({ tool: 'Bash', command: `cat ${P}` })).deny).toBeUndefined()
})
