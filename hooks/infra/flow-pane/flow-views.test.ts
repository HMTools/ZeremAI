import { test, expect } from 'claude-code/testing'
import { ACTIVE, flowFile, step, world } from '../flow-manager/fake-world'
import { filesView, logView, memoryView, tabCounts, timesOf } from './flow-views'

const D = `${ACTIVE}/p1`
const steps = [
  step({ id: 'a', number: 1, name: 'Read', status: 'completed', stepDefinition: { memoryFileUsage: { writeTo: ['invoice.json'] } } }),
  step({ id: 'b', number: 2, name: 'Approve', status: 'in_progress', stepDefinition: { memoryFileUsage: { readFrom: ['invoice'], writeTo: ['approvals'] } } }),
]

test('memory: topics with who wrote and who read, history newest first, and what changed between entries', async () => {
  const w = world({
    [`${D}/flow.json`]: flowFile({}, steps),
    [`${D}/memory/invoice.json`]: {
      entries: {
        a: { informationProduced: { total: '4,200', vendor: 'Acme' }, updatedAt: '2026-01-01T10:00' },
        b: { informationProduced: { total: '4,500', note: 'x' }, updatedAt: '2026-01-01T11:00', decisionsMade: ['ok'] },
      },
    },
    [`${D}/memory/approvals.json`]: { entries: { b: { informationProduced: { verdict: 'yes' }, updatedAt: '2026-01-01T12:00' } } },
    [`${D}/memory/_cross-references.json`]: { links: [] },
  })
  const m = await memoryView(w.ports.files, D)
  expect(m.topics.map(t => t.topic)).toEqual(['approvals', 'invoice']) // the cross-references file is no topic
  const invoice = m.topics.find(t => t.topic === 'invoice')!
  expect(invoice).toMatchObject({ writtenBy: ['1', '2'], readBy: ['2'] })
  expect(m.history.map(e => `${e.topic}:${e.step}`)).toEqual(['approvals:2', 'invoice:2', 'invoice:1'])
  expect(m.diffs).toEqual([{ topic: 'invoice', from: '1', to: '2', lines: ['+ note: x', '- vendor', '~ total: 4,200 → 4,500'] }])
})

test('logs: one row for each step, and the three time formats', async () => {
  expect(timesOf('t0')).toEqual({ started: 't0' })
  expect(timesOf({ startedAt: 's', completedAt: 'c' })).toEqual({ started: 's', completed: 'c' })
  expect(timesOf({ started: 's', completed: 'c' })).toEqual({ started: 's', completed: 'c' })
  expect(timesOf(undefined)).toEqual({})
  const w = world({
    [`${D}/flow.json`]: flowFile({}, steps),
    [`${D}/log.json`]: { steps: { a: { timestamp: { started: 's', completed: 'c' }, actionsTaken: ['read it'], problemsEncountered: ['slow'] } } },
  })
  const rows = await logView(w.ports.files, D)
  expect(rows.map(r => [r.number, r.kind])).toEqual([
    ['1', 'done'],
    ['2', 'running'],
  ])
  expect(rows[0]).toMatchObject({ started: 's', completed: 'c', actions: ['read it'], problems: ['slow'] })
  expect(rows[1]).toMatchObject({ actions: [], problems: [] }) // no entry yet
})

test('files: output first, framework files apart, a touched file knows its step', async () => {
  const w = world({
    [`${D}/flow.json`]: flowFile({}, steps),
    [`${D}/log.json`]: { steps: { b: { filesModified: ['notes/approval.md', '/repo/src/x.ts'] } } },
    [`${D}/memory/invoice.json`]: { entries: { a: { filesModifiedCreated: ['report.md'] } } },
    [`${D}/notes/approval.md`]: 'x',
    [`${D}/report.md`]: 'y',
    [`${D}/other.txt`]: 'z',
  })
  const rows = await filesView(w.ports.files, D)
  const out = rows.filter(r => r.output).map(r => [r.name, r.step, r.openable])
  expect(out).toEqual([
    ['/repo/src/x.ts', '2', false],
    ['notes/approval.md', '2', true],
    ['other.txt', undefined, true],
    ['report.md', '1', true],
  ])
  expect(
    rows
      .filter(r => !r.output)
      .map(r => r.name)
      .sort(),
  ).toEqual(['flow.json', 'log.json', 'memory/invoice.json'])
})

test('the tab counts come from folder listings: topics without the cross-references file, and files without the framework files', async () => {
  const w = world({
    [`${D}/flow.json`]: flowFile({}, steps),
    [`${D}/log.json`]: {},
    [`${D}/memory/invoice.json`]: {},
    [`${D}/memory/approvals.json`]: {},
    [`${D}/memory/_cross-references.json`]: {},
    [`${D}/notes/a.md`]: 'x',
    [`${D}/b.md`]: 'y',
  })
  expect(await tabCounts(w.ports.files, D)).toEqual({ topics: 2, files: 2 })
})
