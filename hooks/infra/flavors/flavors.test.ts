import { test, expect } from 'claude-code/testing'
import { flavorSection, flavorsFor, parseIds } from './flavors'

const known = new Set(['a', 'b'])

test('parseIds keeps the saved ids once, and ignores the rest of the reply', () => {
  expect(parseIds('Sure: ["a", "x", "a", 3, "b"] done', known)).toEqual(['a', 'b'])
  expect(parseIds('none', known)).toEqual([])
  expect(parseIds('[nope', known)).toEqual([])
  expect(parseIds('{"a":1}', known)).toEqual([])
})
test('no flavors, no section', () => {
  expect(flavorSection([])).toBe('')
  expect(flavorSection([{ topic: 'Git', text: 'Short titles.' }])).toContain('- Git: Short titles.')
})
test('a script that throws gives no section', async () => {
  const deps = { complete: async () => ({ isAnswered: true as const, text: '[]' }), script: async () => Promise.reject(new Error('boom')) }
  expect(await flavorsFor(deps as never, 'brief')).toBe('')
})
test('a flavor that is pending now is left out, even if Haiku names it', async () => {
  const script = async (_sub: string, input: Record<string, unknown>) =>
    input.id ? { status: 'ok' as const, flavor: { id: 'a', topic: 'T', text: 'x', status: 'pending' } } : { status: 'ok' as const, flavors: [{ id: 'a', topic: 'T', description: 'x', status: 'active' }] }
  const deps = { complete: async () => ({ isAnswered: true as const, text: '["a"]' }), script }
  expect(await flavorsFor(deps as never, 'brief')).toBe('')
})
