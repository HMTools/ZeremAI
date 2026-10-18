import { test, expect } from 'claude-code/testing'
import { ACTIVE, flowFile, step, world } from '../flow-manager/fake-world'
import { boundView, deleteFlow, purgeFlow, fingerprint, stepDetail, dirNameFor, handoff, inFolder, listFlows, listTemplates, resumeFlow, startFlow, waitingCount, wrongOptions } from './flow-pane'

const T = '/h/.claude/zeremai/templates/flows/dev/bug'
const template = {
  type: 'template',
  name: 'bug',
  id: 'tid',
  category: 'dev',
  parameters: { required: ['workItemId'], optional: ['repo'], definitions: { workItemId: { description: 'the item', example: '1345467' } } },
  steps: [{ name: 'Design', stepRef: 'r1' }],
}
const disk = () => ({
  [`${T}/bug.json`]: template,
  [`${T}/design/design.json`]: { type: 'step', id: 'r1' },
  '/h/.claude/zeremai/templates/flows/dev/notes/notes.json': { type: 'other' },
  '/plugin/framework-steps/x/x.json': { type: 'other' },
})

test('templates come with their fields, required first, and a file that is no template is left out', async () => {
  const [t, ...rest] = await listTemplates(world(disk()).ports.files)
  expect(rest).toEqual([])
  expect(t).toMatchObject({ category: 'dev', name: 'bug', path: `${T}/bug.json` })
  expect(t.fields).toEqual([
    { name: 'workItemId', required: true, example: '1345467', description: 'the item' },
    { name: 'repo', required: false, example: '', description: '' },
  ])
})
test('no templates folder gives an empty list', async () => {
  expect(await listTemplates(world().ports.files)).toEqual([])
})

test('flows list the next step and the newest change first', async () => {
  const done = step({ id: 'a', number: 0, status: 'completed' })
  const todo = step({ id: 'b', number: 1, status: 'pending' })
  const w = world({
    [`${ACTIVE}/old/flow.json`]: flowFile({ name: 'Old', metadata: { lastUpdated: '2026-01-01T10:00:00Z' } }, [done, todo]),
    [`${ACTIVE}/new/flow.json`]: flowFile({ name: 'New', metadata: { lastUpdated: '2026-02-01T10:00:00Z' } }, [todo]),
  })
  const found = await listFlows(w.ports.files)
  expect(found.map(p => p.name)).toEqual(['New', 'Old'])
  expect(found[0]).toMatchObject({ dir: `${ACTIVE}/new`, step: 1, total: 1, updated: '2026-02-01 10:00', kind: 'running', folders: [], updatedMs: Date.parse('2026-02-01T10:00:00Z') })
  expect(found[1]).toMatchObject({ dir: `${ACTIVE}/old`, step: 2, total: 2, updated: '2026-01-01 10:00', kind: 'running', folders: [] })
})

test('a flow is waiting, failed, paused or done by its steps and its status', async () => {
  const waits = step({ id: 'a', number: 0, status: 'awaiting_approval' })
  const done = step({ id: 'b', number: 1, status: 'completed' })
  const w = world({
    [`${ACTIVE}/w/flow.json`]: flowFile({ name: 'W', metadata: { lastUpdated: '4' } }, [waits]),
    [`${ACTIVE}/f/flow.json`]: flowFile({ name: 'F', status: 'failed', metadata: { lastUpdated: '3' } }, [done]),
    [`${ACTIVE}/p/flow.json`]: flowFile({ name: 'P', status: 'paused', metadata: { lastUpdated: '2' } }, [done]),
    [`${ACTIVE}/d/flow.json`]: flowFile({ name: 'D', metadata: { lastUpdated: '1' } }, [done]),
  })
  const list = await listFlows(w.ports.files)
  expect(list.map(p => p.kind)).toEqual(['waiting', 'failed', 'paused', 'done'])
  expect(waitingCount(list)).toBe(3)
})

test('the Continue list shows this folder, or all folders; a flow with no folder shows only in All', async () => {
  const todo = step({ id: 'a', number: 0 })
  const w = world({
    [`${ACTIVE}/here/flow.json`]: flowFile({ name: 'Here', metadata: { lastUpdated: '3', projectPaths: ['/work/'] } }, [todo]),
    [`${ACTIVE}/there/flow.json`]: flowFile({ name: 'There', metadata: { lastUpdated: '2', projectPaths: ['/other'] } }, [todo]),
    [`${ACTIVE}/none/flow.json`]: flowFile({ name: 'None', metadata: { lastUpdated: '1' } }, [todo]),
  })
  const list = await listFlows(w.ports.files)
  expect(inFolder(list, '/work', false).map(p => p.name)).toEqual(['Here'])
  expect(inFolder(list, '/work', true).map(p => p.name)).toEqual(['Here', 'There', 'None'])
})

test('the bound view lists every step with its look', async () => {
  const w = world({
    [`${ACTIVE}/p1/flow.json`]: flowFile({ name: 'Invoice' }, [
      step({ id: 'a', number: 1, name: 'Read', status: 'completed' }),
      step({ id: 'b', number: 2, name: 'Approve', status: 'awaiting_approval' }),
      step({ id: 'c', number: 3, name: 'Send', status: 'pending' }),
    ]),
  })
  const view = await boundView(w.ports.files, `${ACTIVE}/p1`)
  expect(view).toMatchObject({ name: 'Invoice', step: 2, total: 3, kind: 'waiting' })
  expect(view!.steps.map(s => [s.number, s.name, s.kind])).toEqual([
    ['1', 'Read', 'done'],
    ['2', 'Approve', 'waiting'],
    ['3', 'Send', 'pending'],
  ])
  expect(await boundView(w.ports.files, `${ACTIVE}/gone`)).toBeUndefined()
})

test('the active step lists its substeps, a sub-flow hangs under its step, and the parent shows', async () => {
  const subs = [
    { number: 1, name: 'Show amount' },
    { number: 2, name: 'Ask approver' },
  ]
  const w = world({
    [`${ACTIVE}/p1/flow.json`]: flowFile(
      {
        name: 'Invoice',
        currentState: { activeStep: { id: 'b', name: 'Approve', actionSummary: 'x', totalSteps: 2, totalSubsteps: 2, currentSubstep: { number: 2, name: 'Ask approver' } } },
        subFlowState: {
          parentFlow: { id: 'up', name: 'Month end', flowPath: `${ACTIVE}/up`, returnToStep: 'x' },
          childFlows: [{ id: 'k', name: 'Lookup', status: 'completed', spawnedAtStep: 'a', syncPoint: 'after-a', flowPath: `${ACTIVE}/k` }],
        },
      },
      [step({ id: 'a', number: 1, name: 'Read', status: 'completed' }), step({ id: 'b', number: 2, name: 'Approve', status: 'in_progress', stepDefinition: { substeps: subs } })],
    ),
  })
  const view = (await boundView(w.ports.files, `${ACTIVE}/p1`))!
  expect(view.parent).toEqual({ name: 'Month end', dir: `${ACTIVE}/up` })
  expect(view.steps[0].substeps).toEqual([]) // only the active step lists them
  expect(view.steps[0].children).toEqual([{ name: 'Lookup', kind: 'done', dir: `${ACTIVE}/k`, returnsTo: 'after-a' }])
  expect(view.steps[1].substeps).toEqual([
    { number: 1, name: 'Show amount', active: false },
    { number: 2, name: 'Ask approver', active: true },
  ])
})

test('the step detail joins the definition, the memory entries and the log; empty parts stay empty', async () => {
  const w = world({
    [`${ACTIVE}/p1/flow.json`]: flowFile({}, [
      step({
        id: 'b',
        number: 2,
        name: 'Approve',
        status: 'completed',
        stepDefinition: { output: { description: 'a decision' }, memoryFileUsage: { readFrom: ['invoice.json'], writeTo: ['approvals'] } },
      }),
    ]),
    [`${ACTIVE}/p1/log.json`]: { steps: { b: { actionsTaken: ['read invoice'], decisionsMade: ['under limit'], problemsEncountered: [] } } },
    [`${ACTIVE}/p1/memory/approvals.json`]: { entries: { b: { informationProduced: { verdict: 'yes' }, decisionsMade: ['under limit', 'no review'], filesModifiedCreated: ['a.md'] } } },
  })
  const d = (await stepDetail(w.ports.files, `${ACTIVE}/p1`, 'b'))!
  expect(d).toMatchObject({
    number: '2',
    kind: 'done',
    produces: ['a decision'],
    reads: ['invoice'],
    writes: ['approvals'],
    actions: ['read invoice'],
    files: ['a.md'],
    problems: [],
    produced: [['verdict', 'yes']],
  })
  expect(d.decisions).toEqual(['under limit', 'no review']) // the same decision in the log and in memory shows once
  expect(await stepDetail(w.ports.files, `${ACTIVE}/p1`, 'zz')).toBeUndefined()
})

test('delete moves a running flow to deleted/, keeps both when the name is taken, and refuses any other folder', async () => {
  const w = world({ [`${ACTIVE}/p1/flow.json`]: flowFile(), '/h/.claude/zeremai/deleted/p1/flow.json': '{}' })
  const target = await deleteFlow(w.ports, `${ACTIVE}/p1/`)
  expect(target).toMatch(/\/deleted\/p1-\d+$/) // the name was taken: the new folder gets a suffix
  expect(w.moved).toEqual([[`${ACTIVE}/p1`, target]])
  await expect(deleteFlow(w.ports, '/h/.claude/zeremai/completed/p1')).rejects.toThrow('not a running flow folder')
  await expect(deleteFlow(w.ports, `${ACTIVE}/p1/memory`)).rejects.toThrow('not a running flow folder')
  await expect(deleteFlow(w.ports, `${ACTIVE}/../x`)).rejects.toThrow('not a running flow folder')
})

test('purge removes a running flow folder of any session, and refuses any other folder', async () => {
  const w = world({ [`${ACTIVE}/p1/flow.json`]: flowFile(), [`${ACTIVE}/p1/log.json`]: '{}' })
  await purgeFlow(w.ports, `${ACTIVE}/p1/`)
  expect(w.removed).toEqual([`${ACTIVE}/p1`])
  expect(Object.keys(w.disk)).toEqual([])
  await expect(purgeFlow(w.ports, '/h/.claude/zeremai/completed/p1')).rejects.toThrow('not a running flow folder')
  await expect(purgeFlow(w.ports, `${ACTIVE}/p1/memory`)).rejects.toThrow('not a running flow folder')
  await expect(purgeFlow(w.ports, `${ACTIVE}/../x`)).rejects.toThrow('not a running flow folder')
  expect(w.removed).toHaveLength(1)
})

test('the fingerprint changes with a step, a state or a time, and not with the order of reads', async () => {
  const w = world({ [`${ACTIVE}/p1/flow.json`]: flowFile({ name: 'A' }, [step({ status: 'pending' })]) })
  const before = fingerprint(await listFlows(w.ports.files))
  expect(fingerprint(await listFlows(w.ports.files))).toBe(before)
  w.disk[`${ACTIVE}/p1/flow.json`] = JSON.stringify(flowFile({ name: 'A' }, [step({ status: 'awaiting_approval' })]))
  expect(fingerprint(await listFlows(w.ports.files))).not.toBe(before)
})

test('the message names the next step and carries the step ids', () => {
  const text = handoff('resume', '/d', flowFile({ parameters: { a: '1' } }, [step({ id: 'a', number: 0, status: 'completed' }), step({ id: 'b', number: 1, name: 'Build' })]))
  expect(text).toContain('I resumed the flow "P"')
  expect(text).toContain('✓ 0. Design (completed) id=a')
  expect(text).toContain('→ 1. Build (pending) id=b')
  expect(text).toContain('Next: step 1 "Build".')
  expect(text).toContain('flow-run skill')
})

test('a folder name has the slug, the date and the time', () => {
  expect(dirNameFor('Fix a Bug!', '2026-03-04T05:06:07.000Z')).toBe('fix-a-bug-20260304-050607')
})

test('start refuses while a required field is empty, and writes nothing', async () => {
  const w = world(disk())
  const [t] = await listTemplates(w.ports.files)
  expect(await startFlow(w.ports, t, { workItemId: '  ' })).toEqual({ error: 'Fill in: workItemId' })
  expect(w.links.S1).toBeUndefined()
})
test('start creates the flow, binds the session and returns the message', async () => {
  const w = world(disk())
  const [t] = await listTemplates(w.ports.files)
  const started = await startFlow(w.ports, t, { workItemId: ' 7 ', repo: '' })
  expect(started).toMatchObject({ text: expect.stringContaining('I started the flow "bug"') })
  const [dir] = w.links.S1
  expect(dir).toMatch(/\/active\/bug-\d{8}-\d{6}$/)
  expect(w.json(`${dir}/flow.json`).parameters).toEqual({ workItemId: '7' })
  expect(w.scripts).toEqual([{ sub: 'create-flow', input: { flowDir: dir, templatePath: t.path, params: { workItemId: '7' }, projectPath: '/work' } }]) // the script writes the files, the mod binds
})
test('start answers with the error of the script and binds nothing', async () => {
  const w = world(disk())
  const [t] = await listTemplates(w.ports.files)
  expect(await startFlow(w.ports, { ...t, path: '/nope.json' }, { workItemId: '7' })).toEqual({ error: 'Template not found: /nope.json' })
  expect(w.links.S1).toBeUndefined()
})

test('resume binds the session and returns the message', async () => {
  const w = world({ [`${ACTIVE}/p1/flow.json`]: flowFile() })
  expect(await resumeFlow(w.ports, `${ACTIVE}/p1`)).toMatchObject({ text: expect.stringContaining('Next: step 0 "Design"') })
  expect(w.links.S1).toEqual([`${ACTIVE}/p1`])
})
test('resume of a folder outside active/ answers with an error', async () => {
  const w = world({ '/h/x/flow.json': {} })
  expect(await resumeFlow(w.ports, '/h/x')).toEqual({ error: 'Not a folder in active/: /h/x' })
})

test('a waiting step puts its number on the flow; a running one gets the time of its log if the surface tells', async () => {
  const w = world({
    [`${ACTIVE}/w/flow.json`]: flowFile({ name: 'W' }, [step({ id: 'a', number: 0, status: 'completed' }), step({ id: 'b', number: 1, status: 'awaiting_approval' })]),
    [`${ACTIVE}/r/flow.json`]: flowFile({ name: 'R' }, [step({ id: 'a', number: 0, status: 'in_progress' })]),
  })
  const files = { ...w.ports.files, list: async (path: string) => (await w.ports.files.list(path)).map(e => (e.name === 'log.json' ? { ...e, mtimeMs: 42_000 } : e)) }
  const found = await listFlows(files)
  expect(found.find(i => i.name === 'W')).toMatchObject({ kind: 'waiting', waitStep: '1' })
  expect(found.find(i => i.name === 'W')?.lastLogMs).toBeUndefined()
})
test('a failed flow has a reason from the log of its failed step; a paused one names the step it stopped at', async () => {
  const w = world({
    [`${ACTIVE}/f/flow.json`]: flowFile({ name: 'F', status: 'failed' }, [
      step({ id: 'a', number: 0, name: 'Design', status: 'completed' }),
      step({ id: 'b', number: 1, name: 'Build', status: 'failed' }),
    ]),
    [`${ACTIVE}/f/log.json`]: { steps: { b: { problemsEncountered: ['first', 'tests did not pass'] } } },
    [`${ACTIVE}/p/flow.json`]: flowFile({ name: 'P', status: 'paused' }, [step({ id: 'a', number: 0, name: 'Design', status: 'pending' })]),
  })
  expect((await boundView(w.ports.files, `${ACTIVE}/f`))?.attention).toEqual({ number: '1', name: 'Build', reason: 'tests did not pass' })
  expect((await boundView(w.ports.files, `${ACTIVE}/p`))?.attention).toEqual({ number: '0', name: 'Design', reason: '' })
})
test('a running flow has no attention card', async () => {
  const w = world({ [`${ACTIVE}/r/flow.json`]: flowFile({ name: 'R' }, [step({ id: 'a', number: 0, status: 'in_progress' })]) })
  expect((await boundView(w.ports.files, `${ACTIVE}/r`))?.attention).toBeUndefined()
})
test('resume adds one extra line for the agent', async () => {
  const w = world({ [`${ACTIVE}/r/flow.json`]: flowFile({ name: 'R' }, [step({ id: 'a', number: 0, status: 'failed' })]) })
  const started = await resumeFlow(w.ports, `${ACTIVE}/r`, 'The user pressed Retry on step 0.')
  expect('text' in started && started.text).toContain('The user pressed Retry on step 0.')
})

test('resume runs a blocked step again before it hands the flow over', async () => {
  const w = world({ [`${ACTIVE}/b/flow.json`]: flowFile({ name: 'B' }, [step({ id: 'a', number: 0, status: 'blocked', blocked: { reason: 'The az login expired.', since: 'then' } })]) })
  const started = await resumeFlow(w.ports, `${ACTIVE}/b`)
  expect(w.scripts.at(-1)).toEqual({ sub: 'update-step-status', input: { flowDir: `${ACTIVE}/b`, stepId: 'a', status: 'in_progress' } })
  expect('text' in started && started.text).toContain('(in_progress)')
})
test('a flow with a blocked step is blocked, and needs the user', async () => {
  const w = world({ [`${ACTIVE}/b/flow.json`]: flowFile({ name: 'B' }, [step({ id: 'a', number: 0, status: 'blocked', blocked: { reason: 'No access.', since: 'then' } })]) })
  const [info] = await listFlows(w.ports.files)
  expect(info.kind).toBe('blocked')
  expect(waitingCount([info])).toBe(1)
  expect((await boundView(w.ports.files, `${ACTIVE}/b`))?.attention?.reason).toBe('No access.')
})

test('a value outside a fixed list is wrong, unless the field allows another', () => {
  const t = {
    fields: [
      { name: 'env', required: true, example: '', description: '', options: ['staging', 'production'] },
      { name: 'region', required: false, example: '', description: '', options: ['eu'], allowOther: true },
    ],
  } as any
  expect(wrongOptions(t, { env: 'prod', region: 'us' })).toEqual(['env must be one of: staging, production'])
  expect(wrongOptions(t, { env: 'staging' })).toEqual([])
})

test('resume of a step in progress tells the agent that no helper runs it', async () => {
  const w = world({ [`${ACTIVE}/i/flow.json`]: flowFile({ name: 'I' }, [step({ id: 'a', number: 0, status: 'in_progress' })]) })
  const started = await resumeFlow(w.ports, `${ACTIVE}/i`)
  const text = 'text' in started ? started.text : ''
  expect(text).toContain('no helper runs it')
  expect(text).not.toContain('request_approval')
  expect(w.scripts).toEqual([]) // a running flow changes no step by itself
})
test('resume of a step that waits for approval says to check the output, then ask again', () => {
  const text = handoff('resume', '/d', flowFile({}, [step({ id: 'a', number: 0, status: 'in_progress', approvalRequired: true })]))
  expect(text).toContain('call request_approval')
  expect(handoff('new', '/d', flowFile({}, [step({ id: 'a', number: 0, status: 'in_progress' })]))).not.toContain('no helper runs it')
})
test('resume of a child binds its running parents first, so the child answers first', async () => {
  const p = `${ACTIVE}/parent`
  const g = `${ACTIVE}/grand`
  const w = world({
    [`${g}/flow.json`]: flowFile({ name: 'G' }),
    [`${p}/flow.json`]: flowFile({ name: 'P', subFlowState: { parentFlow: { flowPath: g } } }),
    [`${ACTIVE}/kid/flow.json`]: flowFile({ name: 'K', subFlowState: { parentFlow: { flowPath: p } } }),
  })
  await resumeFlow(w.ports, `${ACTIVE}/kid`)
  expect(w.links.S1).toEqual([g, p, `${ACTIVE}/kid`])
})
test('a parent that left active/ is skipped', async () => {
  const w = world({ [`${ACTIVE}/kid/flow.json`]: flowFile({ name: 'K', subFlowState: { parentFlow: { flowPath: '/h/.claude/zeremai/completed/gone' } } }) })
  await resumeFlow(w.ports, `${ACTIVE}/kid`)
  expect(w.links.S1).toEqual([`${ACTIVE}/kid`])
})
