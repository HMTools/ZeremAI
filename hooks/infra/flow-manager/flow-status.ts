import type { ManagerPorts } from '../ports/ports'
import { slash } from './move'
import { FLOW_STATUSES, fail, locked, ok, readJson, readFlow, stepName, writeJson } from './flow-files'
import type { Doc, Result } from './flow-files'

// A flow lives in the folder of its status. A running or paused flow is in `active/`.
const STATUS_FOLDER: Record<string, string> = { completed: 'completed', failed: 'failed', running: 'active', paused: 'active' }

export type FlowStatusArgs = { flowDir: string; status: string; summary?: string }

export const updateFlowStatus = (ports: ManagerPorts, a: FlowStatusArgs): Promise<Result> => locked(a.flowDir, async () => {
  if (!FLOW_STATUSES.includes(a.status)) fail(`Invalid status "${a.status}". Valid: ${FLOW_STATUSES.join(', ')}`)
  const flow = await readFlow(ports, a.flowDir)

  // A finished sub-flow tells its parent what it did.
  const parentRef = flow.subFlowState?.parentFlow
  if (a.status === 'completed' && parentRef) {
    if (!a.summary) {
      fail(
        `This flow is a sub-flow of '${parentRef.name}' (path: ${parentRef.flowPath}). ` +
        'When completing a sub-flow, you must provide a summary describing what was accomplished. ' +
        'The parent flow needs this summary to continue.\n\n' +
        'Example: summary "Implemented feature X, created PR #123, all tests passing"',
      )
    }
    // Best effort: a parent that cannot be told must not stop the child from completing.
    try { await notifyParent(ports, flow, parentRef, a.summary as string) } catch { /* parent not told */ }
  }

  flow.status = a.status
  flow.metadata.lastUpdated = ports.now()
  if (a.status === 'completed') flow.metadata.completed = flow.metadata.lastUpdated // the completion time: no step has to record it
  await writeJson(ports, `${a.flowDir}/flow.json`, flow)

  const target = STATUS_FOLDER[a.status]
  const parts = slash(a.flowDir).replace(/\/+$/, '').split('/')
  const name = parts.pop() as string
  const current = parts[parts.length - 1]
  if (!target || current === target) return ok('flow.json')

  const targetParent = `${parts.slice(0, -1).join('/')}/${target}`
  const newDir = `${targetParent}/${name}`
  if (await ports.files.exists(newDir)) fail(`Cannot relocate: target directory already exists: ${newDir}`)
  // $.fs cannot move or delete, so the folder moves with the platform's own command.
  try { await ports.move(a.flowDir, newDir) } catch (error) { fail(`Cannot relocate: ${error instanceof Error ? error.message : String(error)}`) }
  const moved = await readJson(ports, `${newDir}/flow.json`)
  moved.metadata.flowPath = newDir
  await writeJson(ports, `${newDir}/flow.json`, moved)
  return { ...ok('flow.json'), relocated_to: newDir }
})

async function notifyParent(ports: ManagerPorts, child: Doc, parentRef: Doc, summary: string): Promise<void> {
  await locked(parentRef.flowPath, async () => {
    const parentPath = `${parentRef.flowPath}/flow.json`
    if (!(await ports.files.exists(parentPath))) return
    const parent = await readJson(ports, parentPath)
    const entry = parent.subFlowState?.childFlows?.find((c: Doc) => c.id === child.id)
    if (parent.subFlowState) {
      if (entry) entry.status = 'completed'
      parent.metadata.lastUpdated = ports.now()
      await writeJson(ports, parentPath, parent)
    }
    // The summary goes into the parent's memory, under the step that started the child.
    const topicPath = `${parentRef.flowPath}/memory/sub-flows.json`
    if (!(await ports.files.exists(`${parentRef.flowPath}/memory`)) || !entry?.spawnedAtStep) return
    const now = ports.now()
    const topic: Doc = (await ports.files.exists(topicPath))
      ? await readJson(ports, topicPath)
      : { type: 'memory-topic-file', topic: 'sub-flows', lastUpdated: now, entries: {} }
    const spawn = entry.spawnedAtStep
    if (topic.entries[spawn]) {
      topic.entries[spawn].informationProduced = { ...topic.entries[spawn].informationProduced, [`childSummary_${child.id}`]: summary }
      topic.entries[spawn].updatedAt = now
    } else {
      topic.entries[spawn] = { stepName: stepName(parent, spawn), informationProduced: { [`childSummary_${child.id}`]: summary }, decisionsMade: [], filesModifiedCreated: [], updatedAt: now }
    }
    topic.lastUpdated = now
    await writeJson(ports, topicPath, topic)
  })
}

export type RegisterChildArgs = {
  flowDir: string; childId: string; childName: string; childStatus: string
  spawnedAtStep: string; syncPoint: string; childFlowPath: string
}

export const registerChildFlow = (ports: ManagerPorts, a: RegisterChildArgs): Promise<Result> => locked(a.flowDir, async () => {
  if (!FLOW_STATUSES.includes(a.childStatus)) fail(`Invalid status "${a.childStatus}". Valid: ${FLOW_STATUSES.join(', ')}`)
  const flow = await readFlow(ports, a.flowDir)
  const child = { id: a.childId, name: a.childName, status: a.childStatus, spawnedAtStep: a.spawnedAtStep, syncPoint: a.syncPoint, flowPath: a.childFlowPath }
  if (!flow.subFlowState) {
    flow.subFlowState = { parentFlow: null, childFlows: [child] }
  } else {
    const children: Doc[] = (flow.subFlowState.childFlows ??= [])
    const at = children.findIndex(c => c.id === child.id)
    if (at === -1) children.push(child)
    else children[at] = child
  }
  flow.metadata.lastUpdated = ports.now()
  await writeJson(ports, `${a.flowDir}/flow.json`, flow)
  return ok('flow.json')
})

export type ChildStatusArgs = { flowDir: string; childId: string; childStatus: string }

export const updateChildStatus = (ports: ManagerPorts, a: ChildStatusArgs): Promise<Result> => locked(a.flowDir, async () => {
  if (!FLOW_STATUSES.includes(a.childStatus)) fail(`Invalid status "${a.childStatus}". Valid: ${FLOW_STATUSES.join(', ')}`)
  const flow = await readFlow(ports, a.flowDir)
  if (!flow.subFlowState) fail('No subFlowState found on this flow')
  const child = flow.subFlowState.childFlows?.find((c: Doc) => c.id === a.childId)
  if (!child) fail(`Child flow ${a.childId} not found in subFlowState.childFlows`)
  child.status = a.childStatus
  flow.metadata.lastUpdated = ports.now()
  await writeJson(ports, `${a.flowDir}/flow.json`, flow)
  return ok('flow.json')
})
