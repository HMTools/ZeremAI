import { FLOW_TOOLS } from './tools'
import { slash } from './move'
import type { Doc, Result } from './flow-files'

// The Python script `scripts/flow_manager.py` is the only writer of flow files. This file is the mod's side of it:
//  - `runScript` runs it for the mod itself (the pane: Create, Approve);
//  - `checkCall` decides if a Bash command of the agent may run it, at this moment and with these arguments.
// The command form is fixed:  python3 <plugin>/scripts/flow_manager.py <subcommand> --json '<one JSON object>'

export const SCRIPT_NAME = 'flow_manager.py'
export const scriptPath = (pluginRoot: string) => `${slash(pluginRoot)}/scripts/${SCRIPT_NAME}`

const dashed = (name: string) => name.replace(/_/g, '-')
// The subcommands the agent may run: every flow tool that writes or reads files. bind_flow is the mod's own (the session link is not a file).
// approve-step is the mod's alone: only the user approves, so the agent never gets it.
export const AGENT_SUBCOMMANDS = FLOW_TOOLS.filter(t => t.name !== 'bind_flow').map(t => dashed(t.name))
export const SCRIPT_SUBCOMMANDS = [...AGENT_SUBCOMMANDS, 'approve-step']
// The agent asks the user to approve a step. The mod shows the dialog itself: the script never runs for this one.
export const REQUEST_APPROVAL = 'request-approval'
const schemaOf = (sub: string) => !AGENT_SUBCOMMANDS.includes(sub) ? undefined : FLOW_TOOLS.find(t => dashed(t.name) === sub)?.inputSchema as { properties: Doc; required: string[] } | undefined

// The commands that change the flow and wait for the approval dialog.
export const DIALOG_GATED = ['update-step-status', 'update-current-state', 'update-active-substep', 'update-flow-status']
export const LINE_COMMANDS = ['create-flow', 'update-step-status', 'update-current-state', 'update-active-substep', 'update-flow-status']

export type Runner = (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>

// Run the script as the mod. Any answer is a Result: a script that cannot start or prints no JSON is an error result.
export async function runScript(run: Runner, python: string, pluginRoot: string, sub: string, input: Doc): Promise<Result> {
  try {
    const out = await run([python, scriptPath(pluginRoot), sub, '--json', JSON.stringify(input)])
    const line = out.stdout.trim().split('\n').filter(Boolean).pop() ?? ''
    try { return JSON.parse(line) as Result } catch { return { status: 'error', message: `flow_manager.py gave no JSON (exit ${out.exitCode}): ${(out.stderr || out.stdout).trim().slice(0, 300)}` } }
  } catch (error) { return { status: 'error', message: `flow_manager.py did not start: ${error instanceof Error ? error.message : String(error)}` } }
}

// ── The command of the agent ─────────────────────────────────────────────

// A command that runs the script in some way. A guess, like the hand-edit check: it must not catch `cat scripts/flow_manager.py`.
const RUNS_SCRIPT = /(?:^|[\s;&|(`'"])(?:python3?|py)(?:\.exe)?\s+[^;&|\n]*flow_manager\.py|^\s*(?:\.\/|\S*\/)?scripts\/flow_manager\.py\b/
export const runsScript = (command: string | undefined) => RUNS_SCRIPT.test(command ?? '')

// python3 <path> <subcommand> --json '<object>'. The object is in single quotes; an apostrophe inside is written '\''.
export function parseCommand(command: string, pluginRoot: string): { sub: string; input: unknown } | { error: string } {
  const m = /^\s*(?:python3?|py)(?:\.exe)?\s+("?)([^\s"']+)\1\s+([a-z-]+)\s+--json\s+'((?:[^']|'\\'')*)'\s*$/.exec(command)
  if (!m) return { error: `One form only: python3 ${scriptPath(pluginRoot)} <subcommand> --json '<one JSON object>' (single quotes, no pipe, no ; and nothing after the closing quote).` }
  if (slash(m[2]) !== scriptPath(pluginRoot)) return { error: `Run this plugin's script only: ${scriptPath(pluginRoot)}` }
  try { return { sub: m[3], input: JSON.parse(m[4].replace(/'\\''/g, "'")) } } catch { return { error: 'The text after --json must be one JSON object.' } }
}

const typeOk = (spec: Doc, value: unknown) =>
  spec.type === 'string' ? typeof value === 'string'
    : spec.type === 'number' ? typeof value === 'number'
      : spec.type === 'boolean' ? typeof value === 'boolean'
        : spec.type === 'array' ? Array.isArray(value) && value.every(v => typeof v === (spec.items?.type ?? 'string'))
          : spec.type === 'object' ? typeof value === 'object' && value !== null && !Array.isArray(value)
            : true

// Every input checked against the schema of the tool: required, no unknown key, the type, the values of an enum.
export function checkInput(sub: string, input: unknown): string | undefined {
  const schema = schemaOf(sub)
  if (!schema) return `Unknown subcommand: ${sub}. Subcommands: ${AGENT_SUBCOMMANDS.join(', ')}`
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'The input must be one JSON object.'
  const args = input as Doc
  const missing = schema.required.filter(k => args[k] === undefined || args[k] === null)
  if (missing.length) return `Missing input for ${sub}: ${missing.join(', ')}`
  for (const key of Object.keys(args)) {
    const spec = schema.properties[key]
    if (!spec) return `Unknown input "${key}" for ${sub}. Inputs: ${Object.keys(schema.properties).join(', ')}`
    if (!typeOk(spec, args[key])) return `Input "${key}" must be of type ${spec.type}.`
    if (spec.enum && !spec.enum.includes(args[key])) return `Invalid ${key} "${args[key]}". Valid: ${spec.enum.join(', ')}`
  }
}

// What the gate knows about the session at this moment.
export type Moment = {
  pluginRoot: string
  home: string // the user's home folder, for the state root
  bound: string[] // the flow folders of this session, the parent first
  dialogOpen: boolean // the approval dialog is on screen
  steps: { id: string; status?: string; approvalRequired?: boolean; approved?: boolean }[] // the steps of the newest bound flow
}

export type Verdict =
  | { allow: true; sub: string; input: Doc }
  | { approval: true } // the mod answers it with the approval dialog; the script does not run
  | { deny: string }

const root = (home: string) => `${slash(home)}/.claude/zeremai`

// The flow folders the agent may name: the ones bound to the session. A new flow goes in active/ and is not bound yet.
export function checkCall(command: string, moment: Moment): Verdict {
  const parsed = parseCommand(command, moment.pluginRoot)
  if ('error' in parsed) return { deny: parsed.error }
  const { sub } = parsed
  if (sub === REQUEST_APPROVAL) return moment.bound.length ? { approval: true } : { deny: 'No flow is bound to this session.' }
  if (sub === 'approve-step') return { deny: 'Only the user approves a step, with a click in the approval dialog. Call request-approval.' }
  const wrong = checkInput(sub, parsed.input)
  if (wrong) return { deny: wrong }
  const input = { ...(parsed.input as Doc) }
  for (const key of ['flowDir', 'templatePath', 'projectPath', 'parentFlowPath', 'childFlowPath']) if (typeof input[key] === 'string') input[key] = slash(input[key] as string)

  const state = root(moment.home)
  if (sub === 'create-flow') {
    if (!new RegExp(`^${state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/active/[^/]+$`).test(input.flowDir as string)) return { deny: `A new flow goes in ${state}/active/<name>, one folder deep.` }
    if (!(input.templatePath as string).startsWith(`${state}/templates/`)) return { deny: `A template comes from ${state}/templates/.` }
    if (input.parentFlowPath !== undefined && !moment.bound.includes(input.parentFlowPath as string)) return { deny: 'The parent flow is not bound to this session.' }
    return { allow: true, sub, input }
  }
  if (!moment.bound.length) return { deny: 'No flow is bound to this session. Start one on the ZeremAI site (/zeremai), or create one with create-flow.' }
  if (sub === 'list-findings' || sub === 'update-finding-status') return { allow: true, sub, input } // not about one flow folder
  if (typeof input.flowDir === 'string' && !moment.bound.includes(input.flowDir)) return { deny: `That folder is not a flow of this session. Flows of this session: ${moment.bound.join(', ')}` }

  if (sub === 'log-interaction') return { allow: true, sub, input }
  if (moment.dialogOpen && DIALOG_GATED.includes(sub)) return { deny: 'The approval dialog is open. Wait for the user to answer, then go on.' }
  if (sub === 'update-step-status' && input.status === 'completed') {
    const step = moment.steps.find(s => s.id === input.stepId)
    if (step?.approvalRequired && step.approved !== true) return { deny: 'This step needs the approval of the user. Call request-approval first; the user approves with a click.' }
  }
  return { allow: true, sub, input }
}

// An answer of the mod to a Bash call, as the Bash output (the call is not run).
export const bashAnswer = (text: string) => ({ result: { stdout: text, stderr: '', interrupted: false } }) as never

// The user approved: the script writes `approved` on the step. A refusal is an error, so nothing says "approved" when nothing was written.
export async function approveStep(run: Runner, python: string, pluginRoot: string, dir: string, stepId: string): Promise<void> {
  const done = await runScript(run, python, pluginRoot, 'approve-step', { flowDir: dir, stepId })
  if (done.status !== 'ok') throw new Error(done.message ?? 'approve-step failed')
}

// The line the agent gets with every flow the pane hands over.
export const scriptNote = (pluginRoot: string, python: string) =>
  `Change flow files only with the flow script, one command at a time, in exactly this form: ${python} ${scriptPath(pluginRoot)} <subcommand> --json '<one JSON object>' ` +
  `(single quotes; an apostrophe inside the JSON is written '\\''; no pipe, no ;, nothing after the closing quote). ` +
  `Example: ${python} ${scriptPath(pluginRoot)} update-step-status --json '{"flowDir":"<flow folder>","stepId":"<step id>","status":"in_progress"}'. ` +
  `Subcommands: ${[...AGENT_SUBCOMMANDS, REQUEST_APPROVAL].join(', ')}. The plugin refuses a call at the wrong moment or with a wrong input, and says why. See the flow-state-update skill.`
