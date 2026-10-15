import { FLOW_STATUSES, STEP_STATUSES } from './flow-files'
import { findingsTools } from './findings-tools'
import type { Doc } from './flow-files'

// The flow operations, as data: a name, what it does, and the schema of its input.
// The script scripts/flow_manager.py does the work (one subcommand for each, the name with dashes). The mod uses the schemas to check
// every call of the agent before the script runs (see script.ts), and the skills describe them.

export type Tool = { name: string; description: string; inputSchema: Doc }

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const list = (description: string) => ({ type: 'array', items: { type: 'string' }, description })
const object = (description: string) => ({ type: 'object', description })
const flowDir = str('Absolute path of the flow folder')
const tool = (name: string, description: string, properties: Doc, required: string[]): Tool =>
  ({ name, description, inputSchema: { type: 'object', properties, required } })

export const FLOW_TOOLS: Tool[] = [
  tool('create_flow', 'Create the files of a new flow from a template (flow.json, log.json, memory/_cross-references.json).', {
    flowDir, templatePath: str('Path to the template JSON'), name: str('Flow name; defaults to the template name'),
    params: object('Parameters of the flow'), projectPath: str('Absolute project path; defaults to the session folder'),
    parentFlowPath: str('Parent flow folder, for a sub-flow'), parentId: str('Parent flow id'),
    parentName: str('Parent flow name'), returnToStep: str('Step id in the parent to return to'),
  }, ['flowDir', 'templatePath']),
  tool('update_step_status', 'Change the status of a step. A step that needs approval cannot be completed before the user approved it. Status blocked (a retry cannot help, the user must act) needs a reason.', {
    flowDir, stepId: str('Step id'), status: { type: 'string', enum: STEP_STATUSES },
    reason: str('For blocked: one sentence on what the user must do'), command: str('For blocked: the command the user runs, if there is one'),
  }, ['flowDir', 'stepId', 'status']),
  tool('update_current_state', 'Set the active step of the flow, with a summary and optionally the active substep.', {
    flowDir, stepId: str('Step id'), stepName: str('Step name'), summary: str('What the step does now'), details: str('More detail'),
    totalSubsteps: num('Number of substeps'), substepNumber: num('Active substep number'), substepName: str('Active substep name'),
  }, ['flowDir', 'stepId', 'stepName', 'summary']),
  tool('update_active_substep', 'Change the active substep of the active step.', {
    flowDir, substepNumber: num('Substep number'), substepName: str('Substep name'), summary: str('New action summary'),
  }, ['flowDir', 'substepNumber', 'substepName']),
  tool('add_memory_entry', 'Add or update what a step produced in a memory topic file. A step can write only the topics its definition lists.', {
    flowDir, stepId: str('Step id'), topic: str('Topic name, for example context'), info: object('Information produced'),
    decisions: list('Decisions made'), files: list('Files modified or created'),
  }, ['flowDir', 'stepId', 'topic']),
  tool('read_memory_topic', 'Read a memory topic file. A step can read only the topics its definition lists.', {
    flowDir, stepId: str('Step id, for the access check'), topic: str('Topic name, or _cross-references'),
  }, ['flowDir', 'stepId', 'topic']),
  tool('get_step_brief', 'Give the prompt of a step subagent as one text: the step, the flow parameters, the memory it reads, and on a re-run its earlier summary and the corrections. It only reads.', {
    flowDir, stepId: str('Step id'), corrections: str('What the user asked to change, on a re-run'),
  }, ['flowDir', 'stepId']),
  tool('run_verifiers', 'Run the verifier scripts of a step, and give the result: pass or fail, with every check. It only reads. The plugin runs it when you end a step, so use it to check your work first.', {
    flowDir, stepId: str('Step id'),
  }, ['flowDir', 'stepId']),
  tool('add_log_entry', 'Add actions, reasoning, files, problems, decisions or notes to the log entry of a step.', {
    flowDir, stepId: str('Step id'), actions: list('Actions taken'), reasoning: list('Agent reasoning'),
    filesModified: list('Files modified'), problems: list('Problems met'), decisions: list('Decisions made'),
    performanceNotes: list('Performance notes'),
  }, ['flowDir', 'stepId']),
  tool('update_flow_status', 'Change the status of the flow. Completing a sub-flow needs a summary. A finished flow moves to its status folder.', {
    flowDir, status: { type: 'string', enum: FLOW_STATUSES }, summary: str('What was done; needed to complete a sub-flow'),
  }, ['flowDir', 'status']),
  tool('register_child_flow', "Record a sub-flow in the parent's flow.json.", {
    flowDir: str('Parent flow folder'), childId: str('Child flow id'), childName: str('Child flow name'),
    childStatus: { type: 'string', enum: FLOW_STATUSES }, spawnedAtStep: str('Step in the parent that started the child'),
    syncPoint: str('Step in the parent that waits for the child'), childFlowPath: str('Child flow folder'),
  }, ['flowDir', 'childId', 'childName', 'childStatus', 'spawnedAtStep', 'syncPoint', 'childFlowPath']),
  tool('update_child_status', "Change the status of a child in the parent's flow.json.", {
    flowDir: str('Parent flow folder'), childId: str('Child flow id'), childStatus: { type: 'string', enum: FLOW_STATUSES },
  }, ['flowDir', 'childId', 'childStatus']),
  tool('update_log_observations', 'Add patterns, user feedback, metrics or recommendations to the log of the whole flow.', {
    flowDir, patterns: list('Patterns detected'), feedback: list('User feedback'), metrics: object('Efficiency metrics'),
    recommendations: list('Recommendations for the future'),
  }, ['flowDir']),
  ...findingsTools(flowDir, str, list),
  tool('bind_flow', 'Link this session to a flow, so the rules of the plugin apply to it. Do this first when you resume a flow.', { flowDir }, ['flowDir']),
]
