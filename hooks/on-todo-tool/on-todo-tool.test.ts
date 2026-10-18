import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ACTIVE = '/h/.claude/zeremai/active'
const DIR = `${ACTIVE}/p1`

// fake disk: one flow folder bound to `bound`, with the given flow status
function world(on: On, { status = 'running', bound = 'S1', pending = false } = {}) {
  const all: Record<string, string> = {
    [`${DIR}/flow.json`]: JSON.stringify({ status, steps: [{ id: 's1', status: 'running' }] }),
  }
  mock.env(on, { HOME: '/h' })
  mock.store(on, { [`session:${bound}`]: [DIR], ...(pending ? { 'gate:S1': { dir: DIR, stepId: 's1' } } : {}) })
  on('session.id', async () => ({ value: 'S1' }))
  on('fs.list', async (_$, e) => ({ value: e.path === ACTIVE ? [{ name: 'p1', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.exists', async (_$, e) => ({ value: e.path in all }))
  on('fs.read', async (_$, e) => ({ value: all[e.path] }))
  on('tool.call', async () => ({ result: 'done', text: 'done' }) as never)
}
const call = ($: any, tool: string, extra = {}) => $.tool.call({ tool, ...extra })

test('a refused todo call raises one toast, and the same refusal within 30 seconds raises none', async ($, on) => {
  world(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await call($, 'TaskCreate')
  await call($, 'TaskUpdate')
  expect(toasts).toEqual(['Flow: todo tools are off while a flow runs.'])
})
for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite']) {
  test(`running: ${tool} is refused`, async ($, on) => {
    world(on)
    expect((await call($, tool)).deny).toContain('flow steps are your task list')
  })
}
test('running, approval waits: TaskCreate is refused', async ($, on) => {
  world(on, { pending: true })
  expect((await call($, 'TaskCreate')).deny).toBeDefined() // the checkpoint guard may answer first
})
test('running: TaskStop passes', async ($, on) => {
  world(on)
  expect((await call($, 'TaskStop')).deny).toBeUndefined()
})
test('running: a subagent call passes', async ($, on) => {
  world(on)
  expect((await call($, 'TaskCreate', { agentId: 'a1' })).deny).toBeUndefined()
})
test('finished flow: TaskCreate passes', async ($, on) => {
  world(on, { status: 'completed' })
  expect((await call($, 'TaskCreate')).deny).toBeUndefined()
})
test('flow of another session: TaskCreate passes', async ($, on) => {
  world(on, { bound: 'other' })
  expect((await call($, 'TaskCreate')).deny).toBeUndefined()
})
