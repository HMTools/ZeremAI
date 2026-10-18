import { test, expect } from 'claude-code/testing'
import { bindSession } from './bind-session'
import { ACTIVE, DIR, world } from './fake-world'

const FLOW = { [`${DIR}/flow.json`]: {} }

test('a flow folder goes on the list of the session', async () => {
  const w = world(FLOW)
  expect((await bindSession(w.ports, DIR)).status).toBe('ok')
  expect(w.links.S1).toEqual([DIR])
})
test('a child is added after its parent, and binding a folder again moves it last', async () => {
  const child = `${ACTIVE}/p1-c1`
  const w = world({ ...FLOW, [`${child}/flow.json`]: {} })
  await bindSession(w.ports, DIR)
  await bindSession(w.ports, child)
  expect(w.links.S1).toEqual([DIR, child])
  await bindSession(w.ports, DIR)
  expect(w.links.S1).toEqual([child, DIR])
})
test('a folder outside active/ is refused', async () => {
  const w = world({ '/h/other/p1/flow.json': {} })
  await expect(bindSession(w.ports, '/h/other/p1')).rejects.toThrow('Not a folder in active/')
})
test('a folder with no flow.json is refused', async () => {
  const w = world({ [`${DIR}/log.json`]: {} })
  await expect(bindSession(w.ports, DIR)).rejects.toThrow('No flow.json')
  expect(w.links.S1).toBeUndefined()
})
