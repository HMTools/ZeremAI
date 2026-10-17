import { test, expect } from 'claude-code/testing'
import { logInteraction, logPrompt, parseDetails } from './log-first'
import type { Complete, LogDeps } from './log-first'

const DIR = '/h/.claude/zeremai/active/p1'
const flow = JSON.stringify({
  name: 'Bug fix',
  status: 'running',
  currentState: { activeStep: { id: 's2' } },
  steps: [
    { id: 's1', name: 'Plan' },
    { id: 's2', name: 'Code' },
  ],
})
const reply =
  (text: string): Complete =>
  async () => ({ isAnswered: true, text })

function deps(complete: Complete, { bound = true, status = 'ok' as 'ok' | 'error' } = {}) {
  const calls: { sub: string; input: any }[] = []
  const asked: string[] = []
  const d: LogDeps = {
    files: { home: async () => '/h', list: async p => (p === '/h/.claude/zeremai/active' ? [{ name: 'p1', kind: 'dir' }] : []), exists: async p => p === `${DIR}/flow.json`, read: async () => flow },
    links: { get: async () => (bound ? [DIR] : []) },
    complete: async r => {
      asked.push(r.prompt)
      return complete(r)
    },
    script: async (sub, input) => {
      calls.push({ sub, input })
      return status === 'ok' ? { status } : { status, message: 'disk full' }
    },
  }
  return { d, calls, asked }
}

test('parseDetails: reads the JSON object, also inside a fence; needs a reason and a response; a flag needs its idea', () => {
  expect(parseDetails('```json\n{"reason":"r","response":"Action taken: x","forImprovement":true,"potentialImprovement":"ask first"}\n```')).toEqual({
    reason: 'r',
    response: 'Action taken: x',
    forImprovement: true,
    potentialImprovement: 'ask first',
  })
  expect(parseDetails('{"reason":"r","response":"a","forImprovement":true}')).toEqual({ reason: 'r', response: 'a' })
  expect(parseDetails('{"reason":"r"}')).toBeUndefined()
  expect(parseDetails('no json')).toBeUndefined()
})

test('a prompt in a flow: the model gets it and the step, the script gets the entry in the active step', async () => {
  const { d, calls, asked } = deps(reply('{"reason":"Wants blue","response":"Action taken: change the header"}'))
  expect(await logPrompt(d, 'S1', 'make the header blue')).toBeUndefined()
  expect(asked[0]).toContain('make the header blue')
  expect(asked[0]).toContain('Active step: Code')
  expect(calls).toEqual([
    { sub: 'log-interaction', input: { flowDir: DIR, stepId: 's2', request: 'User requested: make the header blue', reason: 'Wants blue', response: 'Action taken: change the header' } },
  ])
})

test('no flow for the session: nothing is asked and nothing is logged', async () => {
  const { d, calls, asked } = deps(reply('{}'), { bound: false })
  expect(await logPrompt(d, 'S1', 'hello')).toBeUndefined()
  expect(asked).toEqual([])
  expect(calls).toEqual([])
})

test('a failure comes back as text and nothing is written: no answer, bad JSON, a model call that throws, a script that refuses', async () => {
  const none = deps(async () => ({ isAnswered: false, reason: 'api-error' }))
  expect(await logPrompt(none.d, 'S1', 'x')).toContain('api-error')
  const bad = deps(reply('sorry'))
  expect(await logPrompt(bad.d, 'S1', 'x')).toContain('JSON')
  const thrown = deps(async () => {
    throw new Error('blocked model')
  })
  expect(await logPrompt(thrown.d, 'S1', 'x')).toContain('blocked model')
  for (const w of [none, bad, thrown]) expect(w.calls).toEqual([])
  const refused = deps(reply('{"reason":"r","response":"a"}'), { status: 'error' })
  expect(await logPrompt(refused.d, 'S1', 'x')).toContain('disk full')
})

test('an answer in a dialog is logged as it is worded, with no prefix', async () => {
  const { d, calls } = deps(reply('{"reason":"r","response":"a"}'))
  await logInteraction(d, DIR, 'User approved step 1 "Plan"')
  expect(calls[0].input.request).toBe('User approved step 1 "Plan"')
})
