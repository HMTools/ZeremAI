import { test, expect } from 'claude-code/testing'
import { world } from '../flow-manager/fake-world'
import { FAVORITES, groupRows, lastUsedNames, matches, mergeTemplates, templateDetail } from './template-views'
import type { TemplateInfo } from './flow-pane'
import type { CatalogEntry } from '../templates/templates'

const info = (category: string, name: string): TemplateInfo => ({ path: `/t/${category}/${name}/${name}.json`, name, category, title: name, purpose: `purpose of ${name}`, stepCount: 3, fields: [] })
const entry = (category: string, name: string, state: CatalogEntry['state']): CatalogEntry => ({ marketplace: 'm', category, name, title: `Title ${name}`, description: `about ${name}`, state })

test('one list: the catalog with its states, plus installed templates the catalog does not know', () => {
  const rows = mergeTemplates([info('dev', 'bug'), info('dev', 'local')], [entry('dev', 'bug', 'update'), entry('dev', 'feature', 'available'), entry('infra', 'x', 'installed')])
  const by = Object.fromEntries(rows.map(r => [r.key, r]))
  expect(by['dev/bug']).toMatchObject({ state: 'update', title: 'Title bug' })
  expect(by['dev/bug'].template).toBeDefined() // Start needs the installed template
  expect(by['dev/local'].state).toBe('installed')
  expect(by['dev/local'].entry).toBeUndefined()
  expect(by['dev/feature'].state).toBe('available')
  expect(by['dev/feature'].template).toBeUndefined()
  expect(by['infra/x'].state).toBe('available') // the catalog says installed, the folder has no template: not startable
})

test('search needs every word; a category or Favorites narrows; favorites go first', () => {
  const rows = mergeTemplates([info('dev', 'bug'), info('dev', 'feature'), info('infra', 'set-concept')], [])
  const favs = new Set(['infra/set-concept'])
  expect(matches(rows, '', undefined, favs).map(r => r.key)).toEqual(['infra/set-concept', 'dev/bug', 'dev/feature'])
  expect(matches(rows, 'purpose bug', undefined, favs).map(r => r.key)).toEqual(['dev/bug'])
  expect(matches(rows, '', 'dev', favs).map(r => r.key)).toEqual(['dev/bug', 'dev/feature'])
  expect(matches(rows, '', FAVORITES, favs).map(r => r.key)).toEqual(['infra/set-concept'])
  expect(matches(rows, 'zzz', undefined, favs)).toEqual([])
})

test('template detail: purpose, parameters, steps from their step files, and the memory flow', async () => {
  const dir = '/t/dev/bug'
  const w = world({
    [`${dir}/bug.json`]: {
      type: 'template', name: 'bug', category: 'dev', metadata: { purposeAndUsage: 'Fix a bug.' },
      parameters: { required: ['workItemId'], optional: ['repo'], definitions: { workItemId: { description: 'the item', example: '7' }, repo: { description: { description: 'the repository' } } } },
      steps: [{ number: 1, name: 'Find', stepRef: 'r1' }, { number: 2, name: 'Fix', stepRef: 'r2', approvalRequired: true }, { name: 'Lost', stepRef: 'nope' }],
    },
    [`${dir}/find/find.json`]: { type: 'step', id: 'r1', output: { description: 'a cause' }, memoryFileUsage: { writeTo: ['cause.json'] } },
    [`${dir}/fix/fix.json`]: { type: 'step', id: 'r2', metadata: { purposeAndUsage: 'Change code.' }, guidance: { prerequisites: ['a cause'] }, bestPractices: ['small change'], substeps: [{ number: 1, name: 'Write' }], memoryFileUsage: { readFrom: ['cause'], writeTo: ['cause.json', 'patch'] } },
  })
  const d = (await templateDetail(w.ports.files, `${dir}/bug.json`))!
  expect(d).toMatchObject({ purpose: 'Fix a bug.', name: 'bug', category: 'dev' })
  expect(d.parameters).toEqual([
    { name: 'workItemId', required: true, description: 'the item', example: '7' },
    { name: 'repo', required: false, description: 'the repository', example: '' },
  ])
  expect(d.steps.map(s => [s.number, s.name, s.approval])).toEqual([[1, 'Find', false], [2, 'Fix', true], [3, 'Lost', false]])
  expect(d.steps[0]).toMatchObject({ output: 'a cause', writes: ['cause'] })
  expect(d.steps[1]).toMatchObject({ purpose: 'Change code.', guidance: ['a cause', 'small change'], substeps: ['1 Write'], reads: ['cause'] })
  expect(d.steps[2]).toMatchObject({ output: '', reads: [], writes: [] }) // a step file that is missing still shows its name
  expect(d.flow).toEqual({ topics: ['cause', 'patch'], cells: { cause: ['W', 'R/W', ''], patch: ['', 'W', ''] } })
  expect(await templateDetail(w.ports.files, '/t/gone.json')).toBeUndefined()
})

test('groups: favorites, then last used, then categories; a template shows once; missing ones go last', () => {
  const rows = mergeTemplates([info('dev', 'a'), info('dev', 'b'), info('dev', 'c'), info('ops', 'd')], [entry('ops', 'e', 'available')])
  const g = groupRows(rows, new Set(['dev/a']), ['b', 'dev/a', 'd', 'gone'], true)
  expect(g.favorites.map(r => r.key)).toEqual(['dev/a'])
  expect(g.last.map(r => r.key)).toEqual(['dev/b', 'ops/d'])
  expect(g.groups.map(x => [x.category, x.rows.map(r => r.name)])).toEqual([['dev', ['c']]])
  expect(g.missing.map(r => r.key)).toEqual(['ops/e'])
  expect(groupRows(rows, new Set(['dev/a']), ['b'], false).groups.map(x => x.rows.length)).toEqual([3, 1])
})

test('last used: the newest flow first, each template once', () => {
  expect(lastUsedNames([{ template: 'a', updatedMs: 1 }, { template: 'b', updatedMs: 9 }, { template: 'a', updatedMs: 5 }, { updatedMs: 99 }])).toEqual(['b', 'a'])
})
