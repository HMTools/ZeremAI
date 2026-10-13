import { test, expect } from 'claude-code/testing'
import { ACTIVE, flowFile, step, world } from '../flow-manager/fake-world'
import { changed, flowDoc, pushFlows, snapshot } from './live-page'
import type { DocWrite } from './live-page'

const D = `${ACTIVE}/p1`
const steps = [
  step({ id: 'a', number: 1, name: 'Read', status: 'completed' }),
  step({ id: 'b', number: 2, name: 'Approve', status: 'awaiting_approval', approvalRequired: true, stepDefinition: { output: { description: 'The design file' } } }),
  step({ id: 'c', number: 3, name: 'Build', status: 'pending', loopBackTo: 'a' }),
]
const disk = () => ({
  [`${D}/flow.json`]: flowFile({ metadata: { template: 'T', lastUpdated: '2026-01-01T10:00:00Z' } }, steps),
  [`${D}/log.json`]: { steps: { a: { actionsTaken: ['read it'] } } },
  [`${D}/memory/topic.json`]: { entries: { a: { informationProduced: { k: 'v' } } } },
})

test('a flow becomes one state document and three owner-only detail documents', async () => {
  const snap = (await snapshot(world(disk()).ports.files, D))!
  expect(snap.flowId).toBe('pid')
  expect(Object.keys(snap.docs)).toEqual(['flows/pid', 'details/pid~logs', 'details/pid~memory', 'details/pid~files'])
  const flow: any = snap.docs['flows/pid'].data
  expect(flow.status).toBe('waiting')
  expect(flow.needsYou).toEqual({ stepId: 'b', stepNumber: 2, stepName: 'Approve', waitsFor: 'The design file', since: '2026-01-01T10:00:00Z' })
  expect(flow.steps.map((s: any) => [s.status, s.approval, s.loopBackTo])).toEqual([['done', false, undefined], ['waiting', true, undefined], ['pending', false, 'a']])
  expect((snap.docs['details/pid~memory'].data as any).topics[0].topic).toBe('topic')
})

test('a long text is cut, and a long list too, so a document stays small', () => {
  const doc: any = flowDoc({ name: 'x'.repeat(5000), steps: Array.from({ length: 500 }, (_, i) => ({ id: String(i), status: 'pending' })) }, { topics: 0, files: 0 })
  expect(doc.name.length).toBeLessThan(2100)
  expect(doc.steps).toHaveLength(200)
})

test('only the documents that differ from the last push are written, in batches of 50, and a failed batch is tried again', async () => {
  const w = world(disk())
  const last = new Map<string, string>()
  const calls: DocWrite[][] = []
  let fail = true
  const ports = { files: w.ports.files, now: () => 'now', batch: async (writes: DocWrite[]) => { if (fail) throw new Error('down'); calls.push(writes) } }
  await expect(pushFlows(ports, last)).rejects.toThrow('down')
  expect(last.size).toBe(0) // nothing is remembered until a batch went through
  fail = false
  expect(await pushFlows(ports, last)).toBe(4)
  expect(await pushFlows(ports, last)).toBe(0) // nothing changed: no call
  w.disk[`${D}/flow.json`] = JSON.stringify(flowFile({ metadata: { template: 'T', lastUpdated: '2026-01-01T11:00:00Z' } }, steps))
  expect(await pushFlows(ports, last)).toBe(1) // only the state document changed
  expect(calls.map(c => c.length)).toEqual([4, 1])
  const many = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`c/${i}`, { op: 'set', collection: 'c', doc_id: String(i), data: { i } } as DocWrite]))
  expect(changed(new Map(), many)).toHaveLength(120)
})
