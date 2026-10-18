import type { ManagerPorts } from '../ports/ports'
import { fail, ok } from './flow-files'
import type { Result } from './flow-files'

// Links the session to a flow: the folder goes on the session's list in the mod store.
// A resumed session has a new id, so it starts a new list. A child is bound after its parent and answers first.

export async function bindSession(ports: ManagerPorts, flowDir: string): Promise<Result> {
  if (!/\/active\/[^/]+$/.test(flowDir)) fail(`Not a folder in active/: ${flowDir}`)
  if (!(await ports.files.exists(`${flowDir}/flow.json`))) fail(`No flow.json in ${flowDir}`)
  await ports.links.add(await ports.sessionId(), flowDir)
  return ok()
}
