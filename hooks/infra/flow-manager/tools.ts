import type { ManagerPorts } from '../ports/ports'
import { REQUEST_APPROVAL_TOOL } from '../approval-gate/approval-gate'
import { TOOL_PREFIX } from '../mod-events/mod-events'
import { bindSession } from './bind-session'
import { createFlow } from './create-flow'
import { findingsTools } from './findings-tools'
import { addLogEntry, logInteraction, updateLogObservations } from './log'
import { addMemoryEntry, readMemoryTopic } from './memory'
import { slash } from './move'
import { FLOW_STATUSES, STEP_STATUSES, ToolError } from './flow-files'
import type { Doc, Result } from './flow-files'
import { registerChildFlow, updateChildStatus, updateFlowStatus } from './flow-status'
import { updateActiveSubstep, updateCurrentState, updateStepStatus } from './step-status'

// The flow tools. Each one is a command of the old Python script, with typed input
// and the same rules and the same answer: { status: 'ok', files_written } or { status: 'error', message }.

export type Tool = { name: string; description: string; inputSchema: Doc; run: (ports: ManagerPorts, args: any) => Promise<Result> }

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const list = (description: string) => ({ type: 'array', items: { type: 'string' }, description })
const object = (description: string) => ({ type: 'object', description })
const flowDir = str('Absolute path of the flow folder')
const tool = (name: string, description: string, properties: Doc, required: string[], run: Tool['run']): Tool =>
  ({ name, description, inputSchema: { type: 'object', properties, required }, run })

export const FLOW_TOOLS: Tool[] = [
  tool('create_flow', 'Create the files of a new flow from a template (flow.json, log.json, memory/_cross-references.json).', {
    flowDir, templatePath: str('Path to the template JSON'), name: str('Flow name; defaults to the template name'),
    params: object('Parameters of the flow'), projectPath: str('Absolute project path; defaults to the session folder'),
    parentFlowPath: str('Parent flow folder, for a sub-flow'), parentId: str('Parent flow id'),
    parentName: str('Parent flow name'), returnToStep: str('Step id in the parent to return to'),
  }, ['flowDir', 'templatePath'], createFlow),
  tool('update_step_status', 'Change the status of a step. A step that needs approval cannot be completed before the user approved it.', {
    flowDir, stepId: str('Step id'), status: { type: 'string', enum: STEP_STATUSES },
  }, ['flowDir', 'stepId', 'status'], updateStepStatus),
  tool('update_current_state', 'Set the active step of the flow, with a summary and optionally the active substep.', {
    flowDir, stepId: str('Step id'), stepName: str('Step name'), summary: str('What the step does now'), details: str('More detail'),
    totalSubsteps: num('Number of substeps'), substepNumber: num('Active substep number'), substepName: str('Active substep name'),
  }, ['flowDir', 'stepId', 'stepName', 'summary'], updateCurrentState),
  tool('update_active_substep', 'Change the active substep of the active step.', {
    flowDir, substepNumber: num('Substep number'), substepName: str('Substep name'), summary: str('New action summary'),
  }, ['flowDir', 'substepNumber', 'substepName'], updateActiveSubstep),
  tool('add_memory_entry', 'Add or update what a step produced in a memory topic file. A step can write only the topics its definition lists.', {
    flowDir, stepId: str('Step id'), topic: str('Topic name, for example context'), info: object('Information produced'),
    decisions: list('Decisions made'), files: list('Files modified or created'),
  }, ['flowDir', 'stepId', 'topic'], addMemoryEntry),
  tool('read_memory_topic', 'Read a memory topic file. A step can read only the topics its definition lists.', {
    flowDir, stepId: str('Step id, for the access check'), topic: str('Topic name, or _cross-references'),
  }, ['flowDir', 'stepId', 'topic'], readMemoryTopic),
  tool('add_log_entry', 'Add actions, reasoning, files, problems, decisions or notes to the log entry of a step.', {
    flowDir, stepId: str('Step id'), actions: list('Actions taken'), reasoning: list('Agent reasoning'),
    filesModified: list('Files modified'), problems: list('Problems met'), decisions: list('Decisions made'),
    performanceNotes: list('Performance notes'),
  }, ['flowDir', 'stepId'], addLogEntry),
  tool('log_interaction', "Log the user's request and the agent's answer in the log. Do this before anything else changes.", {
    flowDir, stepId: str('Step id'), request: str("The user's request"), reason: str('Why the user asked'),
    response: str("The agent's response"), forImprovement: { type: 'boolean', description: 'The request points to an improvement of the flow' },
    potentialImprovement: str('The improvement'),
  }, ['flowDir', 'stepId', 'request', 'reason', 'response'], logInteraction),
  tool('update_flow_status', 'Change the status of the flow. Completing a sub-flow needs a summary. A finished flow moves to its status folder.', {
    flowDir, status: { type: 'string', enum: FLOW_STATUSES }, summary: str('What was done; needed to complete a sub-flow'),
  }, ['flowDir', 'status'], updateFlowStatus),
  tool('register_child_flow', "Record a sub-flow in the parent's flow.json.", {
    flowDir: str('Parent flow folder'), childId: str('Child flow id'), childName: str('Child flow name'),
    childStatus: { type: 'string', enum: FLOW_STATUSES }, spawnedAtStep: str('Step in the parent that started the child'),
    syncPoint: str('Step in the parent that waits for the child'), childFlowPath: str('Child flow folder'),
  }, ['flowDir', 'childId', 'childName', 'childStatus', 'spawnedAtStep', 'syncPoint', 'childFlowPath'], registerChildFlow),
  tool('update_child_status', "Change the status of a child in the parent's flow.json.", {
    flowDir: str('Parent flow folder'), childId: str('Child flow id'), childStatus: { type: 'string', enum: FLOW_STATUSES },
  }, ['flowDir', 'childId', 'childStatus'], updateChildStatus),
  tool('update_log_observations', 'Add patterns, user feedback, metrics or recommendations to the log of the whole flow.', {
    flowDir, patterns: list('Patterns detected'), feedback: list('User feedback'), metrics: object('Efficiency metrics'),
    recommendations: list('Recommendations for the future'),
  }, ['flowDir'], updateLogObservations),
  ...findingsTools(flowDir, str, list),
  tool('bind_flow', 'Link this session to a flow, so the rules of the plugin apply to it. Do this first when you resume a flow.', { flowDir }, ['flowDir'], (ports, a) => bindSession(ports, a.flowDir)),
]

export { TOOL_PREFIX }
export const toolNames = () => FLOW_TOOLS.map(t => t.name)

// The input is checked against the schema: required fields, and the values of an enum.
function check(tool: Tool, args: Doc): void {
  const { properties, required } = tool.inputSchema
  const missing = (required as string[]).filter(k => args[k] === undefined || args[k] === null)
  if (missing.length) throw new ToolError(`Missing input for ${tool.name}: ${missing.join(', ')}`)
  for (const [key, spec] of Object.entries<any>(properties)) {
    if (args[key] !== undefined && spec.enum && !spec.enum.includes(args[key])) throw new ToolError(`Invalid ${key} "${args[key]}". Valid: ${spec.enum.join(', ')}`)
  }
}

// A path may come with backslashes on Windows. Every path in the tools uses `/`, which Windows takes as well.
const PATH_INPUTS = ['flowDir', 'templatePath', 'projectPath', 'parentFlowPath', 'childFlowPath']
const withSlashes = (args: Doc): Doc => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, PATH_INPUTS.includes(k) && typeof v === 'string' ? slash(v) : v]))

export async function runTool(ports: ManagerPorts, name: string, args: Doc): Promise<Result> {
  const tool = FLOW_TOOLS.find(t => t.name === name)
  if (!tool) return { status: 'error', message: `Unknown flow tool: ${name}` }
  try {
    const input = withSlashes(args ?? {})
    check(tool, input)
    return await tool.run(ports, input)
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

// The tools are listed only when the user starts or resumes a flow, so a session with no flow pays nothing for them.
export type RegisterTool = (spec: { name: string; description: string; inputSchema: Doc; isDeferred: boolean }) => Promise<unknown>
const listed = new Set<string>()
export async function ensureFlowTools(register: RegisterTool, sessionId: string): Promise<void> {
  if (listed.has(sessionId)) return
  for (const t of FLOW_TOOLS) await register({ name: t.name, description: t.description, inputSchema: t.inputSchema, isDeferred: true })
  await register(REQUEST_APPROVAL_TOOL)
  listed.add(sessionId)
}
