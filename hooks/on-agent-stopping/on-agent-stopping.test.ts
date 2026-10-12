import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`

const proc = (status: string, steps: unknown[]) => JSON.stringify({ status, steps })
const step = (number: number, status: string) => ({ number, id: `s${number}`, name: `Step ${number} name`, status })
const json = `${DIR}/flow.json`

// fake ~/.claude/zeremai: one flow folder bound to session S1; returns the prompts submitted
function world(on: On, files: Record<string, string>, agents: { type: string; status: string }[] = [], gate = false, bound = 'S1') {
  const submitted: string[] = []
  mock.env(on, { HOME: '/h' })
  mock.store(on, { [`session:${bound}`]: [DIR], ...(gate ? { 'gate:S1': { dir: DIR, stepId: 's1' } } : {}) })
  const all = files
  on('session.id', async () => ({ value: 'S1' }))
  on('fs.list', async ($, e) => ({ value: e.path === ACTIVE ? [{ name: 'p1', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.exists', async ($, e) => ({ value: e.path in all }))
  on('fs.read', async ($, e) => { if (!(e.path in all)) throw new Error('missing'); return { value: all[e.path] } })
  on('agent.list', async () => ({ value: agents as never }))
  on('prompt.submit', async (_$, e) => { if (e.origin?.kind === 'plugin') submitted.push(e.text); return { drop: 'test' } })
  on('turn.complete', async () => ({ text: '' }))
  return submitted
}
const end = ($: any, extra = {}) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra })

test('no flow for this session: no re-prompt', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'pending')])}, [], false, 'other')
  await end($)
  expect(sent).toEqual([])
})
test('the user decides on an approval: no re-prompt', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'pending')]) }, [], true)
  await end($)
  expect(sent).toEqual([])
})
test('flow not running: no re-prompt', async ($, on) => {
  const sent = world(on, { [json]: proc('paused', [step(1, 'pending')]) })
  await end($)
  expect(sent).toEqual([])
})
test('all steps completed: no re-prompt', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'completed')]) })
  await end($)
  expect(sent).toEqual([])
})
test('pending step: re-prompt names the step', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'completed'), step(2, 'pending')]) })
  await end($)
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('Step 2 — "Step 2 name" (ID: s2)')
})
test('step running, no step-executor alive: re-prompt says lost', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'in_progress')]) })
  await end($)
  expect(sent[0]).toContain('no step-executor is running')
})
test('step running, step-executor alive: re-prompt says wait', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'in_progress')]) }, [{ type: 'zeremai:step-executor', status: 'running' }])
  await end($)
  expect(sent[0]).toContain('still in progress')
})
test('a subagent turn is ignored', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'pending')]) })
  await end($, { agentId: 'a1' })
  expect(sent).toEqual([])
})
test('a user interrupt is not re-prompted', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'pending')]) })
  await end($, { isAborted: true, reason: 'aborted' })
  expect(sent).toEqual([])
})

test('re-prompts at most 3 times in a row for the same step', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'pending')]) })
  for (let i = 0; i < 5; i++) await end($)
  expect(sent.length).toBe(3)
})
test('a prompt from the user starts the count again', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [step(1, 'pending')]) })
  for (let i = 0; i < 4; i++) await end($)
  await $.prompt.submit({ text: 'continue' })
  await end($)
  expect(sent.length).toBe(4) // the 4th: the count started again
})

// approval checkpoint rule
const approvalStep = (extra = {}) => ({ ...step(1, 'in_progress'), approvalRequired: true, ...extra })
test('approval step, no answer yet: re-prompt asks for it, before the pending rule', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [approvalStep(), step(2, 'pending')]) })
  await end($)
  expect(sent[0]).toContain('Approval required — step "Step 1 name"')
  expect(sent[0]).toContain('request_approval')
})
test('approval step, step-executor alive: wait text', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [approvalStep()]) }, [{ type: 'zeremai:step-executor', status: 'running' }])
  await end($)
  expect(sent[0]).toContain('still in progress')
})
test('approved step: re-prompt asks to complete it, before the pending rule', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [approvalStep({ approved: true }), step(2, 'pending')]) })
  await end($)
  expect(sent[0]).toContain('is approved but not completed')
  expect(sent[0]).toContain('update_step_status')
})
test('approval step with an open gate: no re-prompt', async ($, on) => {
  const sent = world(on, { [json]: proc('running', [approvalStep()]) }, [], true)
  await end($)
  expect(sent).toEqual([])
})
