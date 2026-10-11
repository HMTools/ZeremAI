import { test, expect } from 'claude-code/testing'
import { createFlow } from './create-flow'
import { world } from './fake-world'

const T = '/t/tpl'
const NEW = '/h/.claude/zeremai/active/new1'
const template = {
  name: 'Fix a bug', id: 'tid', category: 'dev',
  steps: [
    { name: 'Design', stepRef: 'ref1', stepRefName: 'design', approvalRequired: true },
    { name: 'Build', stepRef: 'ref2', loopBackTo: 'x', maxIterations: 3 },
    { name: 'Orchestrator', stepRef: '' },
  ],
}
const files = () => ({
  [`${T}/template.json`]: template,
  [`${T}/design/design.json`]: { type: 'step', id: 'ref1', output: { description: 'the design' }, substeps: [{}, {}], memoryFileUsage: { writeTo: ['context.json'] }, ignored: 'x' },
  [`${T}/build/build.json`]: { type: 'step', id: 'ref2', guidance: { g: 1 }, workflow: 'w' },
  '/plugin/framework-steps/improve/improve.json': { type: 'framework-step', id: 'fw1', metadata: { title: 'Improve' }, approvalRequired: false, output: { description: 'findings' } },
  '/plugin/framework-steps/notes/notes.json': { type: 'other' },
})
const create = (w: ReturnType<typeof world>, extra = {}) => createFlow(w.ports, { flowDir: NEW, templatePath: `${T}/template.json`, ...extra })

test('creates the three files', async () => {
  const w = world(files())
  expect(await create(w, { params: { id: '7' }, projectPath: '/proj' })).toEqual({ status: 'ok', files_written: ['flow.json', 'memory/_cross-references.json', 'log.json'] })
  const flow = w.json(`${NEW}/flow.json`)
  expect(flow).toMatchObject({ type: 'flow-instance', name: 'Fix a bug', status: 'running', parameters: { id: '7' } })
  expect(flow.metadata).toMatchObject({ template: 'Fix a bug', templateId: 'tid', templateCategory: 'dev', projectPaths: ['/proj'], flowPath: NEW })
  expect(w.json(`${NEW}/memory/_cross-references.json`).type).toBe('memory-cross-references')
  expect(w.json(`${NEW}/log.json`).executionMetrics).toEqual({ totalSteps: 4, stepsCompleted: 0, currentStep: flow.steps[0].id })
})
test('each template step gets its definition from the step file, and unknown fields stay out', async () => {
  const w = world(files())
  await create(w)
  const [design, build, orchestrator] = w.json(`${NEW}/flow.json`).steps
  expect(design).toMatchObject({ number: 0, name: 'Design', status: 'pending', stepRef: 'ref1', stepRefName: 'design', approvalRequired: true })
  expect(design.stepDefinition).toEqual({ output: { description: 'the design' }, substeps: [{}, {}], memoryFileUsage: { writeTo: ['context.json'] } })
  expect(build).toMatchObject({ loopBackTo: 'x', maxIterations: 3 })
  expect(build.stepDefinition).toEqual({ guidance: { g: 1 }, workflow: 'w' })
  expect(orchestrator.stepDefinition).toEqual({})
})
test('framework steps go at the end, and only the ones of the right type', async () => {
  const w = world(files())
  await create(w)
  const steps = w.json(`${NEW}/flow.json`).steps
  expect(steps.length).toBe(4)
  expect(steps[3]).toMatchObject({ number: 3, name: 'Improve', stepRef: 'fw1', stepRefName: 'improve', approvalRequired: false })
})
test('the active step is the first step, and the project path defaults to the session folder', async () => {
  const w = world(files())
  await create(w)
  const flow = w.json(`${NEW}/flow.json`)
  expect(flow.currentState.activeStep).toMatchObject({ id: flow.steps[0].id, name: 'Design', totalSubsteps: 2, actionSummary: 'Initializing flow' })
  expect(flow.metadata.projectPaths).toEqual(['/work'])
})
test('a name given wins over the template name', async () => {
  const w = world(files())
  await create(w, { name: 'My run' })
  expect(w.json(`${NEW}/flow.json`).name).toBe('My run')
})
test('a sub-flow: the parent is read from its file when no id and name are given', async () => {
  const w = world({ ...files(), '/parent/flow.json': { id: 'pid', name: 'Parent' } })
  await create(w, { parentFlowPath: '/parent', returnToStep: 'ps2' })
  expect(w.json(`${NEW}/flow.json`).subFlowState).toEqual({ parentFlow: { id: 'pid', name: 'Parent', flowPath: '/parent', returnToStep: 'ps2' }, childFlows: [] })
  expect(w.json(`${NEW}/log.json`).metadata.parentFlowPath).toBe('/parent')
})
test('errors: flow exists, template missing, step id not found', async () => {
  const w = world({ ...files(), [`${NEW}/flow.json`]: '{}' })
  await expect(create(w)).rejects.toThrow('Flow already exists')
  await expect(createFlow(world(files()).ports, { flowDir: NEW, templatePath: '/nope.json' })).rejects.toThrow('Template not found')
  const noStep = files(); delete (noStep as any)[`${T}/build/build.json`]
  await expect(create(world(noStep))).rejects.toThrow('Step definition UUID not found in template directory: ref2')
})
