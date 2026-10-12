import { test, expect } from 'claude-code/testing'
import { checkCall, checkInput, parseCommand, runScript, runsScript, scriptNote } from './script'
import type { Moment } from './script'

const ROOT = '/p'
const DIR = '/h/.claude/zeremai/active/p1'
const NEW = '/h/.claude/zeremai/active/new1'
const moment = (extra: Partial<Moment> = {}): Moment => ({
  pluginRoot: ROOT, home: '/h', bound: [DIR], dialogOpen: false,
  steps: [{ id: 's1', status: 'in_progress', approvalRequired: false }], ...extra,
})
const cmd = (sub: string, input: unknown, path = `${ROOT}/scripts/flow_manager.py`) => `python3 ${path} ${sub} --json '${JSON.stringify(input).replace(/'/g, "'\\''")}'`
const step = (status: string, extra = {}) => cmd('update-step-status', { flowDir: DIR, stepId: 's1', status, ...extra })

// ── the one command form ─────────────────────────────────────────────────

test('the one form runs: python3, this plugin\'s script, a subcommand, --json and one object', () => {
  expect(checkCall(step('in_progress'), moment())).toEqual({ allow: true, sub: 'update-step-status', input: { flowDir: DIR, stepId: 's1', status: 'in_progress' } })
})
test('every other form is refused: more shell, another quote, no --json, another script, another interpreter', () => {
  const ok = step('in_progress')
  for (const bad of [
    `${ok} && rm -rf /`, `${ok}; ls`, `${ok} | cat`, `${ok} > out.txt`, `${ok}\nls`,
    `python3 ${ROOT}/scripts/flow_manager.py update-step-status --json "{}"`, // double quotes
    `python3 ${ROOT}/scripts/flow_manager.py update-step-status`,
    `python3 ${ROOT}/scripts/flow_manager.py update-step-status --flow-dir ${DIR}`,
    cmd('update-step-status', { flowDir: DIR }, '/elsewhere/scripts/flow_manager.py'),
    `env X=1 ${ok}`, `bash -c "${ok}"`,
  ]) expect('deny' in checkCall(bad, moment())).toBe(true)
})
test('only a command that runs the script is checked; reading it is not', () => {
  expect(runsScript('cat scripts/flow_manager.py')).toBe(false)
  expect(runsScript('git diff scripts/flow_manager.py')).toBe(false)
  expect(runsScript('ls')).toBe(false)
  expect(runsScript(step('in_progress'))).toBe(true)
  expect(runsScript('python3 other/flow_manager.py list-findings')).toBe(true)
  expect(runsScript('cd x && python scripts/flow_manager.py log-interaction')).toBe(true)
  expect(runsScript('./scripts/flow_manager.py approve-step')).toBe(true)
})
test('an apostrophe in the JSON is written \'\\\'\' and arrives whole', () => {
  const parsed = parseCommand(cmd('log-interaction', { request: "it's done" }), ROOT)
  expect(parsed).toEqual({ sub: 'log-interaction', input: { request: "it's done" } })
})
test('bad JSON after --json is refused', () => {
  expect(parseCommand(`python3 ${ROOT}/scripts/flow_manager.py update-step-status --json '{oops'`, ROOT)).toEqual({ error: 'The text after --json must be one JSON object.' })
})

// ── the arguments ────────────────────────────────────────────────────────

test('the input is checked against the schema: required, unknown keys, types, enums', () => {
  expect(checkInput('update-step-status', { flowDir: DIR, stepId: 's1', status: 'completed' })).toBeUndefined()
  expect(checkInput('update-step-status', { flowDir: DIR })).toBe('Missing input for update-step-status: stepId, status')
  expect(checkInput('update-step-status', { flowDir: DIR, stepId: 's1', status: 'nope' })).toContain('Invalid status "nope"')
  expect(checkInput('update-step-status', { flowDir: DIR, stepId: 's1', status: 'completed', extra: 1 })).toContain('Unknown input "extra"')
  expect(checkInput('update-step-status', { flowDir: DIR, stepId: 5, status: 'completed' })).toBe('Input "stepId" must be of type string.')
  expect(checkInput('add-log-entry', { flowDir: DIR, stepId: 's1', actions: 'one' })).toBe('Input "actions" must be of type array.')
  expect(checkInput('nope', {})).toContain('Unknown subcommand: nope')
  expect(checkInput('update-step-status', [1])).toBe('The input must be one JSON object.')
})
test('the agent never gets approve-step; request-approval is the mod\'s own dialog', () => {
  expect(checkCall(cmd('approve-step', { flowDir: DIR, stepId: 's1' }), moment())).toEqual({ deny: 'Only the user approves a step, with a click in the approval dialog. Call request-approval.' })
  expect(checkCall(cmd('request-approval', {}), moment())).toEqual({ approval: true })
  expect(checkCall(cmd('request-approval', {}), moment({ bound: [] }))).toEqual({ deny: 'No flow is bound to this session.' })
  expect(checkCall(cmd('bind-flow', { flowDir: DIR }), moment())).toEqual({ deny: expect.stringContaining('Unknown subcommand: bind-flow') }) // the session link is the mod's own
})
test('a flow folder must be a flow of this session', () => {
  const other = cmd('update-step-status', { flowDir: '/h/.claude/zeremai/active/other', stepId: 's1', status: 'in_progress' })
  expect(checkCall(other, moment())).toEqual({ deny: expect.stringContaining('not a flow of this session') })
  expect('allow' in checkCall(step('in_progress'), moment({ bound: ['/h/.claude/zeremai/active/parent', DIR] }))).toBe(true)
})
test('a path with backslashes is the same folder', () => {
  const result = checkCall(cmd('update-step-status', { flowDir: DIR.replace(/\//g, '\\'), stepId: 's1', status: 'in_progress' }), moment())
  expect('allow' in result).toBe(true)
})

// ── the moment ───────────────────────────────────────────────────────────

test('no flow bound: only create-flow runs, and only into active/ from a template', () => {
  expect(checkCall(step('in_progress'), moment({ bound: [] }))).toEqual({ deny: expect.stringContaining('No flow is bound') })
  const create = (extra = {}) => cmd('create-flow', { flowDir: NEW, templatePath: '/h/.claude/zeremai/templates/flows/dev/bug/bug.json', ...extra })
  expect('allow' in checkCall(create(), moment({ bound: [] }))).toBe(true)
  expect(checkCall(create({ flowDir: '/etc/x' }), moment({ bound: [] }))).toEqual({ deny: expect.stringContaining('one folder deep') })
  expect(checkCall(create({ flowDir: `${NEW}/deep/er` }), moment({ bound: [] }))).toEqual({ deny: expect.stringContaining('one folder deep') })
  expect(checkCall(create({ templatePath: '/tmp/evil.json' }), moment({ bound: [] }))).toEqual({ deny: expect.stringContaining('A template comes from') })
  expect(checkCall(create({ parentFlowPath: '/h/.claude/zeremai/active/zzz' }), moment())).toEqual({ deny: 'The parent flow is not bound to this session.' })
  expect('allow' in checkCall(create({ parentFlowPath: DIR }), moment())).toBe(true)
})
test('the approval dialog is open: nothing that changes the flow runs, notes and logs still do', () => {
  const open = moment({ dialogOpen: true })
  expect(checkCall(step('in_progress'), open)).toEqual({ deny: expect.stringContaining('approval dialog is open') })
  expect(checkCall(cmd('update-flow-status', { flowDir: DIR, status: 'paused' }), open)).toEqual({ deny: expect.stringContaining('approval dialog is open') })
  expect('allow' in checkCall(cmd('add-log-entry', { flowDir: DIR, stepId: 's1' }), open)).toBe(true)
})
test('a step that waits for approval cannot be completed, but can be worked on', () => {
  const waiting = moment({ steps: [{ id: 's1', status: 'in_progress', approvalRequired: true, approved: false }] })
  expect(checkCall(step('completed'), waiting)).toEqual({ deny: expect.stringContaining('needs the approval of the user') })
  expect('allow' in checkCall(step('in_progress'), waiting)).toBe(true)
  const approved = moment({ steps: [{ id: 's1', status: 'in_progress', approvalRequired: true, approved: true }] })
  expect('allow' in checkCall(step('completed'), approved)).toBe(true)
})

// ── running the script as the mod ────────────────────────────────────────

test('the mod runs the script with the subcommand and one JSON argument, and reads the last line as the answer', async () => {
  let seen: string[] = []
  const answer = await runScript(async argv => { seen = argv; return { exitCode: 0, stdout: 'noise\n{"status":"ok","files_written":["flow.json"]}\n', stderr: '' } }, 'python3', ROOT, 'approve-step', { flowDir: DIR, stepId: 's1' })
  expect(seen).toEqual(['python3', '/p/scripts/flow_manager.py', 'approve-step', '--json', JSON.stringify({ flowDir: DIR, stepId: 's1' })])
  expect(answer).toEqual({ status: 'ok', files_written: ['flow.json'] })
})
test('a script that prints no JSON or does not start is an error result, not a throw', async () => {
  expect((await runScript(async () => ({ exitCode: 1, stdout: '', stderr: 'boom' }), 'python3', ROOT, 'x', {})).message).toContain('gave no JSON (exit 1): boom')
  expect((await runScript(async () => { throw new Error('spawn python3 ENOENT') }, 'python3', ROOT, 'x', {})).message).toContain('did not start: spawn python3 ENOENT')
})
test('the first message to the agent names the exact command form and the subcommands', () => {
  const note = scriptNote(ROOT, 'python3')
  expect(note).toContain("python3 /p/scripts/flow_manager.py <subcommand> --json '<one JSON object>'")
  expect(note).toContain('update-step-status')
  expect(note).toContain('request-approval')
  expect(note).not.toContain('approve-step')
})
