import { expect, test } from 'claude-code/testing'
import { PANDA_SIZE, pandaSvg, poseOf, type Pose } from './panda'

test('every pose is a 16 by 14 picture with a headband', () => {
  for (const pose of ['surfing', 'arms-up', 'waving', 'water'] as Pose[]) {
    const p = pandaSvg(pose)
    expect(p.width).toBe(PANDA_SIZE.width)
    expect(p.source.startsWith('<svg')).toBe(true)
    expect(p.source.match(/<rect /g)!.length).toBeGreaterThan(60)
    expect(p.source).not.toContain('undefined')
  }
})
test('the pose follows the notice and goes back when it clears', () => {
  expect(poseOf('success', 'Created')).toBe('arms-up')
  expect(poseOf('error', 'No network')).toBe('water')
  expect(poseOf('info', 'Filling…')).toBe('surfing')
  expect(poseOf('success', '')).toBe('surfing')
})
