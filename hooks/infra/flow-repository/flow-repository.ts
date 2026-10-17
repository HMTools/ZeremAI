import type { Flow } from '../flow-types/flow-types'
import type { FileSystem, SessionLinks } from '../ports/ports'

// Finds the flow of a session in the mod store, and reads its flow.json.

export const sessionKey = (sessionId: string) => `session:${sessionId}`

// The newest folder the session bound that is still a flow. A child is bound after its parent, so it answers first.
export async function findFlowDir(files: FileSystem, links: SessionLinks, sessionId: string): Promise<string | undefined> {
  for (const dir of [...(await links.get(sessionId))].reverse()) {
    if (await files.exists(`${dir}/flow.json`)) return dir
  }
}

export async function readFlow(files: FileSystem, flowDir: string): Promise<Flow | undefined> {
  try {
    return JSON.parse(await files.read(`${flowDir}/flow.json`))
  } catch {
    /* unreadable: leave the agent alone */
  }
}

export const hasFlowInstance = (flowDir: string | undefined): flowDir is string => flowDir !== undefined
export const isFlowRunning = (flow: Flow | undefined): flow is Flow => flow?.status === 'running'
