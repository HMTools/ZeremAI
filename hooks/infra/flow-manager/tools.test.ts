import { test, expect } from 'claude-code/testing'
import { FLOW_TOOLS } from './tools'
import { AGENT_SUBCOMMANDS, SCRIPT_SUBCOMMANDS } from './script'

test('17 flow operations, each with a unique name, a description and a schema whose required keys exist', () => {
  expect(FLOW_TOOLS.length).toBe(17)
  expect(new Set(FLOW_TOOLS.map(t => t.name)).size).toBe(17)
  for (const t of FLOW_TOOLS) {
    expect(t.inputSchema.type).toBe('object')
    expect(t.description.length).toBeGreaterThan(10)
    for (const key of t.inputSchema.required) expect(Object.keys(t.inputSchema.properties)).toContain(key)
  }
  expect(FLOW_TOOLS.map(t => t.name)).not.toContain('log_interaction') // the mod logs, not the agent
})
test('the agent gets every operation but bind_flow (the mod\'s own); approve-step is the mod\'s alone', () => {
  expect(AGENT_SUBCOMMANDS).toContain('update-step-status')
  expect(AGENT_SUBCOMMANDS).not.toContain('log-interaction')
  expect(AGENT_SUBCOMMANDS).not.toContain('bind-flow')
  expect(AGENT_SUBCOMMANDS).not.toContain('approve-step')
  expect(SCRIPT_SUBCOMMANDS).toContain('approve-step')
  expect(AGENT_SUBCOMMANDS.length).toBe(16)
})
