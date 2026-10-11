import { test, expect } from 'claude-code/testing'
import { DIR, logFile, flowFile, step, world } from './fake-world'
import { updateActiveSubstep, updateCurrentState, updateStepStatus } from './step-status'

const stepsOf = (w: ReturnType<typeof world>) => w.json(`${DIR}/flow.json`).steps

test('in_progress: sets the status and startedAt, and keeps fields it does not know', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile({ custom: 'kept' }) })
  expect(await updateStepStatus(w.ports, { flowDir: DIR, stepId: 's1', status: 'in_progress' })).toEqual({ status: 'ok', files_written: ['flow.json'] })
  const saved = w.json(`${DIR}/flow.json`)
  expect(saved.steps[0].status).toBe('in_progress')
  expect(saved.steps[0].startedAt).toBeDefined()
  expect(saved.metadata.lastUpdated).not.toBe('then')
  expect(saved.custom).toBe('kept')
})
test('startedAt is not set again', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile({}, [step({ startedAt: 'first' })]) })
  await updateStepStatus(w.ports, { flowDir: DIR, stepId: 's1', status: 'in_progress' })
  expect(stepsOf(w)[0].startedAt).toBe('first')
})
test('completed: sets completedAt and counts the finished steps in the log', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile({}, [step(), step({ id: 's2', status: 'completed' })]), [`${DIR}/log.json`]: logFile() })
  await updateStepStatus(w.ports, { flowDir: DIR, stepId: 's1', status: 'completed' })
  expect(stepsOf(w)[0].completedAt).toBeDefined()
  expect(w.json(`${DIR}/log.json`).executionMetrics.stepsCompleted).toBe(2)
})
test('a step that needs approval cannot complete before the user approved it', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile({}, [step({ approvalRequired: true })]) })
  await expect(updateStepStatus(w.ports, { flowDir: DIR, stepId: 's1', status: 'completed' })).rejects.toThrow('requires user approval')
  expect(stepsOf(w)[0].status).toBe('pending')
})
test('an approved step completes', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile({}, [step({ approvalRequired: true, approved: true })]) })
  await updateStepStatus(w.ports, { flowDir: DIR, stepId: 's1', status: 'completed' })
  expect(stepsOf(w)[0].status).toBe('completed')
})
test('an unknown status, an unknown step and a missing flow are errors', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  await expect(updateStepStatus(w.ports, { flowDir: DIR, stepId: 's1', status: 'nope' })).rejects.toThrow('Invalid status')
  await expect(updateStepStatus(w.ports, { flowDir: DIR, stepId: 'zzz', status: 'completed' })).rejects.toThrow('Step zzz not found')
  await expect(updateStepStatus(w.ports, { flowDir: '/none', stepId: 's1', status: 'completed' })).rejects.toThrow('flow.json not found')
})
test('two calls at once both land: the second reads the file the first wrote', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile({}, [step(), step({ id: 's2' })]) })
  await Promise.all([
    updateStepStatus(w.ports, { flowDir: DIR, stepId: 's1', status: 'in_progress' }),
    updateStepStatus(w.ports, { flowDir: DIR, stepId: 's2', status: 'in_progress' }),
  ])
  expect(stepsOf(w).map((s: any) => s.status)).toEqual(['in_progress', 'in_progress'])
})

test('current state: sets the active step, with a substep when both parts are given', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  await updateCurrentState(w.ports, { flowDir: DIR, stepId: 's2', stepName: 'Build', summary: 'Building', details: 'd', totalSubsteps: 3, substepNumber: 1, substepName: 'first' })
  expect(w.json(`${DIR}/flow.json`).currentState).toEqual({
    activeStep: { id: 's2', name: 'Build', actionSummary: 'Building', totalSubsteps: 3, actionDetails: 'd', currentSubstep: { number: 1, name: 'first' } },
  })
})
test('current state: no details and no substep leaves them out', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  await updateCurrentState(w.ports, { flowDir: DIR, stepId: 's2', stepName: 'Build', summary: 'Building', substepNumber: 1 })
  expect(w.json(`${DIR}/flow.json`).currentState.activeStep).toEqual({ id: 's2', name: 'Build', actionSummary: 'Building', totalSubsteps: 0 })
})
test('active substep: sets the substep and the summary', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  await updateActiveSubstep(w.ports, { flowDir: DIR, substepNumber: 2, substepName: 'second', summary: 'now' })
  const active = w.json(`${DIR}/flow.json`).currentState.activeStep
  expect(active.currentSubstep).toEqual({ number: 2, name: 'second' })
  expect(active.actionSummary).toBe('now')
})
test('active substep: a flow with no active step is an error', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile({ currentState: {} }) })
  await expect(updateActiveSubstep(w.ports, { flowDir: DIR, substepNumber: 1, substepName: 'a' })).rejects.toThrow('no active step')
})
