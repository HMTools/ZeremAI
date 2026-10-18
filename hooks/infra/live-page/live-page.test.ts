import { test, expect } from 'claude-code/testing'
import { ACTIVE, flowFile, step, world } from '../flow-manager/fake-world'
import { changed, describeTool, withAllowRules, flowDoc, pushFlows, readTheme, snapshot, themeDoc, writeTheme } from './live-page'
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

test('the card of a waiting step carries its Back buttons; a loopBackTo on an approval step is one of them', () => {
  const doc = (extra: object) => flowDoc(flowFile({}, [step({ id: 'a', number: 1, name: 'Plan', status: 'completed' }), step({ id: 'b', number: 2, name: 'Approve', status: 'awaiting_approval', approvalRequired: true, ...extra })]), { topics: 0, files: 0 }) as any
  expect(doc({ routes: [{ label: 'Back to the plan', goTo: 'Plan' }, { label: 'Back', goTo: 'x' }] }).needsYou.routes).toEqual([{ label: 'Back to the plan', to: 'Plan' }, { label: 'Back', to: 'x' }])
  expect(doc({ loopBackTo: 'Plan' }).needsYou.routes).toEqual([{ label: 'Back to Plan', to: 'Plan' }])
  expect(doc({}).needsYou.routes).toBeUndefined()
  expect(doc({ routes: [{ label: 'B', goTo: 'Plan' }], onVerifierFail: 'Plan' }).steps[1]).toMatchObject({ routes: [{ label: 'B', goTo: 'Plan' }], onVerifierFail: 'Plan' })
})
test('a flow becomes one state document and three owner-only detail documents', async () => {
  const snap = (await snapshot(world(disk()).ports.files, D))!
  expect(snap.flowId).toBe('pid')
  expect(Object.keys(snap.docs)).toEqual(['flows/pid', 'details/pid~logs', 'details/pid~memory', 'details/pid~files'])
  const flow: any = snap.docs['flows/pid'].data
  expect(flow.status).toBe('waiting')
  expect(flow.needsYou).toEqual({ stepId: 'b', stepNumber: 2, stepName: 'Approve', waitsFor: 'The design file', since: '2026-01-01T10:00:00Z' })
  expect(flow.steps.map((s: any) => [s.status, s.approval, s.loopBackTo])).toEqual([
    ['done', false, undefined],
    ['waiting', true, undefined],
    ['pending', false, 'a'],
  ])
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
  const ports = {
    files: w.ports.files,
    now: () => 'now',
    batch: async (writes: DocWrite[]) => {
      if (fail) throw new Error('down')
      calls.push(writes)
    },
  }
  await expect(pushFlows(ports, last)).rejects.toThrow('down')
  expect(last.size).toBe(0) // nothing is remembered until a batch went through
  fail = false
  expect(await pushFlows(ports, last)).toBe(4)
  expect(await pushFlows(ports, last)).toBe(0) // nothing changed: no call
  w.disk[`${D}/flow.json`] = JSON.stringify(flowFile({ metadata: { template: 'T', lastUpdated: '2026-01-01T11:00:00Z' } }, steps))
  expect(await pushFlows(ports, last)).toBe(1) // only the state document changed
  expect(calls.map(c => c.length)).toEqual([4, 1])
  for (const path of Object.keys(w.disk)) if (path.startsWith(`${D}/`)) delete w.disk[path] // the flow is deleted
  expect(await pushFlows(ports, last)).toBe(4) // its four rows are deleted from the page
  expect(calls.at(-1)!.every(c => c.op === 'delete')).toBe(true)
  expect(last.size).toBe(0)
  expect(await pushFlows(ports, last)).toBe(0)
  const many = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`c/${i}`, { op: 'set', collection: 'c', doc_id: String(i), data: { i } } as DocWrite]))
  expect(changed(new Map(), many)).toHaveLength(120)
})

test('a blocked step is what needs you: its reason and its command, not an approval', () => {
  const doc: any = flowDoc(flowFile({}, [step({ id: 'a', number: 0, name: 'Read PBI', status: 'blocked', blocked: { reason: 'The az login expired.', command: 'az login', since: 'then' } })]), {
    topics: 0,
    files: 0,
  })
  expect(doc.status).toBe('blocked')
  expect(doc.needsYou).toEqual({ stepId: 'a', stepNumber: 0, stepName: 'Read PBI', waitsFor: 'The az login expired.', blocked: true, command: 'az login', since: 'then' })
  expect(doc.steps[0].status).toBe('blocked')
})

test('a running flow carries the last tool call of the agent, a flow that waits does not', () => {
  const act = { text: 'Edit refund.ts', at: 'now' }
  const run: any = flowDoc(flowFile({}, [step({ id: 'a', number: 1, name: 'Build', status: 'in_progress' })]), { topics: 0, files: 0 }, act)
  expect(run.activity).toEqual(act)
  const wait: any = flowDoc(flowFile({}, steps), { topics: 0, files: 0 }, act)
  expect(wait.activity).toBeUndefined()
})

test('a tool call becomes one short line, and the calls that are noise give none', () => {
  expect(describeTool({ tool: 'Edit', file_path: '/w/src/refund-service.ts' })).toBe('Edit refund-service.ts')
  expect(describeTool({ tool: 'Bash', command: 'npm test\nmore' })).toBe('Bash npm test')
  expect(describeTool({ tool: 'Grep', pattern: 'childFlowId' })).toBe('Grep childFlowId')
  expect(describeTool({ tool: 'ArtifactData', action: 'batch' })).toBeUndefined()
  expect(describeTool({ tool: 'Bash', command: 'x'.repeat(200) })!.length).toBeLessThanOrEqual(80)
})

test('a step that starts two child flows lists both', () => {
  const f = flowFile({ subFlowState: { childFlows: [{ id: 'k1', spawnedAtStep: 'a' }, { id: 'k2', spawnedAtStep: 'a' }] } }, [step({ id: 'a', number: 1, name: 'Fan out', status: 'in_progress' })])
  expect((flowDoc(f, { topics: 0, files: 0 }) as any).steps[0].childFlowIds).toEqual(['k1', 'k2'])
})

test('the theme is one word in ui.json: a missing, broken or unknown file reads as auto', async () => {
  const path = '/h/.claude/zeremai/config/ui.json'
  expect(await readTheme(world({}).ports.files)).toBe('auto')
  expect(await readTheme(world({ [path]: '{not json' }).ports.files)).toBe('auto')
  expect(await readTheme(world({ [path]: { theme: 'purple' } }).ports.files)).toBe('auto')
  const w = world({})
  await writeTheme(w.ports.files, w.ports.write, 'dark')
  expect(await readTheme(w.ports.files)).toBe('dark')
  expect(await themeDoc(w.ports.files)).toEqual({ op: 'set', collection: 'meta', doc_id: 'ui', data: { theme: 'dark' } })
  await writeTheme(w.ports.files, w.ports.write, 'rm -rf') // a bad word is never stored
  expect(await readTheme(w.ports.files)).toBe('auto')
})

test('withAllowRules adds the two tools once, keeps the rest, and refuses text that is not a JSON object', () => {
  expect(JSON.parse(withAllowRules(undefined)).permissions.allow).toEqual(['Artifact', 'ArtifactData'])
  const out = JSON.parse(withAllowRules('{"model":"x","permissions":{"allow":["Bash(ls)","Artifact"],"deny":["Y"]}}'))
  expect(out).toEqual({ model: 'x', permissions: { allow: ['Bash(ls)', 'Artifact', 'ArtifactData'], deny: ['Y'] } })
  expect(() => withAllowRules('[1]')).toThrow()
  expect(() => withAllowRules('{oops')).toThrow()
})
