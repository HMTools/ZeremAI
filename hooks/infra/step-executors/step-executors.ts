import type { ListAgents } from '../ports/ports'

const STEP_EXECUTOR = 'zeremai:step-executor'
const RUNNING_AGENT_STATUSES = ['pending', 'running', 'waiting']

export async function isStepExecutorRunning(listAgents: ListAgents): Promise<boolean> {
  return (await listAgents()).some(a => a.type === STEP_EXECUTOR && RUNNING_AGENT_STATUSES.includes(a.status))
}
