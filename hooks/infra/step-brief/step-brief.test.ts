import { test, expect } from 'claude-code/testing'
import { correctionsOf, failedChecksMessage, fixLimit, readResultBlock, readVerifierRun, stepInProgress } from './step-brief'

const block = (value: unknown) => `Done.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``

test('a result block gives the summary, the memory entries and the known log lists', () => {
  const r = readResultBlock(
    block({
      summary: ' Plan written. ',
      memory: [{ topic: 'context', info: { a: 1 }, decisions: ['d1'], files: ['f1'] }],
      log: { actions: ['a'], problems: ['p'], unknown: ['x'] },
    }),
  )
  expect(r).toEqual({ summary: 'Plan written.', memory: [{ topic: 'context', info: { a: 1 }, decisions: ['d1'], files: ['f1'] }], log: { actions: ['a'], problems: ['p'] } })
})
test('memory and log can be left out', () => {
  expect(readResultBlock(block({ summary: 'ok' }))).toEqual({ summary: 'ok', memory: [], log: {} })
})
test('the last json block counts', () => {
  expect(readResultBlock(`${block({ summary: 'first' })}\n\nOops.\n${block({ summary: 'second' })}`)?.summary).toBe('second')
})
for (const [name, text] of Object.entries({
  'no block': 'Done.',
  'not json': '```json\n{nope\n```',
  'no summary': block({ memory: [] }),
  'an empty summary': block({ summary: '  ' }),
  'memory that is not a list': block({ summary: 'x', memory: {} }),
  'an entry with no topic': block({ summary: 'x', memory: [{ info: {} }] }),
  'decisions that are not text': block({ summary: 'x', memory: [{ topic: 't', decisions: [1] }] }),
  'a log list that is not text': block({ summary: 'x', log: { actions: [1] } }),
}))
  test(`${name} is no result`, () => expect(readResultBlock(text)).toBeUndefined())

test('only "User corrections:" starts a re-run', () => {
  expect(correctionsOf('User corrections: use PAY-124\nand retry')).toBe('use PAY-124\nand retry')
  expect(correctionsOf('Run the step.')).toBeUndefined()
  expect(correctionsOf('User corrections:   ')).toBeUndefined()
})
test('the step in progress, or none', () => {
  expect(
    stepInProgress({
      steps: [
        { id: 'a', status: 'completed' },
        { id: 'b', status: 'in_progress' },
      ],
    })?.id,
  ).toBe('b')
  expect(stepInProgress({ steps: [{ id: 'a', status: 'pending' }] })).toBeUndefined()
  expect(stepInProgress(undefined)).toBeUndefined()
})

test('the fix limit is the maxFixes of the step, 2 if it is not a whole number from 0 to 5', () => {
  const of = (maxFixes: unknown) => fixLimit({ stepDefinition: { maxFixes } as never })
  expect([of(0), of(3), of(5)]).toEqual([0, 3, 5])
  expect([of(undefined), of(-1), of(6), of(1.5), of('3')]).toEqual([2, 2, 2, 2, 2])
  expect(fixLimit(undefined)).toBe(2)
})
test('a verifier run is the answer of the script when it says pass or fail with a list of checks', () => {
  expect(readVerifierRun({ status: 'ok', result: 'fail', checks: [{ name: 'a', passed: false }] })).toEqual({ result: 'fail', checks: [{ name: 'a', passed: false }] })
  for (const bad of [{ status: 'error', message: 'x' }, { status: 'ok' }, { status: 'ok', result: 'maybe', checks: [] }, { status: 'ok', result: 'pass' }]) expect(readVerifierRun(bad)).toBeUndefined()
})
test('the message to the subagent lists only the failed checks', () => {
  const text = failedChecksMessage([
    { name: 'a', passed: false, message: 'fix a' },
    { name: 'b', passed: true },
    { name: 'c', passed: false },
  ])
  expect(text).toContain('- a: fix a\n- c\n')
  expect(text).not.toContain('- b')
})

test('a blocked note keeps the reason and the command', () => {
  expect(readResultBlock(block({ summary: 'x', blocked: { reason: ' The az login expired. ', command: 'az login' } }))?.blocked).toEqual({ reason: 'The az login expired.', command: 'az login' })
  expect(readResultBlock(block({ summary: 'x', blocked: { reason: 'No access.', command: ' ' } }))?.blocked).toEqual({ reason: 'No access.' })
  expect(readResultBlock(block({ summary: 'x' }))?.blocked).toBeUndefined()
})
for (const blocked of [{}, { reason: ' ' }, { reason: 'r', command: 1 }, 'text'])
  test(`a wrong blocked note (${JSON.stringify(blocked)}) is no result`, () => expect(readResultBlock(block({ summary: 'x', blocked }))).toBeUndefined())
