import { test, expect } from 'claude-code/testing'
import { raiseLogOwed, isLogOwed, clearLogOwed, LOG_TOOL, LOG_GATED_TOOLS } from './log-owed'
import type { FileSystem } from '../ports/ports'

const ACTIVE = '/h/.claude/zeremai/active'
const disk: FileSystem = {
  home: async () => '/h',
  list: async () => [],
  exists: async path => path === `${ACTIVE}/a/flow.json`,
  read: async () => '',
}
const bound = (id: string) => ({ get: async (s: string) => (s === id ? [`${ACTIVE}/a`] : []) })

test('a prompt in a session with a flow owes a log, until it is cleared', async () => {
  clearLogOwed('S1')
  await raiseLogOwed(disk, bound('S1'), 'S1')
  expect(isLogOwed('S1')).toBe(true)
  clearLogOwed('S1')
  expect(isLogOwed('S1')).toBe(false)
})
test('a prompt in a session with no flow owes nothing', async () => {
  clearLogOwed('S1')
  await raiseLogOwed(disk, bound('other'), 'S1')
  expect(isLogOwed('S1')).toBe(false)
})
test('one session does not owe for another', async () => {
  clearLogOwed('S1'); clearLogOwed('S2')
  await raiseLogOwed(disk, bound('S1'), 'S1')
  expect(isLogOwed('S2')).toBe(false)
})
test('the log tool and the tools that change the flow are named', () => {
  expect(LOG_TOOL).toBe('mcp__zeremai__log_interaction')
  expect(LOG_GATED_TOOLS).toContain('mcp__zeremai__update_step_status')
  expect(LOG_GATED_TOOLS).not.toContain(LOG_TOOL)
  expect(LOG_GATED_TOOLS).not.toContain('mcp__zeremai__list_findings')
})
