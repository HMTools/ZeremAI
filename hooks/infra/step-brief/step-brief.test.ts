import { test, expect } from 'claude-code/testing'
import { correctionsOf, readResultBlock, stepInProgress } from './step-brief'

const block = (value: unknown) => `Done.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``

test('a result block gives the summary, the memory entries and the known log lists', () => {
  const r = readResultBlock(block({
    summary: ' Plan written. ', memory: [{ topic: 'context', info: { a: 1 }, decisions: ['d1'], files: ['f1'] }],
    log: { actions: ['a'], problems: ['p'], unknown: ['x'] },
  }))
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
})) test(`${name} is no result`, () => expect(readResultBlock(text)).toBeUndefined())

test('only "User corrections:" starts a re-run', () => {
  expect(correctionsOf('User corrections: use PAY-124\nand retry')).toBe('use PAY-124\nand retry')
  expect(correctionsOf('Run the step.')).toBeUndefined()
  expect(correctionsOf('User corrections:   ')).toBeUndefined()
})
test('the step in progress, or none', () => {
  expect(stepInProgress({ steps: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'in_progress' }] })?.id).toBe('b')
  expect(stepInProgress({ steps: [{ id: 'a', status: 'pending' }] })).toBeUndefined()
  expect(stepInProgress(undefined)).toBeUndefined()
})
