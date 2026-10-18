import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`
const flow = JSON.stringify({ name: 'P', status: 'running', steps: [{ id: 's7', name: 'Design' }], currentState: { activeStep: { id: 's7' } } })
const usage = { input_tokens: 1, output_tokens: 1 }

// fake disk: one flow folder bound to `boundTo`. `model` is what Haiku answers; `scripts` collects the calls of the flow script.
function world(on: On, boundTo: string, model: any = { isAnswered: true, text: '{"reason":"Wants a change","response":"Action taken: change the plan"}', usage }) {
  const all: Record<string, string> = { [`${DIR}/flow.json`]: flow }
  const scripts: { sub: string; input: any }[] = [],
    asked: any[] = []
  mock.env(on, { HOME: '/h' })
  mock.store(on, { [`session:${boundTo}`]: [DIR] })
  on('session.id', async () => ({ value: 'S1' }))
  on('fs.list', async (_$, e) => ({ value: e.path === ACTIVE ? [{ name: 'p1', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.exists', async (_$, e) => ({ value: e.path in all }))
  on('fs.read', async (_$, e) => ({ value: all[e.path] }))
  on('model.complete', async (_$, e: any) => {
    asked.push(e)
    return { value: model } as never
  })
  on('process.run', async (_$, e: any) => {
    const [, , sub, , json] = e.argv as string[]
    scripts.push({ sub, input: JSON.parse(json) })
    return { value: { exitCode: 0, stdout: JSON.stringify({ status: 'ok' }), stderr: '', timedOut: false } } as never
  })
  on('prompt.submit', async () => ({ drop: 'bottom' })) // the engine's own end: it answers, so the test sees what the hook did before it
  return { scripts, asked }
}

test('a prompt in a session with a flow: Haiku writes the details and the mod logs the entry, before the prompt goes on', async ($, on) => {
  const w = world(on, 'S1')
  const result: any = await $.prompt.submit({ text: 'please change the plan' })
  expect(w.asked[0].model).toBe('haiku')
  expect(w.scripts).toHaveLength(1)
  expect(w.scripts[0]).toEqual({
    sub: 'log-interaction',
    input: { flowDir: DIR, stepId: 's7', request: 'User requested: please change the plan', reason: 'Wants a change', response: 'Action taken: change the plan' },
  })
  expect(result.drop).toBe('bottom') // not dropped by the hook: it reached the engine
})
test('the model fails: the prompt is dropped and the user is told, and nothing is logged', async ($, on) => {
  const w = world(on, 'S1', { isAnswered: false, reason: 'api-error', usage })
  const result: any = await $.prompt.submit({ text: 'please change the plan' })
  expect(result.drop).toContain('Flow log failed')
  expect(result.drop).toContain('api-error')
  expect(w.scripts).toEqual([])
})
test('a prompt in a session with no flow: no model call, no log', async ($, on) => {
  const w = world(on, 'other')
  await $.prompt.submit({ text: 'hello' })
  expect(w.asked).toEqual([])
  expect(w.scripts).toEqual([])
})
// The origin filter (a prompt the plugin sends is not logged) is checked by a live run: a test cannot send a plugin prompt as such.
