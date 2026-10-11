import { findFlowDir, readFlow, hasFlowInstance } from '../flow-repository/flow-repository'
import { isLogOwed } from '../log-owed/log-owed'
import type { FileSystem, SessionLinks } from '../ports/ports'

// The log-first rule: the agent must log the user's request (the tool `log_interaction`) before it
// stops or edits. `isLogOwed` says the log is owed. Used by the turn-end hook and the edit hook.

export type LogPrompt = { key: string; text: string } // key = step id + :log; the re-prompt limit counts per key

// What the agent must do, or undefined when no log is owed. Only a session with a flow owes one: a bit left by a finished flow is ignored.
export async function findLogOwed(files: FileSystem, links: SessionLinks, sessionId: string): Promise<LogPrompt | undefined> {
  if (!isLogOwed(sessionId)) return
  const flowDir = await findFlowDir(files, links, sessionId)
  if (!hasFlowInstance(flowDir)) return
  const stepId = (await readFlow(files, flowDir))?.currentState?.activeStep?.id
  return logInteractionPrompt(flowDir, stepId)
}

export function logInteractionPrompt(flowDir: string, stepId = '<active step id>'): LogPrompt {
  return {
    key: `${stepId}:log`,
    text: `User interaction not yet logged — you cannot stop yet.\nFlow dir: ${flowDir}\nStep ID: ${stepId}\n\n` +
      'Log it with the tool `log_interaction`:\n' +
      `  flowDir "${flowDir}", stepId "${stepId}"\n` +
      '  request "User requested: [what the user asked]", reason "User feedback on [topic]"\n' +
      '  response "Action taken: [what you are doing]"\n\nAfter logging, you can stop.',
  }
}
