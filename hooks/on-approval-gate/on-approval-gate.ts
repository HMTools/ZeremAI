import type { Register } from 'claude-code'
import { findFlowDir, readFlow, sessionKey } from '../infra/flow-repository/flow-repository'
import { askGate, findApprovalStep, isHandEdit, HAND_EDIT_TEXT } from '../infra/approval-gate/approval-gate'
import type { Approver, Loops } from '../infra/approval-gate/approval-gate'
import { REQUEST_APPROVAL, approveStep, bashAnswer, loopsOver, parseCommand, runScript, runsScript } from '../infra/flow-manager/script'
import { approveEntry, logInteraction } from '../infra/log-first/log-first'
import type { LogDeps } from '../infra/log-first/log-first'
import { slash } from '../infra/flow-manager/move'
import type { Ask, FileSystem, Gate, GateStore, SessionLinks } from '../infra/ports/ports'

// The user approves a step with a click. The agent asks with the command `request-approval` of the flow script (python3 <plugin>/scripts/flow_manager.py request-approval --json '{}'): this mod answers it with the dialog, and the call waits for the click.
// Only this mod makes the script write `approved` (approve-step). The agent cannot run that subcommand, and cannot edit the file by hand.
// A fault in the hand-edit check refuses the call. A fault elsewhere approves nothing.

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
// The script writes `approved` (approve-step).
function approverOf($: any): Approver {
  return async (dir, stepId) => approveStep(argv => $.process.run(argv, { timeoutMs: 60_000 }), (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3', slash($.plugin.root), dir, stepId)
}
// The script sends the flow back (route-step) and starts the count of loops again (reset-loops).
function loopsOf($: any): Loops {
  return loopsOver(argv => $.process.run(argv, { timeoutMs: 60_000 }), async () => ((await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3'), slash($.plugin.root))
}
function logDepsOf($: any): LogDeps {
  return {
    files: filesOf($),
    links: linksOf($),
    complete: request => $.model.complete(request),
    script: async (sub, input) => runScript(argv => $.process.run(argv, { timeoutMs: 60_000 }), (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3', slash($.plugin.root), sub, input),
  }
}
function askOf($: any): Ask {
  return (question, options) => $.ui.ask(question, options)
}
function gatesOf($: any): GateStore {
  return {
    get: async sessionId => ((await $.store.get(`gate:${sessionId}`)) as Gate | undefined) ?? undefined,
    set: (sessionId, gate) => $.store.set(`gate:${sessionId}`, gate),
    clear: sessionId => $.store.delete(`gate:${sessionId}`),
  }
}

// A guard that blocks or re-prompts the agent says so in a toast: the user then knows why Claude changed course. One toast in 30 seconds for the same text.
let lastToast = ''
let lastToastMs = 0
async function say($: any, text: string): Promise<void> {
  const now = Date.now()
  if (text === lastToast && now - lastToastMs < 30_000) return
  lastToast = text
  lastToastMs = now
  try {
    await $.ui.toast(text)
  } catch {
    /* a surface that cannot show a toast */
  }
}

// Ask the user to approve the step that waits. The answer is the text for the agent.
async function requestApproval($: any): Promise<string> {
  const sessionId = await $.session.id()
  const files = filesOf($)
  const dir = await findFlowDir(files, linksOf($), sessionId)
  if (!dir) return 'No flow is bound to this session.'
  const step = findApprovalStep(await readFlow(files, dir))
  if (!step?.id) return 'No step is waiting for approval.'
  const gates = gatesOf($)
  const gate = { dir, stepId: step.id }
  await gates.set(sessionId, gate)
  return (await askGate(files, approverOf($), gates, askOf($), sessionId, gate, (d, request, plain) => logInteraction(logDepsOf($), d, request, plain ? approveEntry : undefined), loopsOf($))) ?? 'The approval dialog is already open. Wait for the user.'
}

export const register: Register = on => {
  on('tool.call', { tool: ['Write', 'Edit', 'MultiEdit', 'Bash'] }, async ($, e, next) => {
    const command = (e as any).command as string | undefined
    if (runsScript(command)) {
      // a script command: request-approval is answered here, every other one goes to the gate of on-flow-tools
      const parsed = parseCommand(command ?? '', slash($.plugin.root))
      if (!('error' in parsed) && parsed.sub === REQUEST_APPROVAL) return bashAnswer(await requestApproval($))
      return next(e)
    }
    if (!isHandEdit(e as any)) return next(e)
    await say($, 'Flow: Claude tried to edit a flow file by hand. The call was refused.')
    return { deny: HAND_EDIT_TEXT }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: HAND_EDIT_TEXT }))
}
