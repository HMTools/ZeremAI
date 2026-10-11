import { test, expect } from 'claude-code/testing'
import { isStepExecutorRunning } from './step-executors'

const agents = (...list: { type: string; status: string }[]) => async () => list
const executor = (status: string) => ({ type: 'zeremai:step-executor', status })

test('a step-executor that is running, pending or waiting counts as running', async () => {
  for (const status of ['running', 'pending', 'waiting']) expect(await isStepExecutorRunning(agents(executor(status)))).toBe(true)
})
test('a step-executor that ended does not count', async () => {
  for (const status of ['completed', 'failed', 'killed']) expect(await isStepExecutorRunning(agents(executor(status)))).toBe(false)
})
test('another kind of agent does not count', async () => {
  expect(await isStepExecutorRunning(agents({ type: 'Explore', status: 'running' }))).toBe(false)
})
test('no agents: not running', async () => {
  expect(await isStepExecutorRunning(agents())).toBe(false)
})
