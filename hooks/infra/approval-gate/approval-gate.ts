import type { Flow, Step } from '../flow-types/flow-types'
import { readFlow } from '../flow-repository/flow-repository'
import { slash } from '../flow-manager/move'
import type { Ask, FileSystem, Gate, GateStore } from '../ports/ports'

// The approval gate. The agent asks, the user answers with a click, and only the mod makes the script write `approved` (approve-step).

// Logs the user's answer in the flow log (the mod builds it from the log module). Resolves the problem, or undefined when it is logged.
// `plain` is true for an Approve with no text: the log needs no model to say why.
export type AnswerLog = (dir: string, request: string, plain?: boolean) => Promise<string | undefined>

// Writes `approved` on the step: the mod builds it from the script, so the rules of the script apply.
export type Approver = (dir: string, stepId: string) => Promise<void>

// A Back button of an approval step: the click sends the flow back to `goTo` (a step name). A click has no limit.
export type Route = { label: string; goTo: string }
// What the mod does with the script when the user goes back (route-step), and when the user asks for changes (reset-loops).
export type Loops = {
  route(dir: string, stepId: string, label: string): Promise<{ name: string; number: number }>
  reset(dir: string, stepId: string): Promise<void>
}
// The Back buttons of a step: its `routes`, or `loopBackTo` as one route. The same rule as routes_of in flow_manager.py.
export const routesOf = (step: Step): Route[] => {
  const routes = (step.routes ?? []).filter(r => r?.label && r?.goTo)
  return routes.length ? routes : step.loopBackTo && step.approvalRequired ? [{ label: `Back to ${step.loopBackTo}`, goTo: step.loopBackTo }] : []
}

// The tool the agent calls to ask the user. It is listed with the flow tools (see ensureFlowTools).
export const REQUEST_APPROVAL_TOOL = {
  name: 'request_approval',
  description:
    'Ask the user to approve the step that waits for approval. Call it when the step is done. ' +
    'It shows the user a dialog and waits for the click. The answer is the result. Only the user can approve.',
  inputSchema: { type: 'object', properties: {} } as Record<string, any>,
  isDeferred: true,
}

export const APPROVE = 'Approve'
export const CHANGES = 'Request changes'
const CANCEL = 'Cancel'

export const hasOpenGate = async (gates: GateStore, sessionId: string) => (await gates.get(sessionId)) !== undefined

// The step the user has to approve now.
export const findApprovalStep = (flow: Flow | undefined): Step | undefined => flow?.steps?.find(s => s.status === 'in_progress' && s.approvalRequired && !s.approved)

export function questionFor(step: Step, dir: string): string {
  const output = step.stepDefinition?.output
  const artifacts = output?.artifacts?.length ? `Output: ${output.artifacts.join(', ')}` : ''
  return [`Approve step ${step.number} "${step.name}"?`, output?.description, artifacts, `Flow dir: ${dir}`].filter(Boolean).join('\n')
}

// Only one question for each session at a time.
const asking = new Set<string>()

// Asks the user and returns what the agent reads, or undefined when a question is already open for this session.
// An answer of Approve sets `approved`. A Back button sends the flow back (it asks why first). Request changes also starts the count of loops again.
// A dismissed question leaves the gate open.
export async function askGate(files: FileSystem, approve: Approver, gates: GateStore, ask: Ask, sessionId: string, gate: Gate, log?: AnswerLog, loops?: Loops): Promise<string | undefined> {
  if (asking.has(sessionId)) return
  asking.add(sessionId)
  try {
    const flow = await readFlow(files, gate.dir)
    const step = flow?.steps?.find(s => s.id === gate.stepId)
    if (!flow || !step) {
      await gates.clear(sessionId)
      return 'The gate named a step that is no longer in the flow. The gate is closed.'
    }
    let answer = ''
    let route: Route | undefined
    let reason = ''
    await gates.set(sessionId, { ...gate, dialog: true }) // the pane shows its own buttons only while no dialog is open
    const routes = routesOf(step)
    try {
      for (;;) {
        answer = await ask(questionFor(step, gate.dir), [APPROVE, ...routes.map(r => r.label), CHANGES])
        route = routes.find(r => r.label === answer)
        if (!route) break
        reason = (await ask(`Why do you go back to "${route.goTo}"? Type the reason.`, [CANCEL])).trim() // a reason is required
        if (reason && reason !== CANCEL) break
      }
    } catch {
      await gates.set(sessionId, { dir: gate.dir, stepId: gate.stepId })
      return 'The user did not answer. The gate stays open, and only the user can approve.'
    }
    await gates.clear(sessionId)
    if (route) return goBack(step, gate, route, reason, log, loops)
    const problem = await log?.(gate.dir, answerRequest(step, answer === APPROVE ? undefined : answer === CHANGES ? '(no text given)' : answer), answer === APPROVE)
    if (problem) return logFailedText(problem)
    if (answer !== APPROVE) {
      await resetCount(loops, gate.dir, gate.stepId)
      return changesText(step, answer === CHANGES ? '(no text given)' : answer)
    }
    await markApproved(approve, gate)
    return approvedText(step)
  } finally {
    asking.delete(sessionId)
  }
}

const answerRequest = (step: Step, change: string | undefined) =>
  change === undefined ? `User approved step ${step.number} "${step.name}"` : `User asked for changes to step ${step.number} "${step.name}": ${change}`
const logFailedText = (problem: string) => `The mod could not log the answer of the user: ${problem}\nStop and tell the user about this problem. Do not go on.`
const approvedText = (step: Step) => `The user approved step ${step.number} "${step.name}". Complete it with update-step-status (status completed).`
const changesText = (step: Step, why: string) => `The user asked for changes to step ${step.number} "${step.name}": ${why}\nChange the step. When it is ready, call request-approval again.`

const backRequest = (step: Step, route: Route, reason: string) => `User sent the flow back from step ${step.number} "${step.name}" to "${route.goTo}" (${route.label}): ${reason}`
const backText = (step: Step, went: { name: string }, reason: string) =>
  `The user sent the flow back to step "${went.name}". Reason: ${reason}\n` +
  `The steps from "${went.name}" to "${step.name}" are pending again. Their notes and logs stay, so this is a second pass: fix the work, do not start from zero. Go on with the step loop at "${went.name}".`

// The user pressed a Back button and gave a reason. The log comes first, then the script sends the flow back.
async function goBack(step: Step, gate: Gate, route: Route, reason: string, log?: AnswerLog, loops?: Loops): Promise<string> {
  const problem = await log?.(gate.dir, backRequest(step, route, reason))
  if (problem) return logFailedText(problem)
  try {
    return backText(step, await loops!.route(gate.dir, gate.stepId, route.label), reason)
  } catch (error) {
    return `The script did not send the flow back: ${error instanceof Error ? error.message : String(error)}\nCall request-approval again.`
  }
}
// The user asked for changes: the loops of the step start again. A fault here must not lose the answer of the user.
async function resetCount(loops: Loops | undefined, dir: string, stepId: string): Promise<void> {
  try {
    await loops?.reset(dir, stepId)
  } catch {
    /* the count stays; the next click of the user tries again */
  }
}

// The script reads the file again under its lock: a command can change it while the user decides.
const markApproved = (approve: Approver, gate: Gate) => approve(gate.dir, gate.stepId)

// ── The same answer from the pane ───────────────────────────────────────────

// What the gate card in the pane shows for the flow bound to the session.
//   working: the step runs and the agent has not asked yet, so there is nothing to approve
//   dialog: the agent's question is on screen, so the user answers there
//   ready: the agent asked and no dialog is open (it was dismissed), so the pane has the buttons
export type PaneGate = { state: 'working' | 'dialog' | 'ready'; stepId: string; number: string; name: string; output: string; routes: Route[] }

export function gateForPane(flow: Flow | undefined, gate: Gate | undefined, dir: string): PaneGate | undefined {
  const step = findApprovalStep(flow)
  if (!step?.id) return
  const asked = gate !== undefined && gate.dir === dir && gate.stepId === step.id
  const output = step.stepDefinition?.output
  return {
    state: !asked ? 'working' : gate.dialog ? 'dialog' : 'ready',
    stepId: step.id,
    number: String(step.number),
    name: step.name ?? '',
    output: [output?.description, output?.artifacts?.length ? `Output: ${output.artifacts.join(', ')}` : ''].filter(Boolean).join(' · '),
    routes: routesOf(step),
  }
}

export type PaneAnswer = { text: string } | { error: string }

// The user presses Approve, Request changes or a Back button in the pane. Everything is checked again now, not when the card was drawn:
// the step must still be the one that waits, the agent must have asked, and no dialog may be open.
async function answerFromPane(
  files: FileSystem,
  approve: Approver,
  gates: GateStore,
  sessionId: string,
  dir: string,
  stepId: string,
  change: string | undefined,
  log?: AnswerLog,
  loops?: Loops,
  back?: { label: string },
): Promise<PaneAnswer> {
  const gate = await gates.get(sessionId)
  const now = gateForPane(await readFlow(files, dir), gate, dir)
  if (!now || now.stepId !== stepId) return { error: 'That step no longer waits for approval.' }
  if (now.state === 'dialog') return { error: 'Answer the dialog that is open.' }
  if (now.state === 'working') return { error: 'The agent has not asked for approval yet.' }
  const step = (await readFlow(files, dir))?.steps?.find(s => s.id === stepId)
  if (!step) return { error: 'That step no longer waits for approval.' }
  if (back) {
    const route = routesOf(step).find(r => r.label === back.label)
    if (!route) return { error: 'That step has no such Back button.' }
    const why = (change ?? '').trim()
    if (!why) return { error: 'Say why you go back.' } // a reason is required
    const problem = await log?.(dir, backRequest(step, route, why))
    if (problem) return { error: `The log of your answer failed: ${problem}` }
    try {
      const went = await loops!.route(dir, stepId, route.label)
      await gates.clear(sessionId)
      return { text: backText(step, went, why) }
    } catch (error) {
      return { error: `The script did not send the flow back: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  const problem = await log?.(dir, answerRequest(step, change === undefined ? undefined : change.trim() || '(no text given)'), change === undefined)
  if (problem) return { error: `The log of your answer failed: ${problem}` }
  if (change !== undefined) await resetCount(loops, dir, stepId)
  if (change === undefined) {
    try {
      await markApproved(approve, { dir, stepId })
    } catch (error) {
      return { error: `The script did not approve: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  await gates.clear(sessionId)
  return { text: change === undefined ? approvedText(step) : changesText(step, change.trim() || '(no text given)') }
}
export const approveFromPane = (files: FileSystem, approve: Approver, gates: GateStore, sessionId: string, dir: string, stepId: string, log?: AnswerLog) =>
  answerFromPane(files, approve, gates, sessionId, dir, stepId, undefined, log)
export const requestChangesFromPane = (files: FileSystem, approve: Approver, gates: GateStore, sessionId: string, dir: string, stepId: string, reason: string, log?: AnswerLog, loops?: Loops) =>
  answerFromPane(files, approve, gates, sessionId, dir, stepId, reason, log, loops)
export const goBackFromPane = (files: FileSystem, approve: Approver, gates: GateStore, sessionId: string, dir: string, stepId: string, label: string, reason: string, log?: AnswerLog, loops?: Loops) =>
  answerFromPane(files, approve, gates, sessionId, dir, stepId, reason, log, loops, { label })

// A prompt arrives while a gate is open: the dialog opens again. The prompt itself goes on.
// The answer reaches the agent as a prompt of its own. Not awaited: the dialog waits for the user.
export async function reopenPanel(files: FileSystem, approve: Approver, gates: GateStore, ask: Ask, send: (text: string) => Promise<unknown>, sessionId: string, log?: AnswerLog, loops?: Loops): Promise<void> {
  const gate = await gates.get(sessionId)
  if (!gate) return
  askGate(files, approve, gates, ask, sessionId, gate, log, loops)
    .then(async text => {
      if (text && !(await hasOpenGate(gates, sessionId))) await send(text)
    }) // a dismissed dialog leaves the gate open and says nothing
    .catch(() => {})
}

// ── The agent must not write flow files ──────────────────────────────────

// The flow, log and memory files of a flow folder, the improvement findings and the flavors. Only the flow tools write them.
const STATE_FILE = /\.claude\/zeremai\/(?:(?:active|completed|failed)\/[^/]+\/(?:(?:flow|log)\.json|memory\/[^/]+\.json)|(?:improvement-findings|flavors)\/.+\.json)$/
const STATE_NAME = /\b(?:flow|log)\.json\b|zeremai[\\/]\S*memory[\\/]|improvement-findings|zeremai[\\/]flavors/
// A guess: a command that names a state file and looks like a write. A script file that edits one passes.
const BASH_WRITE = /(?<![0-9&])>|\bsed\b.*\s-\S*i|\btee\b|\bpython3?\b|\bnode\b|\bperl\b|\bruby\b|\bjq\b|\bmv\b|\bcp\b|\bdd\b/

export type HandEditCall = { tool: string; command?: string; file_path?: string }

export function isHandEdit(call: HandEditCall): boolean {
  if (call.tool === 'Write' || call.tool === 'Edit' || call.tool === 'MultiEdit') return STATE_FILE.test(slash(call.file_path ?? ''))
  if (call.tool !== 'Bash') return false
  const command = call.command ?? ''
  return STATE_NAME.test(command) && BASH_WRITE.test(command)
}

export const HAND_EDIT_TEXT =
  'Flow files change only through the flow script (python3 scripts/flow_manager.py update-step-status, add-log-entry, add-memory-entry and the others). Do not edit them by hand. Only the user approves a step, with a click in the approval dialog.'
