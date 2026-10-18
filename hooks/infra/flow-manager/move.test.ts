import { test, expect } from 'claude-code/testing'
import { moveCommands, removeCommands, slash } from './move'

test('macOS and Linux: mkdir -p, then mv', () => {
  expect(moveCommands(false, '/h/.claude/zeremai/active/p1', '/h/.claude/zeremai/completed/p1')).toEqual([
    ['mkdir', '-p', '/h/.claude/zeremai/completed'],
    ['mv', '/h/.claude/zeremai/active/p1', '/h/.claude/zeremai/completed/p1'],
  ])
})
test('Windows: one PowerShell command that makes the folder and moves, and stops on the first error', () => {
  const [argv, ...rest] = moveCommands(true, 'C:/Users/me/.claude/zeremai/active/p1', 'C:/Users/me/.claude/zeremai/completed/p1')
  expect(rest).toEqual([])
  expect(argv.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-Command'])
  expect(argv[4]).toContain("$ErrorActionPreference = 'Stop'")
  expect(argv[4]).toContain("New-Item -ItemType Directory -Force -Path 'C:/Users/me/.claude/zeremai/completed'")
  expect(argv[4]).toContain("Move-Item -LiteralPath 'C:/Users/me/.claude/zeremai/active/p1' -Destination 'C:/Users/me/.claude/zeremai/completed/p1'")
})
test('Windows: a quote in a path cannot end the PowerShell string', () => {
  const script = moveCommands(true, "C:/Users/o'brien/a/p1", "C:/Users/o'brien/b/p1")[0][4]
  expect(script).toContain("'C:/Users/o''brien/a/p1'")
})
test('remove: rm -rf on macOS and Linux, one PowerShell command on Windows, and a quote cannot end the string', () => {
  expect(removeCommands(false, '/h/.claude/zeremai/active/p1')).toEqual([['rm', '-rf', '/h/.claude/zeremai/active/p1']])
  const [argv] = removeCommands(true, "C:/Users/o'brien/active/p1")
  expect(argv.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-Command'])
  expect(argv[4]).toContain("Remove-Item -LiteralPath 'C:/Users/o''brien/active/p1' -Recurse -Force")
})
test('backslashes become slashes', () => {
  expect(slash('C:\\Users\\me\\.claude')).toBe('C:/Users/me/.claude')
  expect(slash('/h/x')).toBe('/h/x')
})
