import { test, expect } from 'claude-code/testing'
import { raiseLogOwed, isLogOwed, clearLogOwed, owedPrompt } from './log-owed'
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
test('the prompt that raised the log is kept for the session', async () => {
  clearLogOwed('S1')
  await raiseLogOwed(disk, bound('S1'), 'S1', 'fix the header')
  expect(owedPrompt('S1')).toBe('fix the header')
  clearLogOwed('S1')
  expect(owedPrompt('S1')).toBe('')
})
