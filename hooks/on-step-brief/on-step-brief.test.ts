import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`
const flowFile = (status = 'in_progress', maxFixes?: number, onVerifierFail?: string) => JSON.stringify({ status: 'running', steps: [{ id: 's1', name: 'Design', status, onVerifierFail, stepDefinition: { guidance: {}, maxFixes } }] })
const GOOD = '```json\n' + JSON.stringify({ summary: 'Plan written.', memory: [{ topic: 'context', info: { a: 1 } }], log: { actions: ['x'] } }) + '\n```'

const PASS = { status: 'ok', result: 'pass', checks: [] }
const FAIL = {
  status: 'ok',
  result: 'fail',
  checks: [
    { name: 'has rollback', passed: false, message: 'add a rollback section' },
    { name: 'has plan', passed: true },
  ],
}

// A fake disk with one flow folder bound to session S1. The engine side is a stand-in:
// it starts agent A1 with the prompt it is given, and the flow script answers for `scriptAnswers`.
// A script answer can be a list: one answer for each call, the last one repeats.
function world(on: On, { stepStatus = 'in_progress', delivered = true, maxFixes = undefined as number | undefined, onVerifierFail = undefined as string | undefined, scriptAnswers = {} as Record<string, any>, model = { isAnswered: true, text: '["f1"]' } as any } = {}) {
  const all: Record<string, string> = { [`${DIR}/flow.json`]: flowFile(stepStatus, maxFixes, onVerifierFail) }
  const script: { sub: string; input: any }[] = [],
    spawned: string[] = [],
    sent: any[] = [],
    prompts: string[] = [],
    asked: any[] = []
  mock.env(on, { HOME: '/h' })
  mock.store(on, { 'session:S1': [DIR] })
  on('session.id', async () => ({ value: 'S1' }))
  on('fs.list', async (_$, e) => ({ value: e.path === ACTIVE ? [{ name: 'p1', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.exists', async (_$, e) => ({ value: e.path in all }))
  on('fs.read', async (_$, e) => ({ value: all[e.path] }))
  on('process.run', async (_$, e: any) => {
    const [, , sub, , json] = e.argv as string[]
    script.push({ sub, input: JSON.parse(json) })
    const set = scriptAnswers[sub]
    const answer = Array.isArray(set)
      ? set.length > 1
        ? set.shift()
        : set[0]
      : (set ?? (sub === 'get-step-brief' ? { status: 'ok', text: 'THE BRIEF' } : sub === 'run-verifiers' ? PASS : { status: 'ok' }))
    return { value: { exitCode: 0, stdout: JSON.stringify(answer), stderr: '', timedOut: false } } as never
  })
  on('agent.spawn', async (_$, e: any) => {
    spawned.push(e.prompt)
    return { model: 'm', agentId: 'A1' } as never
  })
  on('session.send', async (_$, e: any) => {
    sent.push(e)
    return (delivered ? { isDelivered: true } : { isDelivered: false, reason: 'gone' }) as never
  })
  on('prompt.submit', async (_$, e: any) => {
    if (e.origin?.kind === 'plugin') prompts.push(e.text)
    return { drop: 'test' }
  })
  on('model.complete', async (_$, e: any) => {
    asked.push(e)
    return { value: model } as never
  })
  on('turn.complete', async () => ({ text: 'ENGINE' }))
  return { script, spawned, sent, prompts, asked }
}
const spawn = ($: any, prompt = 'Run the step.') => $.agent.spawn({ prompt, subagentType: 'zeremai:step-executor' })
const end = ($: any, answer: string, extra = {}) => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'A1', ...extra })
const saved = (w: ReturnType<typeof world>) => w.script.filter(c => !['get-step-brief', 'run-verifiers', 'list-flavors'].includes(c.sub))

test('the step subagent starts with the brief as its prompt', async ($, on) => {
  const w = world(on)
  await spawn($)
  expect(w.spawned).toEqual(['THE BRIEF'])
  expect(w.script[0]).toEqual({ sub: 'get-step-brief', input: { flowDir: DIR, stepId: 's1' } })
})
const LINES = { status: 'ok', flavors: [{ id: 'f1', topic: 'Tests', description: 'Use Jest.', status: 'active' }, { id: 'f2', topic: 'Git', description: 'Short titles.', status: 'active' }] }
const FULL = { status: 'ok', flavor: { id: 'f1', topic: 'Tests', text: 'Use Jest, not Vitest.', status: 'active' } }
test('Haiku names the flavors that fit, and the prompt gets a Flavors section with their full text', async ($, on) => {
  const w = world(on, { scriptAnswers: { 'list-flavors': [LINES, FULL] } })
  await spawn($)
  expect(w.asked[0].model).toBe('haiku')
  expect(w.asked[0].prompt).toContain('f2 | Git | Short titles.')
  expect(w.spawned).toEqual(['THE BRIEF\n## Flavors\nPersonal preferences of the user that fit this step. Follow them unless the step definition says otherwise.\n- Tests: Use Jest, not Vitest.\n'])
})
test('no flavor fits: the prompt is the brief', async ($, on) => {
  const w = world(on, { scriptAnswers: { 'list-flavors': LINES }, model: { isAnswered: true, text: '[]' } })
  await spawn($)
  expect(w.spawned).toEqual(['THE BRIEF'])
})
test('Haiku fails or names an id that is not saved: the step still starts, with no flavors', async ($, on) => {
  const failed = world(on, { scriptAnswers: { 'list-flavors': LINES }, model: { isAnswered: false, reason: 'timeout' } })
  await spawn($)
  expect(failed.spawned).toEqual(['THE BRIEF'])
})
test('no flavor is saved: Haiku is not called', async ($, on) => {
  const w = world(on)
  await spawn($)
  expect(w.asked).toEqual([])
})
test('a prompt that starts with "User corrections:" is a re-run, and the corrections go to the script', async ($, on) => {
  const w = world(on)
  await spawn($, 'User corrections: use PAY-124')
  expect(w.script[0].input.corrections).toBe('use PAY-124')
})
test('no step in progress: the start is refused and the reason says what to do', async ($, on) => {
  const w = world(on, { stepStatus: 'pending' })
  expect((await spawn($)).deny).toContain('update-step-status')
  expect(w.spawned).toEqual([])
})
test('a script that cannot make the brief refuses the start, with its message', async ($, on) => {
  const w = world(on, { scriptAnswers: { 'get-step-brief': { status: 'error', message: 'Empty stepDefinition' } } })
  expect((await spawn($)).deny).toBe('Empty stepDefinition')
  expect(w.spawned).toEqual([])
})
test('another agent type is left alone', async ($, on) => {
  const w = world(on)
  await $.agent.spawn({ prompt: 'Look around.', subagentType: 'Explore' })
  expect(w.spawned).toEqual(['Look around.'])
  expect(w.script).toEqual([])
})

test('a valid result block saves the memory, the re-run summary and the log, and the orchestrator reads the summary', async ($, on) => {
  const w = world(on)
  await spawn($)
  const r: any = await end($, `Done.\n${GOOD}`)
  expect(saved(w)).toEqual([
    { sub: 'add-memory-entry', input: { flowDir: DIR, stepId: 's1', topic: 'context', info: { a: 1 } } },
    { sub: 'add-memory-entry', input: { flowDir: DIR, stepId: 's1', topic: 'rerun-summary', info: { summary: 'Plan written.' } } },
    { sub: 'add-log-entry', input: { flowDir: DIR, stepId: 's1', actions: ['x'] } },
  ])
  expect(r.text).toBe('Plan written.')
  expect(w.sent).toEqual([])
})
test('a save that fails is named in what the orchestrator reads', async ($, on) => {
  world(on, { scriptAnswers: { 'add-log-entry': { status: 'error', message: 'log.json not found' } } })
  await spawn($)
  expect(((await end($, GOOD)) as any).text).toBe('Plan written.\n\nNot saved: log.json not found')
})
test('a missing block goes back to the subagent itself, and nothing is saved yet', async ($, on) => {
  const w = world(on)
  await spawn($)
  const r: any = await end($, 'Done, no block.')
  expect(w.sent.map(m => m.to)).toEqual(['A1'])
  expect(r.text).toContain('asked to fix it')
  expect(saved(w)).toEqual([])
})
test('the fixed block is saved, and the plugin tells the orchestrator', async ($, on) => {
  const w = world(on)
  await spawn($)
  await end($, 'Done, no block.')
  await end($, GOOD)
  expect(saved(w).map(c => c.sub)).toEqual(['add-memory-entry', 'add-memory-entry', 'add-log-entry'])
  expect(w.prompts).toEqual(['Plan written.'])
})
test('after 2 fix rounds the plugin says the result is missing and saves nothing', async ($, on) => {
  const w = world(on)
  await spawn($)
  await end($, 'no')
  await end($, 'no')
  await end($, 'no')
  expect(w.sent.length).toBe(2)
  expect(saved(w)).toEqual([])
  expect(w.prompts).toEqual(['Step result missing: nothing was saved. Start the step again.'])
})
test('a subagent that cannot get the message ends the step with the reason at once', async ($, on) => {
  const w = world(on, { delivered: false })
  await spawn($)
  expect(((await end($, 'no')) as any).text).toContain('Step result missing')
  expect(w.prompts).toEqual([])
})
test('the end of the main agent, or of a subagent the mod did not brief, is left alone', async ($, on) => {
  const w = world(on)
  await spawn($)
  expect(((await end($, 'x', { agentId: undefined })) as any).text).toBe('ENGINE')
  expect(((await end($, 'x', { agentId: 'other' })) as any).text).toBe('ENGINE')
  expect(w.sent).toEqual([])
  expect(saved(w)).toEqual([])
})

test('a failed check goes to the subagent with its name and message, and nothing is saved yet', async ($, on) => {
  const w = world(on, { scriptAnswers: { 'run-verifiers': FAIL } })
  await spawn($)
  const r: any = await end($, GOOD)
  expect(w.sent[0].text).toContain('- has rollback: add a rollback section')
  expect(w.sent[0].text).not.toContain('has plan')
  expect(r.text).toContain('failed its checks')
  expect(saved(w)).toEqual([])
})
test('the checks run on the step in progress', async ($, on) => {
  const w = world(on)
  await spawn($)
  await end($, GOOD)
  expect(w.script.find(c => c.sub === 'run-verifiers')?.input).toEqual({ flowDir: DIR, stepId: 's1' })
})
test('a result that passes its checks after a fix is saved, and the plugin tells the orchestrator', async ($, on) => {
  const w = world(on, { scriptAnswers: { 'run-verifiers': [FAIL, PASS] } })
  await spawn($)
  await end($, GOOD)
  await end($, GOOD)
  expect(saved(w).map(c => c.sub)).toEqual(['add-memory-entry', 'add-memory-entry', 'add-log-entry'])
  expect(w.prompts).toEqual(['Plan written.'])
})
test('checks that still fail after 2 fixes: the result is saved once and the orchestrator reads which checks fail', async ($, on) => {
  const w = world(on, { scriptAnswers: { 'run-verifiers': FAIL } })
  await spawn($)
  await end($, GOOD)
  await end($, GOOD)
  await end($, GOOD)
  expect(w.sent.length).toBe(2)
  expect(saved(w).map(c => c.sub)).toEqual(['add-memory-entry', 'add-memory-entry', 'add-log-entry'])
  expect(w.prompts[0]).toContain('Checks still fail after 2 fix tries')
  expect(w.prompts[0]).toContain('- has rollback: add a rollback section')
})
test('checks that still fail after the fix tries send the flow back by itself when the step names onVerifierFail', async ($, on) => {
  const w = world(on, { onVerifierFail: 'Plan', scriptAnswers: { 'run-verifiers': FAIL, 'route-step': { status: 'ok', target: { name: 'Plan' } } } })
  await spawn($)
  await end($, GOOD)
  await end($, GOOD)
  await end($, GOOD)
  expect(w.script.filter(c => c.sub === 'route-step').map(c => c.input)).toEqual([{ flowDir: DIR, stepId: 's1', by: 'verifier' }])
  expect(w.prompts[0]).toContain('went back by itself to step "Plan"')
  expect(w.prompts[0]).not.toContain('saved anyway')
})
test('at the limit of loops the step is blocked and the user decides', async ($, on) => {
  const w = world(on, { onVerifierFail: 'Plan', scriptAnswers: { 'run-verifiers': FAIL, 'route-step': { status: 'error', message: 'went back 3 times' } } })
  await spawn($)
  await end($, GOOD)
  await end($, GOOD)
  await end($, GOOD)
  expect(w.script.filter(c => c.sub === 'update-step-status').map(c => c.input)).toMatchObject([{ stepId: 's1', status: 'blocked' }])
  expect(w.prompts[0]).toContain('The step is blocked')
})
test('a step with no onVerifierFail never goes back by itself', async ($, on) => {
  const w = world(on, { scriptAnswers: { 'run-verifiers': FAIL } })
  await spawn($)
  await end($, GOOD)
  await end($, GOOD)
  await end($, GOOD)
  expect(w.script.some(c => c.sub === 'route-step')).toBe(false)
})
test('maxFixes of the step sets the tries: 0 saves at once with the failed checks', async ($, on) => {
  const w = world(on, { maxFixes: 0, scriptAnswers: { 'run-verifiers': FAIL } })
  await spawn($)
  const r: any = await end($, GOOD)
  expect(w.sent).toEqual([])
  expect(r.text).toContain('Checks still fail after 0 fix tries')
  expect(saved(w).length).toBe(3)
})
test('maxFixes 3 allows 3 fix messages', async ($, on) => {
  const w = world(on, { maxFixes: 3, scriptAnswers: { 'run-verifiers': FAIL } })
  await spawn($)
  for (let i = 0; i < 4; i++) await end($, GOOD)
  expect(w.sent.length).toBe(3)
})
test('a verifier command that fails does not block the step, and the orchestrator is told', async ($, on) => {
  const w = world(on, { scriptAnswers: { 'run-verifiers': { status: 'error', message: 'step not found' } } })
  await spawn($)
  const r: any = await end($, GOOD)
  expect(r.text).toBe('Plan written.\n\nVerifiers did not run: step not found')
  expect(w.sent).toEqual([])
  expect(saved(w).length).toBe(3)
})
