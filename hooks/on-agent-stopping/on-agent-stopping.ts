import type { Register } from 'claude-code'
import type { Step } from '../infra/flow-types/flow-types'
import { findFlowDir, readFlow, hasFlowInstance, isFlowRunning, sessionKey } from '../infra/flow-repository/flow-repository'
import { isStepExecutorRunning } from '../infra/step-executors/step-executors'
import { findLogOwed } from '../infra/log-first/log-first'
import { createRepromptLimiter } from '../infra/reprompt-limiter/reprompt-limiter'
import { isMainAgentAnswer } from '../infra/mod-events/mod-events'
import { hasOpenGate } from '../infra/approval-gate/approval-gate'
import type { FileSystem, Gate, GateStore, ListAgents, SessionLinks } from '../infra/ports/ports'

// When the main agent ends a turn while its flow still has work, send it a prompt that starts a new turn.
// Read top to bottom: the mods API, the entry point, the rules, the texts. Shared code is in ../infra.

// TODO(mods-migration, H01): this re-prompts after a turn ends because a user-installed mod's
// `classic.Stop` hook is skipped by the built-in guard (`sec-default`, "classic.Stop bypassed by
// cc-plugin-sec-default (tier user)"). Once this plugin is on the organization's mods whitelist
// (managed `appendPlugins`), replace this with `on('classic.Stop')` returning `{ block: reason }`
// (a real stop veto).

// TODO: when the mod has a settings UI, make MAX_REPROMPTS configurable (or "retry until it succeeds").
const MAX_REPROMPTS = 3
const repromptLimiter = createRepromptLimiter() // this feature's own count

type Prompt = { key: string; text: string } // key = step id + state; the re-prompt limit counts per key

// ── The mods API, as the infra functions need it ────────────────────────────

const filesOf = ($: any): FileSystem => ({
  home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
  list: path => $.fs.list(path),
  exists: path => $.fs.exists(path),
  read: path => $.fs.read(path),
})
const linksOf = ($: any): SessionLinks => ({
  get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
})
const agentsOf = ($: any): ListAgents => () => $.agent.list()
const gatesOf = ($: any): GateStore => ({
  get: async sessionId => ((await $.store.get(`gate:${sessionId}`)) as Gate | undefined) ?? undefined,
  set: (sessionId, gate) => $.store.set(`gate:${sessionId}`, gate),
  clear: sessionId => $.store.delete(`gate:${sessionId}`),
})

// Not awaited: the new turn only starts once the current one has ended.
// A guard that blocks or re-prompts the agent says so in a toast: the user then knows why Claude changed course. One toast in 30 seconds for the same text.
let lastToast = ''
let lastToastMs = 0
async function say($: any, text: string): Promise<void> {
  const now = Date.now()
  if (text === lastToast && now - lastToastMs < 30_000) return
  lastToast = text
  lastToastMs = now
  try { await $.ui.toast(text) } catch { /* a surface that cannot show a toast */ }
}
const startNewTurn = ($: any, text: string) => { void say($, 'Flow: Claude stopped early, so the flow asked it to carry on.'); void $.prompt.submit({ text }) }

// The user's own prompt starts the count again (called by the prompt hook in ../on-user-prompt).
export const startCountingAgain = () => repromptLimiter.reset()

// ── Entry point ─────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!isMainAgentAnswer(e)) return result

    const prompt = await promptToContinue($, await $.session.id())
    if (!prompt) { repromptLimiter.reset(); return result }
    const timesInARow = repromptLimiter.record(prompt.key)
    if (timesInARow <= MAX_REPROMPTS) startNewTurn($, prompt.text)
    return result
  })
}

// ── The rules ───────────────────────────────────────────────────────────────

// What the agent must do next, or undefined when it may stop.
async function promptToContinue($: any, sessionId: string): Promise<Prompt | undefined> {
  const files = filesOf($)

  // The user's last prompt has no log entry yet. Even at an approval checkpoint the agent must log it first.
  const logOwed = await findLogOwed(files, linksOf($), sessionId)
  if (logOwed) return logOwed

  const flowDir = await findFlowDir(files, linksOf($), sessionId)
  if (!hasFlowInstance(flowDir)) return
  if (await hasOpenGate(gatesOf($), sessionId)) return

  const flow = await readFlow(files, flowDir)
  if (!isFlowRunning(flow)) return

  const runningStep = flow.steps?.find(s => s.status === 'in_progress')
  const pendingStep = flow.steps?.find(s => s.status === 'pending')

  // An approval step is in progress: the agent must ask the user before it stops,
  // and no later step may start while the user has not approved this one.
  if (runningStep?.approvalRequired && !runningStep.approved) return promptForRunningStep($, runningStep, flowDir)

  // The user approved the step: the agent must complete it before anything else.
  if (runningStep?.approvalRequired) return completeApprovedStepPrompt(runningStep, flowDir)

  // No approval is open and a step has not started: the agent must delegate it, not stop.
  if (pendingStep) return startNextStepPrompt(pendingStep, flowDir)

  // A normal step is in progress: wait for its executor, or re-delegate the step if the executor is gone.
  if (runningStep) return promptForRunningStep($, runningStep, flowDir)
}

// Wait for the step's executor. With no executor, an approval step needs the user's answer and any other step is lost.
async function promptForRunningStep($: any, step: Step, flowDir: string): Promise<Prompt> {
  if (await isStepExecutorRunning(agentsOf($))) return waitForExecutorPrompt(step, flowDir)
  return step.approvalRequired ? approvalCheckpointPrompt(step, flowDir) : lostStepPrompt(step, flowDir)
}

// ── The texts ───────────────────────────────────────────────────────────────

const describeStep = (s: Step) => `Step ${s.number} — "${s.name}" (ID: ${s.id})`

function waitForExecutorPrompt(step: Step, flowDir: string): Prompt {
  return {
    key: `${step.id}:waiting`,
    text: `${describeStep(step)} is still in progress — do not stop yet.\nFlow dir: ${flowDir}\n\n` +
      'Wait for its step-executor subagent to finish.',
  }
}

function lostStepPrompt(step: Step, flowDir: string): Prompt {
  return {
    key: `${step.id}:lost`,
    text: `${describeStep(step)} is in_progress but no step-executor is running — it likely crashed or was lost.\nFlow dir: ${flowDir}\n\n` +
      'Re-delegate the step via step-executor-delegation, or mark it failed.',
  }
}

function startNextStepPrompt(step: Step, flowDir: string): Prompt {
  return {
    key: `${step.id}:pending`,
    text: `Flow has remaining steps — do not stop yet.\n\nNext step to execute: ${describeStep(step)}\nFlow dir: ${flowDir}\n\n` +
      'Continue by delegating the next step to the step-executor subagent.\n' +
      'Only stop while the user decides on an approval (after calling request_approval) or after all steps are complete.',
  }
}

function approvalCheckpointPrompt(step: Step, flowDir: string): Prompt {
  return {
    key: `${step.id}:approval`,
    text: `Approval required — step "${step.name}" has approvalRequired: true and the user has not approved it.\n` +
      `Flow dir: ${flowDir}\n\n` +
      'Before stopping, you must:\n  1. Present your deliverables to the user\n' +
      '  2. Call the tool request_approval. It shows the user a dialog and waits for the click. The answer is the result.\n\n' +
      'Only the user can approve. Do not approve in chat and do not edit flow files.',
  }
}

function completeApprovedStepPrompt(step: Step, flowDir: string): Prompt {
  return {
    key: `${step.id}:approved`,
    text: `${describeStep(step)} is approved but not completed — do not stop yet.\nFlow dir: ${flowDir}\n\n` +
      'Complete it with the tool update_step_status (status completed).',
  }
}
