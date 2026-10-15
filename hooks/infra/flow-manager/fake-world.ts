import type { ManagerPorts } from '../ports/ports'

// A fake disk for the tests of the flow tools: path → text. A folder is any path that starts a longer one.
// A move renames every path under the folder, as the real command does.
export const ACTIVE = '/h/.claude/zeremai/active'
export const DIR = `${ACTIVE}/p1`

export function world(initial: Record<string, unknown> = {}, { failMove = false } = {}) {
  const disk: Record<string, string> = {}
  for (const [path, value] of Object.entries(initial)) disk[path] = typeof value === 'string' ? value : JSON.stringify(value)
  const moved: string[][] = []
  const scripts: { sub: string; input: Record<string, any> }[] = [] // the script calls
  const links: Record<string, string[]> = {} // session id → the folders it bound
  let counter = 0
  const under = (folder: string) => Object.keys(disk).filter(p => p.startsWith(`${folder}/`))
  const ports: ManagerPorts = {
    files: {
      home: async () => '/h',
      list: async folder => {
        const names = under(folder).map(p => p.slice(folder.length + 1))
        if (!names.length) throw new Error(`no such folder: ${folder}`)
        return [...new Set(names.map(n => n.split('/')[0]))].map(name => ({ name, kind: names.some(n => n.startsWith(`${name}/`)) ? 'dir' : 'file' }))
      },
      exists: async path => path in disk || under(path).length > 0,
      read: async path => { if (!(path in disk)) throw new Error(`missing: ${path}`); return disk[path] },
    },
    write: async (path, text) => { disk[path] = text },
    move: async (from, to) => {
      moved.push([from, to])
      if (failMove) throw new Error('disk is read-only')
      for (const path of Object.keys(disk)) if (path.startsWith(`${from}/`)) { disk[to + path.slice(from.length)] = disk[path]; delete disk[path] }
    },
    now: () => `2026-01-01T00:00:${String(++counter).padStart(2, '0')}.000Z`,
    uuid: () => `id-${++counter}`,
    pluginRoot: '/plugin',
    cwd: async () => '/work',
    sessionId: async () => 'S1',
    links: { get: async id => links[id] ?? [], add: async (id, dir) => { links[id] = [...(links[id] ?? []).filter(d => d !== dir), dir] } },
    // A stand-in for scripts/flow_manager.py (the real one has its own Python tests): it records the call and fakes the two commands the pane runs.
    script: async (sub, input) => {
      scripts.push({ sub, input })
      if (sub === 'create-flow') {
        if (!(input.templatePath in disk)) return { status: 'error', message: `Template not found: ${input.templatePath}` }
        disk[`${input.flowDir}/flow.json`] = JSON.stringify(flowFile({ name: JSON.parse(disk[input.templatePath]).name, parameters: input.params ?? {} }))
        return { status: 'ok', files_written: ['flow.json'] }
      }
      if (sub === 'approve-step') { const flow = JSON.parse(disk[`${input.flowDir}/flow.json`]); flow.steps.find((s: any) => s.id === input.stepId).approved = true; disk[`${input.flowDir}/flow.json`] = JSON.stringify(flow); return { status: 'ok', files_written: ['flow.json'] } }
      if (sub === 'update-step-status') { const flow = JSON.parse(disk[`${input.flowDir}/flow.json`]); flow.steps.find((s: any) => s.id === input.stepId).status = input.status; disk[`${input.flowDir}/flow.json`] = JSON.stringify(flow); return { status: 'ok', files_written: ['flow.json'] } }
      return { status: 'error', message: `fake script: ${sub}` }
    },
  }
  const json = (path: string) => JSON.parse(disk[path])
  return { ports, disk, moved, links, json, scripts }
}

export const step = (extra: Record<string, unknown> = {}) => ({ id: 's1', number: 0, name: 'Design', status: 'pending', stepRef: 'r1', stepDefinition: {}, ...extra })
export const flowFile = (extra: Record<string, unknown> = {}, steps: unknown[] = [step()]) => ({
  type: 'flow-instance', id: 'pid', name: 'P', status: 'running',
  metadata: { template: 'T', created: 'then', lastUpdated: 'then', flowPath: DIR },
  parameters: {}, currentState: { activeStep: { id: 's1', name: 'Design', actionSummary: 'x', totalSteps: 1, totalSubsteps: 0 } },
  steps, ...extra,
})
export const logFile = () => ({
  type: 'log-file', metadata: { flow: 'pid' }, steps: {},
  flowWideObservations: { patternsDetected: [], userFeedbackSummary: [], efficiencyMetrics: {}, recommendationsForFuture: [] },
  executionMetrics: { totalSteps: 1, stepsCompleted: 0, currentStep: 's1' },
})
