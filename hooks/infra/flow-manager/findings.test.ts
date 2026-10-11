import { test, expect } from 'claude-code/testing'
import { listFindings, updateFindingStatus, writeFinding } from './findings'
import { DIR, flowFile, world } from './fake-world'

const STORE = '/h/.claude/zeremai/improvement-findings'
const flow = flowFile({}, [])
const finding = { category: 'c', title: 't', what: 'w', why: 'y', impact: 'i' }
const setup = (meta: Record<string, unknown> = { templateId: 'tid' }) =>
  world({ [`${DIR}/flow.json`]: { ...flow, metadata: { ...flow.metadata, ...meta } } })

test('a finding is saved under the template id, with status open', async () => {
  const w = setup()
  const result = await writeFinding(w.ports, { flowDir: DIR, ...finding, scope: ['a.ts'] })
  expect(result.files_written).toEqual([`${STORE}/tid/pid.json`])
  const file = w.json(`${STORE}/tid/pid.json`)
  expect(file).toMatchObject({ type: 'improvement-findings-file', templateId: 'tid', flowId: 'pid', flowName: 'P' })
  expect(file.findings[0]).toMatchObject({ ...finding, scope: ['a.ts'], status: 'open', flowId: 'pid' })
})
test('without a template id the folder is the template name; a second finding is added to the file', async () => {
  const w = setup({ templateId: undefined })
  await writeFinding(w.ports, { flowDir: DIR, ...finding })
  await writeFinding(w.ports, { flowDir: DIR, ...finding, title: 't2' })
  expect(w.json(`${STORE}/T/pid.json`).findings.map((f: any) => f.title)).toEqual(['t', 't2'])
})

const store = () => world({
  [`${STORE}/t1/p1.json`]: { findings: [{ id: 'f1', status: 'open' }, { id: 'f2', status: 'applied' }] },
  [`${STORE}/t2/p2.json`]: { findings: [{ id: 'f3', status: 'open' }] },
})
test('list: every finding, one status, one template', async () => {
  const w = store()
  expect((await listFindings(w.ports, {})).findings.map((f: any) => f.id)).toEqual(['f1', 'f2', 'f3'])
  expect((await listFindings(w.ports, { status: 'open' })).findings.map((f: any) => f.id)).toEqual(['f1', 'f3'])
  expect((await listFindings(w.ports, { templateId: 't2' })).findings.map((f: any) => f.id)).toEqual(['f3'])
})
test('list: no store is an empty list', async () => {
  expect(await listFindings(world().ports, {})).toEqual({ status: 'ok', findings: [] })
})
test('update: the status and the resolution are recorded', async () => {
  const w = store()
  await updateFindingStatus(w.ports, { flowId: 'p1', findingId: 'f1', status: 'applied', notes: 'done', filesModified: ['x'] })
  const f1 = w.json(`${STORE}/t1/p1.json`).findings[0]
  expect(f1).toMatchObject({ status: 'applied', resolution: { notes: 'done', filesModified: ['x'] } })
})
test('update: no file for the flow, or no such finding, is an error', async () => {
  const w = store()
  await expect(updateFindingStatus(w.ports, { flowId: 'none', findingId: 'f1', status: 'applied' })).rejects.toThrow('No findings file for flow none')
  await expect(updateFindingStatus(w.ports, { flowId: 'p1', findingId: 'zzz', status: 'applied' })).rejects.toThrow('Finding zzz not found')
})
