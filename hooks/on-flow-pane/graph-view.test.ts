import { test, expect } from 'claude-code/testing'
import { hit, layout } from './graph-view'
import type { GNode, GProps } from './graph-view'

const n = (id: string, go: GNode['go'] = 'step'): GNode => ({ id, label: id, sub: '', symbol: '●', color: 'success', go, target: id })
const props: GProps = {
  parent: n('up', 'open'),
  rows: [{ step: n('a'), children: [n('a-0', 'open')] }, { step: n('b'), active: true, children: [] }, { step: n('c'), children: [] }],
}

test('the graph puts the parent first, steps in a column, and a sub-flow to the right of its step', () => {
  const g = layout(props, 1)
  const at = (id: string) => g.nodes.find(p => p.node.id === id)!
  expect(g.nodes.map(p => p.node.id)).toEqual(['up', 'a', 'a-0', 'b', 'c'])
  expect(at('up').y).toBeLessThan(at('a').y)
  expect(at('a').y).toBeLessThan(at('b').y)
  expect(at('a-0').y).toBe(at('a').y)
  expect(at('a-0').x).toBeGreaterThan(at('a').x + at('a').w)
  expect(g.edges.filter(e => e.kind === 'right')).toHaveLength(1)
  expect(g.edges.filter(e => e.kind === 'down')).toHaveLength(3) // parent to a, a to b, b to c
})

test('the small size takes one row for each step, so a long flow fits', () => {
  expect(layout(props, 0).height).toBeLessThan(layout(props, 1).height)
  expect(layout({ rows: [{ step: n('x'), children: [] }] }, 0).height).toBe(1)
})

test('a press finds the node under it, and nothing between nodes', () => {
  const g = layout(props, 1)
  const b = g.nodes.find(p => p.node.id === 'b')!
  expect(hit(g.nodes, b.x + 2, b.y + 1)?.node.id).toBe('b')
  expect(hit(g.nodes, b.x + 2, b.y + b.h)).toBeUndefined() // the gap under the node
})
