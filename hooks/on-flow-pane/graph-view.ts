import type { ClientModule } from 'claude-code'

// The step graph of a bound flow, drawn on Claude Desktop inside a Client (see on-flow-pane). It runs on the drawing side and has no `$`:
// a press on a node posts { go: 'step', id } or { go: 'open', dir } to the pane's hooks. Drag moves the view, + and - change the size of the nodes.

export type GNode = { id: string; label: string; sub: string; symbol: string; color: string; hot?: boolean; go: 'step' | 'open'; target: string }
export type GRow = { step: GNode; active?: boolean; children: GNode[] }
export type GProps = { parent?: GNode; rows: GRow[] }
export type Placed = { node: GNode; x: number; y: number; w: number; h: number; active?: boolean }
export type Edge = { x: number; y: number; kind: 'down' | 'right'; len: number }

// zoom 1: a box of 4 rows for each step. zoom 0: one row, no border, for a long flow.
const SIZE = [{ w: 30, h: 1, gap: 1, side: 4, childW: 22 }, { w: 34, h: 4, gap: 2, side: 6, childW: 26 }]

// Where each node and each connector sits in graph cells, with the size of the whole graph.
export function layout(props: GProps, zoom: 0 | 1): { nodes: Placed[]; edges: Edge[]; width: number; height: number } {
  const s = SIZE[zoom], nodes: Placed[] = [], edges: Edge[] = []
  let y = 0
  const down = (from: number) => edges.push({ x: Math.floor(s.w / 2), y: from, kind: 'down', len: s.gap })
  if (props.parent) { nodes.push({ node: props.parent, x: 0, y, w: s.w, h: s.h }); down(y + s.h); y += s.h + s.gap }
  props.rows.forEach((row, i) => {
    nodes.push({ node: row.step, x: 0, y, w: s.w, h: s.h, active: row.active })
    row.children.forEach((c, n) => {
      const cy = y + n * (s.h + 1)
      nodes.push({ node: c, x: s.w + s.side, y: cy, w: s.childW, h: s.h })
      edges.push({ x: s.w, y: cy + Math.floor(s.h / 2), kind: 'right', len: s.side })
    })
    const taken = Math.max(s.h, row.children.length * (s.h + 1) - 1)
    if (i < props.rows.length - 1) down(y + s.h)
    y += taken + s.gap
  })
  return { nodes, edges, width: s.w + s.side + s.childW, height: Math.max(0, y - s.gap) }
}

export const hit = (placed: Placed[], x: number, y: number): Placed | undefined => placed.find(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h)

type View = { ox: number; oy: number; zoom: 0 | 1; hover?: string }

const Graph: ClientModule<GProps, View> = (props, surface) => {
  const { Box, Text } = surface.elements
  // Desktop reports a small region size, and a percent height resolves to one row there: the root gets a fixed row count.
  const cols = surface.columns > 20 ? surface.columns : 80, rows = surface.rows > 4 ? surface.rows : 22
  const zoom = surface.state?.zoom ?? 1
  const map = layout(props, zoom)
  const active = map.nodes.find(p => p.active)
  // Start with the active step in the middle, until the user moves the view.
  const view: View = surface.state ?? { ox: 0, oy: Math.max(0, (active ? active.y : 0) - Math.floor(rows / 2)), zoom }
  const clamp = (v: View): View => ({ ...v, ox: Math.max(0, Math.min(v.ox, Math.max(0, map.width - cols))), oy: Math.max(0, Math.min(v.oy, Math.max(0, map.height - rows))) })
  const set = (next: Partial<View>) => surface.setState(clamp({ ...(surface.state ?? view), ...next }))

  let drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | undefined
  surface.onPointer(e => {
    const now = surface.state ?? view
    if (e.type === 'down') drag = { x: e.x, y: e.y, ox: now.ox, oy: now.oy, moved: false }
    else if (e.type === 'move' && drag) {
      if (e.x !== drag.x || e.y !== drag.y) drag.moved = true
      set({ ox: drag.ox - (e.x - drag.x), oy: drag.oy - (e.y - drag.y) })
    } else if (e.type === 'move') {
      const over = hit(map.nodes, e.x + now.ox, e.y + now.oy)?.node.id
      if (over !== now.hover) set({ hover: over })
    } else if (e.type === 'up' && drag) {
      const was = drag
      drag = undefined
      const p = !was.moved ? hit(map.nodes, e.x + now.ox, e.y + now.oy) : undefined
      if (p) surface.post({ go: p.node.go, [p.node.go === 'step' ? 'id' : 'dir']: p.node.target })
    } else if (e.type === 'leave' && now.hover) set({ hover: undefined })
  })
  surface.onKey(e => {
    const now = surface.state ?? view
    if (e.key === '+' || e.key === '=') set({ zoom: 1 })
    else if (e.key === '-') set({ zoom: 0 })
    else if (e.key === 'up') set({ oy: now.oy - 2 })
    else if (e.key === 'down') set({ oy: now.oy + 2 })
    else if (e.key === 'left') set({ ox: now.ox - 4 })
    else if (e.key === 'right') set({ ox: now.ox + 4 })
    else if (e.key === 'home') set({ ox: 0, oy: 0 })
  })

  const at = (x: number, y: number) => ({ position: 'absolute' as const, left: x - view.ox, top: y - view.oy })
  const edges = map.edges.map((edge, i) => edge.kind === 'down'
    ? Box({ key: `e${i}`, ...at(edge.x, edge.y), flexDirection: 'column', children: [...Array(Math.max(0, edge.len - 1))].map(() => Text({ dimColor: true, children: ['│'] })).concat(Text({ dimColor: true, children: ['▼'] })) })
    : Box({ key: `e${i}`, ...at(edge.x, edge.y), children: [Text({ dimColor: true, children: ['─'.repeat(Math.max(0, edge.len - 1)) + '▶'] })] }))
  const boxes = map.nodes.map(p => {
    const over = view.hover === p.node.id
    const head = Text({ color: p.node.color, bold: !!p.active, wrap: 'truncate', children: [`${p.node.symbol} ${p.node.label}`] })
    if (zoom === 0) return Box({ key: `n${p.node.id}`, ...at(p.x, p.y), width: p.w, height: 1, ...(over ? { backgroundColor: 'claude' } : {}), children: [head] })
    return Box({
      key: `n${p.node.id}`, ...at(p.x, p.y), width: p.w, height: p.h, flexDirection: 'column', paddingLeft: 1, paddingRight: 1,
      borderStyle: p.active ? 'double' : 'round', borderColor: over ? 'claude' : p.node.hot ? 'warning' : 'inactive',
      children: [head, Text({ dimColor: true, wrap: 'truncate', children: [p.node.sub] })],
    })
  })
  return Box({
    width: '100%', height: rows, overflow: 'hidden', flexDirection: 'column',
    children: [...edges, ...boxes, Box({ ...{ position: 'absolute' as const, left: 0, bottom: 0 }, children: [Text({ dimColor: true, children: ['drag to move · + − size · press a step'] })] })],
  })
}

export default Graph
