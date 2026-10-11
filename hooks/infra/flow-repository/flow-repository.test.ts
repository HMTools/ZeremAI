import { test, expect } from 'claude-code/testing'
import { findFlowDir, readFlow } from './flow-repository'
import type { FileSystem } from '../ports/ports'

const ACTIVE = '/h/.claude/zeremai/active'

// a fake disk: path → contents. A folder is any path that starts a longer one.
function disk(files: Record<string, string>): FileSystem {
  return {
    home: async () => '/h',
    list: async path => {
      const names = Object.keys(files).filter(f => f.startsWith(`${path}/`)).map(f => f.slice(path.length + 1).split('/')[0])
      if (!names.length) throw new Error('no such folder')
      return [...new Set(names)].map(name => ({ name, kind: 'dir' }))
    },
    exists: async path => path in files,
    read: async path => { if (!(path in files)) throw new Error('missing'); return files[path] },
  }
}

const links = (byId: Record<string, string[]>) => ({ get: async (id: string) => byId[id] ?? [] })
const A = `${ACTIVE}/a`
const B = `${ACTIVE}/b`

test('finds the flow folder the session bound', async () => {
  const files = disk({ [`${A}/flow.json`]: '{}' })
  expect(await findFlowDir(files, links({ S1: [A] }), 'S1')).toBe(A)
})
test('the session bound nothing: nothing', async () => {
  expect(await findFlowDir(disk({ [`${A}/flow.json`]: '{}' }), links({ S0: [A] }), 'S1')).toBeUndefined()
})
test('a child, bound after its parent, answers first', async () => {
  const files = disk({ [`${A}/flow.json`]: '{}', [`${B}/flow.json`]: '{}' })
  expect(await findFlowDir(files, links({ S1: [A, B] }), 'S1')).toBe(B)
})
test('a folder that left active/ is skipped, so the parent answers again', async () => {
  const files = disk({ [`${A}/flow.json`]: '{}' })
  expect(await findFlowDir(files, links({ S1: [A, B] }), 'S1')).toBe(A)
})
test('every folder of the list is gone: nothing', async () => {
  expect(await findFlowDir(disk({}), links({ S1: [A] }), 'S1')).toBeUndefined()
})
test('reads flow.json', async () => {
  const files = disk({ '/p/flow.json': '{"status":"running","steps":[]}' })
  expect(await readFlow(files, '/p')).toEqual({ status: 'running', steps: [] })
})
test('a flow.json that is not valid JSON: nothing', async () => {
  expect(await readFlow(disk({ '/p/flow.json': '{oops' }), '/p')).toBeUndefined()
})
