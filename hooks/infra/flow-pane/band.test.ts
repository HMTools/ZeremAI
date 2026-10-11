import { test, expect } from 'claude-code/testing'
import { bandView, kindCounts } from './band'
import type { FlowInfo } from './flow-pane'

const NOW = 1_000_000_000_000
const p = (o: Partial<FlowInfo>): FlowInfo => ({ dir: '/a', name: 'Bug fix', step: 3, total: 7, updated: '', kind: 'running', folders: [], ...o })

test('with no bound flow the band says Flows, and counts the others by kind', () => {
  expect(bandView([p({ kind: 'running' })], undefined, NOW)).toMatchObject({ text: 'Flows', hot: false })
  const band = bandView([p({ dir: '/a', kind: 'waiting' }), p({ dir: '/b', kind: 'failed' }), p({ dir: '/c', kind: 'waiting' })], undefined, NOW)
  expect(band.text).toBe('Flows · ▲2 approve · ✕1 failed')
  expect(band.hot).toBe(true)
})
test('a bound flow is named with its step and state; the count is of the other flows', () => {
  const list = [p({ dir: '/a', kind: 'waiting', waitStep: '3' }), p({ dir: '/b', name: 'Other', kind: 'failed' })]
  const band = bandView(list, '/a', NOW)
  expect(band.text).toBe('▲ Bug fix · step 3/7 · approve step 3 · ✕1 failed')
  expect(band.parts[0].tone).toBe('warning')
})
test('a running bound flow shows the no-log note only when it has gone quiet', () => {
  expect(bandView([p({ lastLogMs: NOW - 3 * 60_000 })], '/a', NOW).text).toBe('● Bug fix · step 3/7 · running')
  expect(bandView([p({ lastLogMs: NOW - 12 * 60_000 })], '/a', NOW).text).toBe('● Bug fix · step 3/7 · running · no log for 12 min')
})
test('the kinds that have no flow are left out', () => {
  expect(kindCounts([p({ kind: 'running' }), p({ kind: 'done' })])).toEqual([])
  expect(kindCounts([p({ kind: 'paused' })]).map(x => x.text)).toEqual(['‖1 paused'])
})
