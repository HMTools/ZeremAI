import { test, expect } from 'claude-code/testing'
import { createRepromptLimiter } from './reprompt-limiter'

test('counts the same key in a row', () => {
  const limiter = createRepromptLimiter()
  expect([limiter.record('s1:pending'), limiter.record('s1:pending'), limiter.record('s1:pending')]).toEqual([1, 2, 3])
})
test('a different key starts the count again', () => {
  const limiter = createRepromptLimiter()
  limiter.record('s1:pending'); limiter.record('s1:pending')
  expect(limiter.record('s2:pending')).toBe(1)
})
test('reset starts the count again', () => {
  const limiter = createRepromptLimiter()
  limiter.record('s1:pending'); limiter.reset()
  expect(limiter.record('s1:pending')).toBe(1)
})
test('each limiter counts on its own', () => {
  const first = createRepromptLimiter()
  const second = createRepromptLimiter()
  first.record('k'); first.record('k')
  expect(second.record('k')).toBe(1)
})
