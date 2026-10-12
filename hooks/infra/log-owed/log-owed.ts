import { findFlowDir, hasFlowInstance } from '../flow-repository/flow-repository'
import type { FileSystem, SessionLinks } from '../ports/ports'

// "The agent owes a log entry for the user's last prompt": one entry for each session, held in memory, with the prompt that raised it.
// It is lost when the mods reload or the session is resumed. The hooks that use it share this module.
// The commands that wait for the log are in ../flow-manager/script (LOG_GATED).

const owed = new Map<string, string>()

export const markLogOwed = (sessionId: string, prompt = '') => { owed.set(sessionId, prompt) }
export const clearLogOwed = (sessionId: string) => { owed.delete(sessionId) }
export const isLogOwed = (sessionId: string) => owed.has(sessionId)
export const owedPrompt = (sessionId: string) => owed.get(sessionId) ?? ''

// A prompt arrived in a session that has a flow.
export async function raiseLogOwed(files: FileSystem, links: SessionLinks, sessionId: string, prompt = ''): Promise<void> {
  if (hasFlowInstance(await findFlowDir(files, links, sessionId))) markLogOwed(sessionId, prompt)
}
