import type { Register } from 'claude-code'
import { logInteraction, logPrompt } from '../infra/log-first/log-first'
import type { LogDeps } from '../infra/log-first/log-first'
import { isPromptFromPlugin } from '../infra/mod-events/mod-events'
import type { FileSystem, Gate, GateStore, SessionLinks } from '../infra/ports/ports'
import { startCountingAgain } from '../on-agent-stopping/on-agent-stopping'
import { reopenPanel } from '../infra/approval-gate/approval-gate'
import type { Approver } from '../infra/approval-gate/approval-gate'
import { approveStep, runScript } from '../infra/flow-manager/script'
import { slash } from '../infra/flow-manager/move'
import { findFlowDir, hasFlowInstance, sessionKey } from '../infra/flow-repository/flow-repository'

// The one hook on prompts (a plugin cannot have two without a matcher). A prompt that the plugin sends
// itself, as a re-prompt, changes nothing. A prompt from anywhere else:
//  - starts the turn-end re-prompt count again;
//  - in a session that has a flow, is logged by the mod before the agent sees it (a model writes the details, see ../infra/log-first).
//    If the log fails, the prompt is dropped and the user is told why;
//  - while an approval gate is open, opens the approval dialog again;

function filesOf($: any): FileSystem {
  return {
    home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
  }
}
function linksOf($: any): SessionLinks {
  return {
    get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
  }
}

async function pythonOf($: any) {
  return (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3'
}
function logDepsOf($: any): LogDeps {
  return {
    files: filesOf($),
    links: linksOf($),
    complete: request => $.model.complete(request),
    script: async (sub, input) => runScript(argv => $.process.run(argv, { timeoutMs: 60_000 }), await pythonOf($), slash($.plugin.root), sub, input),
  }
}

function gatesOf($: any): GateStore {
  return {
    get: async sessionId => ((await $.store.get(`gate:${sessionId}`)) as Gate | undefined) ?? undefined,
    set: (sessionId, gate) => $.store.set(`gate:${sessionId}`, gate),
    clear: sessionId => $.store.delete(`gate:${sessionId}`),
  }
}

function approverOf($: any): Approver {
  return async (dir, stepId) => approveStep(argv => $.process.run(argv, { timeoutMs: 60_000 }), (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3', slash($.plugin.root), dir, stepId)
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (!isPromptFromPlugin(e)) {
      startCountingAgain()
      const sessionId = await $.session.id()
      const problem = await logPrompt(logDepsOf($), sessionId, e.text)
      if (problem) return { drop: `Flow log failed, so your prompt was not sent: ${problem} Send it again, or close the flow.` }
      await reopenPanel(
        filesOf($),
        approverOf($),
        gatesOf($),
        (q, options) => $.ui.ask(q, options),
        text => $.prompt.submit({ text }),
        sessionId,
        (dir, request) => logInteraction(logDepsOf($), dir, request),
      )
    }
    return next(e)
  })
}
