import { test, expect } from 'claude-code/testing'
import { activityOf, ago, isIdle } from './activity'

const NOW = 1_000_000_000_000
const back = (minutes: number) => NOW - minutes * 60_000

test('a running flow says how long ago it wrote its log, and after 10 minutes says there is no log', () => {
  expect(activityOf('running', back(0), NOW)).toEqual({ text: 'last log just now', quiet: false })
  expect(activityOf('running', back(3), NOW)).toEqual({ text: 'last log 3 min ago', quiet: false })
  expect(activityOf('running', back(9), NOW)).toEqual({ text: 'last log 9 min ago', quiet: false })
  expect(activityOf('running', back(10), NOW)).toEqual({ text: 'no log for 10 min', quiet: true })
  expect(activityOf('running', back(12), NOW)).toEqual({ text: 'no log for 12 min', quiet: true })
})
test('only a running flow with a known time gets a note', () => {
  for (const kind of ['waiting', 'failed', 'paused', 'done', 'pending'] as const) expect(activityOf(kind, back(30), NOW)).toBeUndefined()
  expect(activityOf('running', undefined, NOW)).toBeUndefined()
})
test('a time ago reads as minutes, hours, yesterday or days', () => {
  expect(ago(undefined, NOW)).toBe('')
  expect(ago(NOW - 20_000, NOW)).toBe('just now')
  expect(ago(NOW - 5 * 60_000, NOW)).toBe('5 min ago')
  expect(ago(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago')
  expect(ago(NOW - 30 * 3_600_000, NOW)).toBe('yesterday')
  expect(ago(NOW - 4 * 86_400_000, NOW)).toBe('4 days ago')
})

test('a long silence is said in hours and days, and a run with no log for a day is idle', () => {
  expect(activityOf('running', back(180), NOW)?.text).toBe('no log for 3 h')
  expect(activityOf('running', back(17354), NOW)?.text).toBe('no log for 12 days')
  expect(isIdle('running', back(1439), NOW)).toBe(false)
  expect(isIdle('running', back(1440), NOW)).toBe(true)
  expect(isIdle('done', back(1440), NOW)).toBe(false)
})
