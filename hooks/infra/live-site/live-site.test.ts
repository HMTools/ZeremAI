import { test, expect } from 'claude-code/testing'
import { checkCommand, flavorDocs, hashOf, parseDocs, sessionDoc, sessionTitle, templateDocs } from './live-site'
import type { CommandWorld } from './live-site'

const waiting = {
  id: 'f1',
  steps: [
    { id: 's1', number: 1, name: 'Design', status: 'in_progress', approvalRequired: true },
    { id: 's2', number: 2, name: 'Code', status: 'pending' },
  ],
}
const world: CommandWorld = { session: 'S1', bound: { f1: { dir: '/a/p1', flow: waiting as any } }, active: { f1: '/a/p1', f2: '/a/p2' } }
const row = (action: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ session: 'S1', at: 'x', action, args, status: 'new', ...extra })

test('every action passes with its arguments, and the flow actions come back with the folder', () => {
  expect(checkCommand(row('approve', { flowId: 'f1', stepId: 's1' }), world)).toEqual({ cmd: { action: 'approve', args: { flowId: 'f1', stepId: 's1' } }, dir: '/a/p1' })
  expect(checkCommand(row('request-changes', { flowId: 'f1', stepId: 's1', reason: 'Use two tables' }), world)).toMatchObject({ dir: '/a/p1' })
  expect(checkCommand(row('route', { flowId: 'f1', stepId: 's1', label: 'Back to the plan', reason: 'Wrong scope' }), world)).toMatchObject({ dir: '/a/p1' })
  expect(checkCommand(row('continue', { flowId: 'f2', note: 'retry' }), world)).toMatchObject({ dir: '/a/p2' }) // a flow in active/ that this session does not hold
  expect(checkCommand(row('continue', { flowId: 'f2', from: 'S2' }), world)).toMatchObject({ dir: '/a/p2' }) // Take over names the session that lets go
  expect(checkCommand(row('continue', { flowId: 'f2', from: '../x' }), world)).toEqual({ error: 'Not a plain name: from' })
  expect(checkCommand(row('close', { flowId: 'f1' }), world)).toMatchObject({ dir: '/a/p1' })
  expect(checkCommand(row('delete', { flowId: 'f2' }), world)).toMatchObject({ dir: '/a/p2' }) // a flow of another session: not bound here, still in active/
  expect(checkCommand(row('delete', { flowId: 'zz' }), world)).toEqual({ error: 'That flow is not in the list of running flows.' })
  expect(checkCommand(row('new-flow', { template: 'dev/bug', workItemId: '7' }), world)).toMatchObject({ cmd: { action: 'new-flow' } })
  expect(checkCommand(row('fill-fields', { template: 'dev/bug', text: 'fix refunds' }), world)).toMatchObject({ cmd: { action: 'fill-fields' } })
  expect(checkCommand(row('install-template', { marketplace: 'm1', category: 'dev', name: 'bug' }), world)).toMatchObject({ cmd: { action: 'install-template' } })
  expect(checkCommand(row('remove-template', { category: 'dev', name: 'bug' }), world)).toMatchObject({ cmd: { action: 'remove-template' } })
  expect(checkCommand(row('refresh-marketplaces', {}), world)).toMatchObject({ cmd: { action: 'refresh-marketplaces' } })
  expect(checkCommand(row('add-marketplace', { name: 'ops', url: 'https://x/y.git', priority: '5' }), world)).toMatchObject({ cmd: { action: 'add-marketplace' } })
  expect(checkCommand(row('update-marketplace', { name: 'ops', newName: 'ops2', url: 'https://x/y.git' }), world)).toMatchObject({ cmd: { action: 'update-marketplace' } })
  expect(checkCommand(row('update-marketplace', { name: 'ops', newName: '../x', url: 'u' }), world)).toEqual({ error: 'Not a plain name: newName' })
  expect(checkCommand(row('toggle-marketplace', { name: 'ops' }), world)).toMatchObject({ cmd: { action: 'toggle-marketplace' } })
  expect(checkCommand(row('remove-marketplace', { name: 'a b' }), world)).toEqual({ error: 'Not a plain name: name' })
  expect(checkCommand(row('add-marketplace', { name: 'ops' }), world)).toEqual({ error: 'Missing: url' })
  expect(checkCommand(row('set-theme', { mode: 'light' }), world)).toMatchObject({ cmd: { action: 'set-theme', args: { mode: 'light' } } })
  expect(checkCommand(row('set-theme', { mode: 'purple' }), world)).toEqual({ error: 'The theme must be auto, light or dark.' })
  expect(checkCommand(row('set-theme', {}), world)).toEqual({ error: 'Missing: mode' })
  expect(checkCommand(row('view-template', { category: 'dev', name: 'bug' }), world)).toMatchObject({ cmd: { action: 'view-template' } })
  expect(checkCommand(row('edit-template', { category: 'dev', name: 'bug', request: 'add a step' }), world)).toMatchObject({ cmd: { action: 'edit-template' } })
  expect(checkCommand(row('send-template', { marketplace: 'm1', category: 'dev', name: 'bug' }), world)).toMatchObject({ cmd: { action: 'send-template' } })
  expect(checkCommand(row('edit-template', { category: '../x', name: 'bug', request: 'x' }), world)).toEqual({ error: 'Not a plain name: category' })
  expect(checkCommand(row('edit-template', { category: 'dev', name: 'bug' }), world)).toEqual({ error: 'Missing: request' })
})

test('a row that is not a known, complete, plain command is refused with a reason', () => {
  const err = (data: unknown) => (checkCommand(data, world) as { error: string }).error
  expect(err(null)).toContain('not an object')
  expect(err(row('rm-rf', {}))).toContain('Unknown action')
  expect(err(row('constructor', {}))).toContain('Unknown action') // not a key of the table by inheritance
  expect(err(row('approve', { flowId: 'f1' }))).toBe('Missing: stepId')
  expect(err(row('request-changes', { flowId: 'f1', stepId: 's1', reason: '  ' }))).toBe('Missing: reason')
  expect(err(row('route', { flowId: 'f1', stepId: 's1', label: 'Back', reason: '  ' }))).toBe('Missing: reason') // Back needs a reason
  expect(err(row('route', { flowId: 'f1', stepId: 's1', reason: 'why' }))).toBe('Missing: label')
  expect(err(row('approve', { flowId: 'f1', stepId: 's1', extra: 'x' }))).toBe('Unexpected argument: extra')
  expect(err(row('approve', { flowId: 'f1', stepId: 5 }))).toBe('Bad value for stepId.')
  expect(err(row('request-changes', { flowId: 'f1', stepId: 's1', reason: 'x'.repeat(2001) }))).toBe('Bad value for reason.')
  expect(err(row('remove-template', { category: '../etc', name: 'x' }))).toBe('Not a plain name: category')
  expect(err(row('install-template', { marketplace: 'a b', category: 'dev', name: 'bug' }))).toBe('Not a plain name: marketplace')
  expect(err(row('new-flow', { template: 'bug' }))).toBe('The template must be category/name.')
  expect(err(row('new-flow', { template: 'dev/bug', ['__proto__']: 'x' }))).toContain('Bad argument name')
  expect(err(row('approve', { flowId: 'f1', stepId: 's1' }, { session: 'S2' }))).toBe('This command is for another session.')
  expect(err(row('approve', []))).toBe('The command has no arguments.')
})

test('a flow action needs a flow of this session, and approve needs the step that really waits', () => {
  const err = (action: string, args: Record<string, string>) => (checkCommand(row(action, args), world) as { error: string }).error
  expect(err('approve', { flowId: 'f2', stepId: 's1' })).toBe('That flow is not bound to this session.') // f2 is in active/ but this session does not hold it
  expect(err('close', { flowId: 'f2' })).toBe('That flow is not bound to this session.')
  expect(err('approve', { flowId: 'f1', stepId: 's2' })).toBe('That step no longer waits for approval.')
  expect(err('request-changes', { flowId: 'f1', stepId: 's2', reason: 'x' })).toBe('That step no longer waits for approval.')
  expect(err('continue', { flowId: 'nope' })).toBe('That flow is not in the list of running flows.')
})

test('parseDocs reads the document lines of a list answer and nothing else', () => {
  const text = `2 documents from collection "commands":\n=== BEGIN ARTIFACT DB 1 ===\n{"id":"a","data":{"x":1},"version":3,"updatedAt":"t"}\nnoise\n{"id":"b","data":{},"version":1}\n{"id":"c","data":"bad","version":1}\n=== END ===`
  expect(parseDocs(text)).toEqual([
    { id: 'a', data: { x: 1 }, version: 3 },
    { id: 'b', data: {}, version: 1 },
  ])
})

test('hashOf is the same for the same text and differs when one character changes', () => {
  expect(hashOf('page')).toBe(hashOf('page'))
  expect(hashOf('page')).not.toBe(hashOf('pagf'))
})

test('a session row names the folder, the beat and the flows it holds, and leaves out a flow that is gone', async () => {
  const files = {
    home: async () => '/h',
    list: async () => [],
    exists: async () => true,
    read: async (p: string) => {
      if (p.startsWith('/a/p1')) return JSON.stringify({ id: 'f1' })
      throw new Error('gone')
    },
  }
  expect(await sessionDoc(files, 'S1', ['/a/p1', '/a/p9'], '/work/app', 'T')).toEqual({
    op: 'set',
    collection: 'sessions',
    doc_id: 'S1',
    data: { folder: '/work/app', name: 'app', beat: 'T', flows: ['f1'] },
  })
  expect((await sessionDoc(files, 'S1', [], '/work/app', 'T', 'O')).data.openedAt).toBe('O')
})

test('the catalog and the installed templates become one row each, with fields for an installed one, and a row for each marketplace', () => {
  const t = { path: '/p', name: 'bug', category: 'dev', title: 'Bug', purpose: 'Fix a bug', stepCount: 4, fields: [{ name: 'workItemId', required: true, example: '7', description: 'Id' }] }
  const docs = templateDocs(
    [
      { marketplace: 'm1', category: 'dev', name: 'bug', title: 'Bug', description: 'd', state: 'installed' },
      { marketplace: 'm1', category: 'ops', name: 'deploy', title: 'Deploy', description: 'd2', state: 'available' },
    ],
    [t, { ...t, name: 'local', category: 'my', title: 'Local' }],
    [
      { name: 'm1', url: 'u', branch: 'main', enabled: true, priority: 1, lastSynced: 'S', cached: true },
      { name: 'bad name', url: 'u', branch: 'main', enabled: true, priority: 2, cached: false },
    ],
  )
  const by = Object.fromEntries(docs.map(d => [`${d.collection}/${d.doc_id}`, d.data]))
  expect(Object.keys(by).sort()).toEqual(['marketplaces/m1', 'templates/dev~bug', 'templates/my~local', 'templates/ops~deploy'])
  expect(by['templates/dev~bug']).toMatchObject({ installed: true, marketplace: 'm1', steps: 4, fields: [{ name: 'workItemId', required: true, example: '7' }] })
  expect(by['templates/ops~deploy']).toMatchObject({ installed: false, state: 'available', fields: [] })
  expect(by['templates/my~local']).toMatchObject({ installed: true, description: 'Fix a bug' })
  expect(by['marketplaces/m1']).toEqual({ name: 'm1', url: 'u', branch: 'main', priority: 1, templates: 2, enabled: true, cached: true, refreshedAt: 'S' })
})

test('the session title is the last ai-title of the transcript, and empty when there is none', async () => {
  const at = (read: (p: string) => Promise<string>) => ({ home: async () => '/h', list: async () => [], exists: async () => true, read })
  const seen: string[] = []
  const text = '{"type":"ai-title","aiTitle":"Old","sessionId":"S1"}\n{"type":"x"}\n{"type":"ai-title","aiTitle":"Say \\"hi\\"","sessionId":"S1"}\n'
  expect(
    await sessionTitle(
      at(async p => {
        seen.push(p)
        return text
      }),
      'S1',
      '/work/my.app',
    ),
  ).toBe('Say "hi"')
  expect(seen).toEqual(['/h/.claude/projects/-work-my-app/S1.jsonl'])
  expect(
    await sessionTitle(
      at(async () => '{"type":"x"}'),
      'S1',
      '/w',
    ),
  ).toBe('')
  expect(
    await sessionTitle(
      at(async () => {
        throw new Error('no file')
      }),
      'S1',
      '/w',
    ),
  ).toBe('')
  expect(
    (
      await sessionDoc(
        at(async () => ''),
        'S1',
        [],
        '/w/a',
        'T',
        undefined,
        'Plan',
      )
    ).data.title,
  ).toBe('Plan')
})

test('the flavor buttons pass with their arguments, and a flavor needs its topic and text', () => {
  expect(checkCommand(row('save-flavor', { topic: 'Tests', text: 'Use Jest.' }), world)).toMatchObject({ cmd: { action: 'save-flavor' } })
  expect(checkCommand(row('save-flavor', { id: 'a1', topic: 'Tests', text: 'Use Jest.' }), world)).toMatchObject({ cmd: { action: 'save-flavor' } })
  expect(checkCommand(row('save-flavor', { topic: 'Tests' }), world)).toEqual({ error: 'Missing: text' })
  expect(checkCommand(row('accept-flavor', { id: 'a1' }), world)).toMatchObject({ cmd: { action: 'accept-flavor' } })
  expect(checkCommand(row('remove-flavor', { id: 'a1', text: 'x' }), world)).toEqual({ error: 'Unexpected argument: text' })
  expect(checkCommand(row('accept-all-flavors', {}), world)).toMatchObject({ cmd: { action: 'accept-all-flavors' } })
  expect(checkCommand(row('accept-all-flavors', { id: 'a1' }), world)).toEqual({ error: 'Unexpected argument: id' })
})
test('a flavor is one document with its full text, a proposed change carries the text it is about, and no folder gives no document', async () => {
  const disk: Record<string, string> = {
    '/h/.claude/zeremai/flavors/index.json': JSON.stringify({ flavors: [{ id: 'a1' }, { id: 'b2' }, { id: '../x' }, { id: 'gone' }] }),
    '/h/.claude/zeremai/flavors/a1.json': JSON.stringify({ id: 'a1', topic: 'Tests', text: 'Use Jest, not Vitest.', status: 'active', source: 'user', updatedAt: 'T' }),
    '/h/.claude/zeremai/flavors/b2.json': JSON.stringify({ id: 'b2', topic: 'Tests', text: 'Vitest is fine.', status: 'pending', source: 'learned', change: 'update', targetId: 'a1', fromFlow: 'P', evidence: 'vitest is fine here', updatedAt: 'T' }),
  }
  const files = { home: async () => '/h', list: async () => [], exists: async () => true, read: async (path: string) => disk[path] ?? Promise.reject(new Error('no file')) }
  const docs = await flavorDocs(files)
  expect(docs.map(d => [d.collection, d.doc_id])).toEqual([['flavors', 'a1'], ['flavors', 'b2']])
  expect(docs[0].data).toEqual({ topic: 'Tests', text: 'Use Jest, not Vitest.', status: 'active', source: 'user', updatedAt: 'T' })
  expect(docs[1].data).toMatchObject({ status: 'pending', change: 'update', targetId: 'a1', targetText: 'Use Jest, not Vitest.', fromFlow: 'P', evidence: 'vitest is fine here' })
  expect(await flavorDocs({ ...files, read: async () => Promise.reject(new Error('no folder')) })).toEqual([])
})
