import { test, expect } from 'claude-code/testing'
import { DIR, flowFile, step, world } from '../flow-manager/fake-world'
import { stepLine } from './step-line'

const steps = [step({ id: 'a', number: 0, name: 'Read' }), step({ id: 'b', number: 1, name: 'Draft', status: 'in_progress' }), step({ id: 'c', number: 2, name: 'Ship' })]
const at = (extra: Record<string, unknown>, status?: string) =>
  world({
    [`${DIR}/flow.json`]: flowFile(
      { currentState: { activeStep: { id: 'b', name: 'Draft the plan', actionSummary: 'x', totalSteps: 3, totalSubsteps: 4, currentSubstep: { number: 2, name: 'x' }, ...extra } } },
      status ? steps.map(s => (s.id === 'b' ? { ...s, status } : s)) : steps,
    ),
  })

test('a running step shows its place and its part', async () => {
  expect(await stepLine(at({}).ports.files, DIR)).toBe('Step 2 of 3 · Draft the plan · part 2 of 4')
})
test('a step that waits for approval says so', async () => {
  expect(await stepLine(at({}, 'awaiting_approval').ports.files, DIR)).toBe('Step 2 of 3 · Draft the plan · waits for you')
})
test('no substeps: only the place', async () => {
  expect(await stepLine(at({ totalSubsteps: 0, currentSubstep: undefined }).ports.files, DIR)).toBe('Step 2 of 3 · Draft the plan')
})
test('a finished flow, or a folder that moved, clears the line', async () => {
  const done = world({ [`${DIR}/flow.json`]: flowFile({ status: 'completed' }) })
  expect(await stepLine(done.ports.files, DIR)).toBe('')
  expect(await stepLine(world().ports.files, DIR)).toBe('')
})
