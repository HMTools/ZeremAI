import { test, expect } from 'claude-code/testing'
import { DIR, logFile, world } from './fake-world'
import { addLogEntry, logInteraction, updateLogObservations } from './log'

const setup = (log: unknown = logFile()) => world({ [`${DIR}/log.json`]: log })
const stepLog = (w: ReturnType<typeof world>, id = 's1') => w.json(`${DIR}/log.json`).steps[id]

test('a new log entry: the lists given, a start time, and the current step', async () => {
  const w = setup()
  await addLogEntry(w.ports, { flowDir: DIR, stepId: 's2', actions: ['a1'], reasoning: ['r1'] })
  expect(stepLog(w, 's2')).toMatchObject({ actionsTaken: ['a1'], agentReasoning: ['r1'] })
  expect(stepLog(w, 's2').timestamp.startedAt).toBeDefined()
  expect(w.json(`${DIR}/log.json`).executionMetrics.currentStep).toBe('s2')
})
test('a new entry leaves out an empty actions list and keeps an empty list of another kind', async () => {
  const w = setup()
  await addLogEntry(w.ports, { flowDir: DIR, stepId: 's1', actions: [], problems: [] })
  expect(stepLog(w)).not.toHaveProperty('actionsTaken')
  expect(stepLog(w).problemsEncountered).toEqual([])
})
test('an entry that exists grows, and a text timestamp becomes start and update times', async () => {
  const w = setup({ ...logFile(), steps: { s1: { timestamp: 'old', actionsTaken: ['a1'] } } })
  await addLogEntry(w.ports, { flowDir: DIR, stepId: 's1', actions: ['a2'], decisions: ['d'] })
  expect(stepLog(w)).toMatchObject({ actionsTaken: ['a1', 'a2'], decisionsMade: ['d'] })
  expect(stepLog(w).timestamp).toMatchObject({ startedAt: 'old' })
  expect(stepLog(w).timestamp.updatedAt).toBeDefined()
})
test('no log file is an error', async () => {
  await expect(addLogEntry(world().ports, { flowDir: DIR, stepId: 's1' })).rejects.toThrow('log.json not found')
})

test('log a user interaction in a new entry', async () => {
  const w = setup()
  await logInteraction(w.ports, { flowDir: DIR, stepId: 's1', request: 'r', reason: 'why', response: 'ok' })
  const [interaction] = stepLog(w).userInteractions
  expect(interaction).toMatchObject({ request: 'r', reason: 'why', agentResponse: 'ok' })
  expect(interaction).not.toHaveProperty('forImprovementStep')
})
test('log a user interaction in an entry that exists, marked for improvement', async () => {
  const w = setup({ ...logFile(), steps: { s1: { timestamp: { startedAt: 'a' }, userInteractions: [{ request: 'first' }] } } })
  await logInteraction(w.ports, { flowDir: DIR, stepId: 's1', request: 'r', reason: 'why', response: 'ok', forImprovement: true, potentialImprovement: 'faster' })
  const list = stepLog(w).userInteractions
  expect(list.length).toBe(2)
  expect(list[1]).toMatchObject({ forImprovementStep: true, potentialImprovement: 'faster' })
  expect(stepLog(w).timestamp.updatedAt).toBeDefined()
})

test('observations: lists grow, metrics merge', async () => {
  const w = setup()
  await updateLogObservations(w.ports, { flowDir: DIR, patterns: ['p1'], feedback: ['f1'], metrics: { a: 1 }, recommendations: ['r1'] })
  await updateLogObservations(w.ports, { flowDir: DIR, patterns: ['p2'], metrics: { b: 2 } })
  expect(w.json(`${DIR}/log.json`).flowWideObservations).toEqual({
    patternsDetected: ['p1', 'p2'], userFeedbackSummary: ['f1'], efficiencyMetrics: { a: 1, b: 2 }, recommendationsForFuture: ['r1'],
  })
})
