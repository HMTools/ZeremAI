import type { Register } from 'claude-code'
import { findFlowDir, readFlow, sessionKey } from '../infra/flow-repository/flow-repository'
import { runScript } from '../infra/flow-manager/script'
import { slash } from '../infra/flow-manager/move'
import { FIX_MESSAGE, briefedKey, correctionsOf, failedChecksMessage, failedLines, fixLimit, fixesKey, readResultBlock, readVerifierRun, stepInProgress } from '../infra/step-brief/step-brief'
import type { StepRef } from '../infra/step-brief/step-brief'
import type { FileSystem, SessionLinks } from '../infra/ports/ports'

// The mod, not the subagent, reads the step and writes its results.
//  - agent.spawn: the orchestrator starts the step subagent. The mod finds the step in progress, asks the flow script for the
//    brief (step, parameters, memory, and on a re-run the earlier summary and the corrections) and makes it the prompt.
//  - turn.complete: the subagent ends with a result block. The mod saves the memory and the log with the flow script.
//    A missing or wrong block is sent back to the subagent itself, so the orchestrator does not carry it.
//    Then the mod runs the verifier scripts of the step. A failed check goes back to the subagent the same way. A step saves once: when its checks pass, or when no fix is left.
// The orchestrator still sets the step status: a step that needs approval completes only after the click of the user.

const WAIT = (what: string) => `${what} The subagent is asked to fix it. Wait: the plugin tells you when it is saved.`

const filesOf = ($: any): FileSystem => ({
  home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
  list: path => $.fs.list(path),
  exists: path => $.fs.exists(path),
  read: path => $.fs.read(path),
})
const linksOf = ($: any): SessionLinks => ({
  get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
})
const scriptOf = ($: any) => async (sub: string, input: Record<string, unknown>) =>
  runScript(argv => $.process.run(argv, { timeoutMs: 60_000 }), (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3', slash($.plugin.root), sub, input)

const forget = async ($: any, agentId: string) => { await $.store.delete(briefedKey(agentId)); await $.store.delete(fixesKey(agentId)) }
// Not awaited: the new turn of the orchestrator starts once its current one has ended.
const tellOrchestrator = ($: any, text: string) => { void $.prompt.submit({ text }) }

export const register: Register = on => {
  on('agent.spawn', { subagentType: 'zeremai:step-executor' },async ($, e, next) => {
    const files = filesOf($)
    const flowDir = await findFlowDir(files, linksOf($), await $.session.id())
    const step = stepInProgress(flowDir ? await readFlow(files, flowDir) : undefined)
    if (!flowDir || !step?.id) return { deny: 'No step is in progress. Set the step to in_progress with update-step-status, then start the subagent again.' }
    const brief = await scriptOf($)('get-step-brief', { flowDir, stepId: step.id, corrections: correctionsOf(e.prompt) })
    if (brief.status !== 'ok') return { deny: String(brief.message ?? 'get-step-brief failed') }
    const started: any = await next({ ...e, prompt: String(brief.text) })
    if (started.agentId) await $.store.set(briefedKey(started.agentId), { flowDir, stepId: step.id, maxFixes: fixLimit(step) } satisfies StepRef)
    return started
  })

  // A matcher on the agent: the stop guard in ../on-agent-stopping hooks this event for the main agent, and a second hook needs its own.
  on('turn.complete', { agentId: /./ }, async ($, e, next) => {
    const agentId = e.agentId
    if (!agentId || e.reason !== 'answer') return next(e)
    const ref = (await $.store.get(briefedKey(agentId))) as StepRef | undefined
    if (!ref) return next(e) // not a step subagent
    const done = await next(e)
    const fixes = ((await $.store.get(fixesKey(agentId))) as number | undefined) ?? 0 // fix rounds so far
    const say = (text: string) => fixes ? (tellOrchestrator($, text), done) : { ...done, text } // in a fix round the orchestrator already waits

    // The mod talks to the subagent itself. A hook has a short budget, so it does not wait: the next end of the subagent comes back here.
    // The answer is the reply to give, or undefined when no fix is left or the message did not arrive.
    const askFix = async (message: string, what: string) => {
      const sent = fixes < ref.maxFixes ? await $.session.send({ to: { agentId }, text: message }).catch(() => ({ isDelivered: false })) : { isDelivered: false }
      if (!sent.isDelivered) return
      await $.store.set(fixesKey(agentId), fixes + 1)
      return fixes ? done : { ...done, text: WAIT(what) }
    }

    const result = readResultBlock(e.answer)
    if (!result) {
      const asked = await askFix(FIX_MESSAGE, 'The result of the step is missing.')
      if (asked) return asked
      await forget($, agentId)
      return say('Step result missing: nothing was saved. Start the step again.')
    }

    const script = scriptOf($)
    const out = await script('run-verifiers', { flowDir: ref.flowDir, stepId: ref.stepId })
    const run = readVerifierRun(out)
    if (run?.result === 'fail') {
      const asked = await askFix(failedChecksMessage(run.checks), 'The result of the step failed its checks.')
      if (asked) return asked
    }

    await forget($, agentId)
    const saves = [
      ...result.memory.map(m => script('add-memory-entry', { flowDir: ref.flowDir, stepId: ref.stepId, ...m })),
      script('add-memory-entry', { flowDir: ref.flowDir, stepId: ref.stepId, topic: 'rerun-summary', info: { summary: result.summary } }),
      script('add-log-entry', { flowDir: ref.flowDir, stepId: ref.stepId, ...result.log }),
    ]
    const failed: string[] = []
    for (const save of await Promise.all(saves)) if (save.status !== 'ok') failed.push(String(save.message))
    const notes = [
      ...(run ? [] : [`Verifiers did not run: ${String(out.message ?? 'bad answer')}`]),
      ...(run?.result === 'fail' ? [`Checks still fail after ${fixes} fix tries (the result is saved anyway):\n${failedLines(run.checks)}`] : []),
      ...(failed.length ? [`Not saved: ${failed.join(' | ')}`] : []),
    ]
    return say([result.summary, ...notes].join('\n\n'))
  })
}
