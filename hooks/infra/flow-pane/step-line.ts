import type { FileSystem } from '../ports/ports'

// The one line under the prompt: where the flow is. It reads flow.json, so it never differs from the files.
// An empty text clears the line: the folder has moved (the flow finished) or the flow is not running.
export async function stepLine(files: FileSystem, dir: string): Promise<string> {
  let flow: any
  try { flow = JSON.parse(await files.read(`${dir}/flow.json`)) } catch { return '' }
  if (flow.status !== 'running') return ''
  const steps: any[] = flow.steps ?? []
  const active = flow.currentState?.activeStep
  const index = Math.max(0, steps.findIndex(s => s.id === active?.id))
  const step = steps[index]
  if (!step) return ''
  const parts = [`Step ${index + 1} of ${steps.length}`, active?.name ?? step.name]
  if (step.status === 'awaiting_approval') parts.push('waits for you')
  else if (active?.totalSubsteps && active.currentSubstep) parts.push(`part ${active.currentSubstep.number} of ${active.totalSubsteps}`)
  return parts.join(' · ')
}
