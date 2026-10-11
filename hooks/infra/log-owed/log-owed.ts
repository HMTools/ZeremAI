import { findFlowDir, hasFlowInstance } from '../flow-repository/flow-repository'
import { TOOL_PREFIX } from '../mod-events/mod-events'
import type { FileSystem, SessionLinks } from '../ports/ports'

// "The agent owes a log entry for the user's last prompt": one bit for each session, held in memory.
// It is lost when the mods reload or the session is resumed. The hooks that use it share this module.

const owed = new Set<string>()

export const markLogOwed = (sessionId: string) => { owed.add(sessionId) }
export const clearLogOwed = (sessionId: string) => { owed.delete(sessionId) }
export const isLogOwed = (sessionId: string) => owed.has(sessionId)

// A prompt arrived in a session that has a flow.
export async function raiseLogOwed(files: FileSystem, links: SessionLinks, sessionId: string): Promise<void> {
  if (hasFlowInstance(await findFlowDir(files, links, sessionId))) markLogOwed(sessionId)
}

// ── What a tool does to the log ───────────────────────────────────────────

// The tool that logs the user's prompt, and the tools that change the flow. The changing tools wait for the log.
export const LOG_TOOL = `${TOOL_PREFIX}log_interaction`
export const LOG_GATED_TOOLS = ['update_step_status', 'update_current_state', 'update_active_substep', 'add_memory_entry', 'update_flow_status'].map(name => `${TOOL_PREFIX}${name}`)
