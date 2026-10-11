import { test, expect } from 'claude-code/testing'
import { ACTIVE, DIR, flowFile, world } from './fake-world'
import { registerChildFlow, updateChildStatus, updateFlowStatus } from './flow-status'

test('a status that keeps the flow in active/ moves nothing', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  expect(await updateFlowStatus(w.ports, { flowDir: DIR, status: 'paused' })).toEqual({ status: 'ok', files_written: ['flow.json'] })
  expect(w.json(`${DIR}/flow.json`).status).toBe('paused')
  expect(w.moved).toEqual([])
})
test('completed: the folder moves to completed/ and flowPath follows', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile(), [`${DIR}/log.json`]: {} })
  const result = await updateFlowStatus(w.ports, { flowDir: DIR, status: 'completed' })
  const target = '/h/.claude/zeremai/completed/p1'
  expect(result.relocated_to).toBe(target)
  expect(w.moved).toEqual([[DIR, target]])
  expect(w.json(`${target}/flow.json`).metadata.flowPath).toBe(target)
  expect(w.json(`${target}/flow.json`).metadata.completed).toBe(w.json(`${target}/flow.json`).metadata.lastUpdated) // the tool records the completion time
  expect(w.disk[`${target}/log.json`]).toBeDefined()
  expect(w.disk[`${DIR}/flow.json`]).toBeUndefined()
})
test('failed goes to failed/, and back to running goes to active/', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  await updateFlowStatus(w.ports, { flowDir: DIR, status: 'failed' })
  const failed = '/h/.claude/zeremai/failed/p1'
  expect(w.disk[`${failed}/flow.json`]).toBeDefined()
  await updateFlowStatus(w.ports, { flowDir: failed, status: 'running' })
  expect(w.disk[`${DIR}/flow.json`]).toBeDefined()
})
test('a target folder that exists is an error', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile(), '/h/.claude/zeremai/completed/p1/flow.json': '{}' })
  await expect(updateFlowStatus(w.ports, { flowDir: DIR, status: 'completed' })).rejects.toThrow('target directory already exists')
})
test('a move that fails is an error that says why, and the flow file keeps the new status', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() }, { failMove: true })
  await expect(updateFlowStatus(w.ports, { flowDir: DIR, status: 'completed' })).rejects.toThrow('Cannot relocate: disk is read-only')
})
test('an unknown status is an error', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  await expect(updateFlowStatus(w.ports, { flowDir: DIR, status: 'done' })).rejects.toThrow('Invalid status')
})

const PARENT = `${ACTIVE}/parent`
const child = { id: 'cid', name: 'Child', status: 'running', spawnedAtStep: 'ps1', syncPoint: 'ps2', flowPath: DIR }
const family = () => world({
  [`${DIR}/flow.json`]: flowFile({ id: 'cid', subFlowState: { parentFlow: { id: 'pid', name: 'Parent', flowPath: PARENT, returnToStep: 'ps2' }, childFlows: [] } }),
  [`${PARENT}/flow.json`]: flowFile({ id: 'pid', subFlowState: { parentFlow: null, childFlows: [child] } }, [{ id: 'ps1', name: 'Spawn step', status: 'in_progress' }]),
  [`${PARENT}/memory/_cross-references.json`]: {},
})
test('a sub-flow cannot complete without a summary', async () => {
  const w = family()
  await expect(updateFlowStatus(w.ports, { flowDir: DIR, status: 'completed' })).rejects.toThrow('must provide a summary')
  expect(w.json(`${DIR}/flow.json`).status).toBe('running')
})
test('a finished sub-flow tells its parent: child status and summary in the parent memory', async () => {
  const w = family()
  await updateFlowStatus(w.ports, { flowDir: DIR, status: 'completed', summary: 'Built it' })
  expect(w.json(`${PARENT}/flow.json`).subFlowState.childFlows[0].status).toBe('completed')
  expect(w.json(`${PARENT}/memory/sub-flows.json`).entries.ps1).toMatchObject({ stepName: 'Spawn step', informationProduced: { childSummary_cid: 'Built it' } })
})
test('a parent that cannot be told does not stop the child from completing', async () => {
  const w = family()
  delete w.disk[`${PARENT}/flow.json`]
  const result = await updateFlowStatus(w.ports, { flowDir: DIR, status: 'completed', summary: 'Built it' })
  expect(result.status).toBe('ok')
})

test('register a child: first child, then the same child again replaces it', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  const input = { flowDir: DIR, childId: 'c1', childName: 'C', childStatus: 'running', spawnedAtStep: 's1', syncPoint: 's2', childFlowPath: '/c' }
  await registerChildFlow(w.ports, input)
  await registerChildFlow(w.ports, { ...input, childStatus: 'paused' })
  await registerChildFlow(w.ports, { ...input, childId: 'c2' })
  const state = w.json(`${DIR}/flow.json`).subFlowState
  expect(state.parentFlow).toBeNull()
  expect(state.childFlows.map((c: any) => [c.id, c.status])).toEqual([['c1', 'paused'], ['c2', 'running']])
})
test('update a child status; an unknown child or a flow with no children is an error', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile({ subFlowState: { parentFlow: null, childFlows: [child] } }) })
  await updateChildStatus(w.ports, { flowDir: DIR, childId: 'cid', childStatus: 'failed' })
  expect(w.json(`${DIR}/flow.json`).subFlowState.childFlows[0].status).toBe('failed')
  await expect(updateChildStatus(w.ports, { flowDir: DIR, childId: 'zzz', childStatus: 'failed' })).rejects.toThrow('not found')
  const none = world({ [`${DIR}/flow.json`]: flowFile() })
  await expect(updateChildStatus(none.ports, { flowDir: DIR, childId: 'cid', childStatus: 'failed' })).rejects.toThrow('No subFlowState')
})
