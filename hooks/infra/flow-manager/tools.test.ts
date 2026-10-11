import { test, expect } from 'claude-code/testing'
import { DIR, flowFile, world } from './fake-world'
import { FLOW_TOOLS, TOOL_PREFIX, ensureFlowTools, runTool } from './tools'

test('16 tools: one for each command of the old script, and bind_flow, with a unique name and a schema', () => {
  expect(FLOW_TOOLS.length).toBe(16)
  expect(new Set(FLOW_TOOLS.map(t => t.name)).size).toBe(16)
  for (const t of FLOW_TOOLS) {
    expect(t.inputSchema.type).toBe('object')
    expect(t.description.length).toBeGreaterThan(10)
    for (const key of t.inputSchema.required) expect(Object.keys(t.inputSchema.properties)).toContain(key)
  }
  expect(FLOW_TOOLS.map(t => t.name)).toContain('log_interaction')
  expect(TOOL_PREFIX).toBe('mcp__zeremai__')
})
test('a tool runs and answers as the script did', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  expect(await runTool(w.ports, 'update_step_status', { flowDir: DIR, stepId: 's1', status: 'in_progress' })).toEqual({ status: 'ok', files_written: ['flow.json'] })
})
test('a missing input and a value outside an enum are errors that name the problem', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  expect(await runTool(w.ports, 'update_step_status', { flowDir: DIR })).toEqual({ status: 'error', message: 'Missing input for update_step_status: stepId, status' })
  expect((await runTool(w.ports, 'update_step_status', { flowDir: DIR, stepId: 's1', status: 'nope' })).message).toContain('Invalid status "nope"')
})
test('a rule that fails is an error answer, not a throw', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  expect((await runTool(w.ports, 'update_step_status', { flowDir: DIR, stepId: 'zzz', status: 'completed' }))).toEqual({ status: 'error', message: 'Step zzz not found' })
})
test('a path with backslashes works, as on Windows', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  const result = await runTool(w.ports, 'update_step_status', { flowDir: DIR.replace(/\//g, '\\'), stepId: 's1', status: 'in_progress' })
  expect(result.status).toBe('ok')
})
test('an unknown tool is an error', async () => {
  expect((await runTool(world().ports, 'nope', {})).status).toBe('error')
})
test('the tools are listed once for each session, behind tool search, with the approval tool', async () => {
  const listed: any[] = []
  const register = async (spec: any) => { listed.push(spec) }
  await ensureFlowTools(register, 'S-lazy')
  await ensureFlowTools(register, 'S-lazy')
  expect(listed.length).toBe(17)
  expect(listed.every(s => s.isDeferred)).toBe(true)
  expect(listed.map(s => s.name)).toContain('request_approval')
  await ensureFlowTools(register, 'S-other')
  expect(listed.length).toBe(34)
})
test('a failed registration is tried again next time', async () => {
  let fails = true
  const register = async () => { if (fails) throw new Error('not bound yet') }
  await expect(ensureFlowTools(register, 'S-retry')).rejects.toThrow('not bound yet')
  fails = false
  await ensureFlowTools(register, 'S-retry')
})
