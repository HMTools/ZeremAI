import type { ManagerPorts } from '../ports/ports'
import { fail, ok, readJson, writeJson } from './flow-files'
import type { Doc, Result } from './flow-files'

// A step definition is copied into the flow, so the flow does not change when the template does.
const EMBED_FIELDS = ['output', 'guidance', 'substeps', 'flow', 'memoryFileUsage', 'parameters']
const EXTRA_EMBED_FIELDS = ['improvementCategories', 'prioritization', 'workflow', 'successCriteria','searchModes', 'changeProposalFormat', 'captureTypes']

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'))

// { id: path } for every `<folder>/<folder>.json` of the given `type` under `root`.
async function registry(ports: ManagerPorts, root: string, type: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {}
  let entries: { name: string; kind: string }[]
  try { entries = await ports.files.list(root) } catch { return found }
  for (const entry of entries.filter(e => e.kind === 'dir')) {
    const path = `${root}/${entry.name}/${entry.name}.json`
    if (!(await ports.files.exists(path))) continue
    try {
      const data = await readJson(ports, path)
      if (data.type === type && data.id) found[data.id] = path
    } catch { /* not a definition */ }
  }
  return found
}

const embed = (data: Doc): Doc => {
  const out: Doc = {}
  for (const field of [...EMBED_FIELDS, ...EXTRA_EMBED_FIELDS]) if (field in data) out[field] = data[field]
  return out
}

export type CreateFlowArgs = {
  flowDir: string; templatePath: string; name?: string; params?: Doc; projectPath?: string
  parentFlowPath?: string; parentId?: string; parentName?: string; returnToStep?: string
}

export async function createFlow(ports: ManagerPorts, a: CreateFlowArgs): Promise<Result> {
  if (await ports.files.exists(`${a.flowDir}/flow.json`)) fail(`Flow already exists at ${a.flowDir}`)
  if (!(await ports.files.exists(a.templatePath))) fail(`Template not found: ${a.templatePath}`)

  const template = await readJson(ports, a.templatePath)
  const templateName = template.name ?? a.templatePath.split('/').pop()!.replace(/\.json$/, '')
  const templateDir = dirOf(a.templatePath)
  const stepFiles = await registry(ports, templateDir, 'step')

  const steps: Doc[] = []
  for (const [i, def] of (template.steps ?? []).entries()) {
    const ref = def.stepRef
    let stepDefinition: Doc = {}
    if (ref) {
      if (stepFiles[ref]) stepDefinition = embed(await readJson(ports, stepFiles[ref]))
      else {
        // No fallback: the id must be found.
        stepDefinition = def.stepDefinition ?? {}
        if (!Object.keys(stepDefinition).length) fail(`Step definition UUID not found in template directory: ${ref}`)
      }
    } else {
      stepDefinition = def.stepDefinition ?? {} // no stepRef: an orchestrator step
    }

    const step: Doc = { id: ports.uuid(), number: i, name: def.name ?? `Step ${i}`, status: 'pending', stepRef: ref || '' }
    if (def.stepRefName != null) step.stepRefName = def.stepRefName
    if (def.approvalRequired != null) step.approvalRequired = def.approvalRequired
    step.stepDefinition = stepDefinition
    for (const key of ['subFlowTrigger', 'loopBackTo', 'loopCondition', 'maxIterations']) if (def[key] != null) step[key] = def[key]
    steps.push(step)
  }

  // The framework steps, such as continuous improvement, go at the end of every flow.
  const frameworkRoot = `${ports.pluginRoot}/framework-steps`
  for (const entry of (await ports.files.list(frameworkRoot)).filter(e => e.kind === 'dir').sort((x, y) => x.name.localeCompare(y.name))) {
    const path = `${frameworkRoot}/${entry.name}/${entry.name}.json`
    if (!(await ports.files.exists(path))) continue
    const data = await readJson(ports, path)
    if (data.type !== 'framework-step') continue
    const step: Doc = { id: ports.uuid(), number: steps.length, name: data.metadata?.title ?? entry.name, status: 'pending', stepRef: data.id ?? '', stepRefName: entry.name }
    if (data.approvalRequired != null) step.approvalRequired = data.approvalRequired
    step.stepDefinition = embed(data)
    steps.push(step)
  }

  let parentFlow: Doc | undefined
  if (a.parentFlowPath) {
    if (a.parentId && a.parentName) {
      parentFlow = { id: a.parentId, name: a.parentName, flowPath: a.parentFlowPath, returnToStep: a.returnToStep ?? '' }
    } else if (await ports.files.exists(`${a.parentFlowPath}/flow.json`)) {
      const parent = await readJson(ports, `${a.parentFlowPath}/flow.json`)
      parentFlow = { id: parent.id, name: parent.name, flowPath: a.parentFlowPath, returnToStep: a.returnToStep ?? '' }
    }
  }

  const now = ports.now()
  const metadata: Doc = { template: templateName, created: now, lastUpdated: now }
  if (template.id != null) metadata.templateId = template.id
  if (template.category != null) metadata.templateCategory = template.category
  metadata.projectPaths = [a.projectPath || (await ports.cwd())]
  metadata.flowPath = a.flowDir

  const first = steps[0]
  const flow: Doc = {
    type: 'flow-instance', id: ports.uuid(), name: a.name || templateName, metadata, status: 'running', parameters: a.params ?? {},
    currentState: {
      activeStep: {
        id: first?.id ?? '', name: first?.name ?? '', actionSummary: 'Initializing flow',
        totalSubsteps: first ? (first.stepDefinition.substeps?.length ?? 0) : 0, actionDetails: 'Flow created, ready to begin',
      },
    },
    steps,
  }
  if (parentFlow) flow.subFlowState = { parentFlow, childFlows: [] }

  const log: Doc = {
    type: 'log-file',
    metadata: { flow: flow.id, template: templateName, started: now, completed: null, parentFlowPath: a.parentFlowPath ?? null, subFlowPaths: [] },
    steps: {},
    flowWideObservations: { patternsDetected: [], userFeedbackSummary: [], efficiencyMetrics: {}, recommendationsForFuture: [] },
    executionMetrics: { totalSteps: steps.length, stepsCompleted: 0, currentStep: first?.id ?? '' },
  }

  await writeJson(ports, `${a.flowDir}/flow.json`, flow)
  await writeJson(ports, `${a.flowDir}/memory/_cross-references.json`, { type: 'memory-cross-references', keyDecisions: [], filesModified: [], filesCreated: [], custom: {} })
  await writeJson(ports, `${a.flowDir}/log.json`, log)
  return ok('flow.json', 'memory/_cross-references.json', 'log.json')
}
