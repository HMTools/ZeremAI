import type { ManagerPorts } from '../ports/ports'
import { STEP_STATUSES, fail, locked, ok, readJson, readLog, readFlow, writeJson } from './flow-files'
import type { Result } from './flow-files'

export type StepStatusArgs = { flowDir: string; stepId: string; status: string }

export const updateStepStatus = (ports: ManagerPorts, a: StepStatusArgs): Promise<Result> => locked(a.flowDir, async () => {
  if (!STEP_STATUSES.includes(a.status)) fail(`Invalid status "${a.status}". Valid: ${STEP_STATUSES.join(', ')}`)
  const flow = await readFlow(ports, a.flowDir)
  const now = ports.now()
  const step = flow.steps.find((s: any) => s.id === a.stepId)
  if (!step) fail(`Step ${a.stepId} not found`)

  // Approval gate: a step that needs approval cannot complete before the user approved it.
  if (a.status === 'completed' && step.approvalRequired && step.approved !== true) {
    fail(
      `Step "${step.name}" requires user approval before completion.\n\n` +
      'This step has approvalRequired: true but has not been approved.\n' +
      'Step approval is user-only. Call request_approval: the user approves with a click in a dialog.\n' +
      'Once approved, retry: update_step_status with status completed',
    )
  }
  step.status = a.status
  if (a.status === 'in_progress' && step.startedAt == null) step.startedAt = now
  else if (a.status === 'completed') step.completedAt = now

  if (a.status === 'completed' && (await ports.files.exists(`${a.flowDir}/log.json`))) {
    const log = await readLog(ports, a.flowDir)
    if (log.executionMetrics) {
      // Count from the steps, so a retry does not count twice.
      log.executionMetrics.stepsCompleted = flow.steps.filter((s: any) => s.status === 'completed').length
      await writeJson(ports, `${a.flowDir}/log.json`, log)
    }
  }
  flow.metadata.lastUpdated = now
  await writeJson(ports, `${a.flowDir}/flow.json`, flow)
  return ok('flow.json')
})

export type CurrentStateArgs = {
  flowDir: string; stepId: string; stepName: string; summary: string
  details?: string; totalSubsteps?: number; substepNumber?: number; substepName?: string
}

export const updateCurrentState = (ports: ManagerPorts, a: CurrentStateArgs): Promise<Result> => locked(a.flowDir, async () => {
  const flow = await readFlow(ports, a.flowDir)
  const activeStep: any = { id: a.stepId, name: a.stepName, actionSummary: a.summary, totalSubsteps: a.totalSubsteps ?? 0 }
  if (a.details != null) activeStep.actionDetails = a.details
  if (a.substepNumber != null && a.substepName != null) activeStep.currentSubstep = { number: a.substepNumber, name: a.substepName }
  flow.currentState = { activeStep }
  flow.metadata.lastUpdated = ports.now()
  await writeJson(ports, `${a.flowDir}/flow.json`, flow)
  return ok('flow.json')
})

export type ActiveSubstepArgs = { flowDir: string; substepNumber: number; substepName: string; summary?: string }

export const updateActiveSubstep = (ports: ManagerPorts, a: ActiveSubstepArgs): Promise<Result> => locked(a.flowDir, async () => {
  const flow = await readFlow(ports, a.flowDir)
  const activeStep = flow.currentState?.activeStep
  if (!activeStep) fail('The flow has no active step. Call update_current_state first.')
  activeStep.currentSubstep = { number: a.substepNumber, name: a.substepName }
  if (a.summary != null) activeStep.actionSummary = a.summary
  flow.metadata.lastUpdated = ports.now()
  await writeJson(ports, `${a.flowDir}/flow.json`, flow)
  return ok('flow.json')
})
