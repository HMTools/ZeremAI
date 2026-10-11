import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`
const flow = JSON.stringify({ status: 'running', steps: [], currentState: { activeStep: { id: 's7' } } })

// fake disk: one flow folder bound to `boundTo`; the tool itself answers "done"
function world(on: On, boundTo: string) {
  const all: Record<string, string> = { [`${DIR}/flow.json`]: flow }
  mock.env(on, { HOME: '/h' })
  mock.store(on, { [`session:${boundTo}`]: [DIR] })
  on('session.id', async () => ({ value: 'S1' }))
  on('fs.list', async (_$, e) => ({ value: e.path === ACTIVE ? [{ name: 'p1', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.exists', async (_$, e) => ({ value: e.path in all }))
  on('fs.read', async (_$, e) => ({ value: all[e.path] }))
  on('prompt.submit', async () => ({ drop: 'test' }))
  on('tool.call', async () => ({ result: 'done', text: 'done' }) as never)
}
const write = ($: any) => $.tool.call({ tool: 'Write', file_path: '/x', content: 'y' })

test('a prompt in a session with a flow: the agent owes a log, so Write is refused', async ($, on) => {
  world(on, 'S1')
  await $.prompt.submit({ text: 'please change the plan' })
  expect((await write($)).deny).toContain('not yet logged')
})
test('a prompt in a session with no flow: nothing is owed', async ($, on) => {
  world(on, 'other')
  await $.prompt.submit({ text: 'hello' })
  expect((await write($)).deny).toBeUndefined()
})
test('no prompt yet: nothing is owed', async ($, on) => {
  world(on, 'S1')
  expect((await write($)).deny).toBeUndefined()
})
// The origin filter (a prompt the plugin sends owes nothing) is checked by a live run: a test cannot send a plugin prompt as such.
