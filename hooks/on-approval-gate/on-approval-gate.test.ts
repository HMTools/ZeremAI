import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`
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
  on('fs.write', async (_$, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('tool.call', async () => ({ result: 'done', text: 'done' }) as never)
  return written
}
// The agent asks with the command `request-approval` of the flow script; the plugin folder is read from the refusal of another script.
const script = async ($: any, sub: string, input: unknown) => {
  const refused: any = await $.tool.call({ tool: 'Bash', command: "python3 /nowhere/scripts/flow_manager.py x --json '{}'" })
  const root = /script only: (.*)\/scripts\/flow_manager\.py/.exec(refused.deny)![1]
  return $.tool.call({ tool: 'Bash', command: `python3 ${root}/scripts/flow_manager.py ${sub} --json '${JSON.stringify(input)}'` })
}
const request = ($: any) => script($, 'request-approval', {})
const text = (r: any) => r.result.stdout

test('request-approval: the dialog is dismissed, nothing is written, the gate stays open', async ($, on) => {
  const written = world(on)
  expect(text(await request($))).toContain('only the user can approve')
  expect(written).toEqual({})
  expect((await $.tool.call({ tool: 'Write', file_path: '/x/notes.md', content: 'y' })).deny).toContain('Approval needed')
})
test('request-approval: no step waits', async ($, on) => {
  world(on, { steps: [{ ...step, approved: true }] })
  expect(text(await request($))).toContain('No step is waiting for approval')
})
test('request-approval: no flow for the session', async ($, on) => {
  world(on, { bound: 'other' })
  expect(text(await request($))).toContain('No flow is bound')
})
test('a script command that names flow.json is not a hand edit; the gate of the script decides', async ($, on) => {
  world(on)
  const r: any = await script($, 'add-log-entry', { flowDir: DIR, stepId: 's1', filesModified: ['flow.json'] })
  expect(r.deny).toBeUndefined() // not the hand-edit refusal: it reaches the stand-in below the plugin
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
