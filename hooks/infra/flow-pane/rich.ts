import type { Kind } from './status-look'

// The rich look of Claude Desktop: small SVG pictures the pane draws with `Svg` (isInteractive, so the pulse animation runs).
// An Svg takes no press, so every picture sits beside a real Button. The terminal never calls these.

export const HEX: Record<Kind, string> = { waiting: '#f2b13d', running: '#3ecf8e', done: '#5aa88a', failed: '#ef6a5e', paused: '#a58bff', pending: '#6b7280' }
// The colors of the pane on Desktop, in one place. Raw colors: a surface that does not know one draws its own, so a fill can fall back to the old look.
export const PALETTE = {
  ground: '#181c27', neutral: '#d5d9e6', card: '#222839', border: '#333b52', go: '#d97757', slate: '#3b4666', favorites: '#f2b13d', last: '#6ea8ff',
  categories: ['#4fd1c5', '#a58bff', '#f472b6', '#7bd88f', '#f59e6c', '#8fa8ff'],
}
// The theme words the terminal uses for the same six, in the same order.
export const CATEGORY_KEYS = ['success', 'remember', 'permission', 'claude', 'merged', 'planMode'] as const
// A category has the same color after every reload: its place among the sorted names.
export const categoryIndex = (name: string, all: string[]): number => Math.max(0, [...new Set(all)].sort().indexOf(name)) % PALETTE.categories.length
const MUTED = '#2a2f3a', TEXT = '#c9cedb'

export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="-apple-system,Segoe UI,sans-serif">${body}</svg>`
// A state that wants the user, or that is running, pulses.
const pulse = (cx: number, cy: number, r: number, color: string) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2"><animate attributeName="r" values="${r};${r + 6};${r}" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0;0.7" dur="1.8s" repeatCount="indefinite"/></circle>`

// One row of the step timeline: the line above and below, and the node. A done step has a check, a failed step a cross.
export function nodeSegment(kind: Kind, o: { first?: boolean; last?: boolean; height?: number } = {}): string {
  const h = o.height ?? 24, c = HEX[kind], cx = 12, cy = Math.round(h / 2)
  const line = (y1: number, y2: number, color: string) => `<line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2}" stroke="${color}" stroke-width="2"/>`
  const upper = o.first ? '' : line(0, cy - 8, kind === 'pending' ? MUTED : HEX.done)
  const lower = o.last ? '' : line(cy + 8, h, kind === 'done' ? HEX.done : MUTED)
  const mark = kind === 'done' ? `<path d="M${cx - 3.5} ${cy}l2.5 2.8 4.5-5" fill="none" stroke="#07130d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    : kind === 'failed' ? `<path d="M${cx - 3} ${cy - 3}l6 6m0-6l-6 6" stroke="#240a07" stroke-width="2" stroke-linecap="round"/>`
    : kind === 'paused' ? `<path d="M${cx - 2.5} ${cy - 3.5}v7m5-7v7" stroke="#1a1030" stroke-width="2" stroke-linecap="round"/>`
    : kind === 'waiting' ? `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#241800">!</text>`
    : kind === 'running' ? `<circle cx="${cx}" cy="${cy}" r="3" fill="#07130d"/>` : ''
  const solid = kind !== 'pending'
  return svg(24, h, `${upper}${lower}${kind === 'waiting' || kind === 'running' ? pulse(cx, cy, 8, c) : ''}<circle cx="${cx}" cy="${cy}" r="8" fill="${solid ? c : '#14161c'}" stroke="${c}" stroke-width="2"/>${mark}`)
}

// A bar of one tick for each step (a thin bar over 24 steps). Done ticks are green, the active tick has the state color.
export function progressBar(done: number, total: number, kind: Kind, width = 240): string {
  const n = Math.max(1, total), gap = n > 24 ? 0 : 3, w = (width - gap * (n - 1)) / n, c = HEX[kind]
  const ticks = [...Array(n)].map((_, i) => {
    const fill = i < done ? HEX.done : i === done && kind !== 'done' ? c : MUTED
    const live = i === done && (kind === 'waiting' || kind === 'running')
    return `<rect x="${(i * (w + gap)).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="8" rx="${Math.min(4, w / 2).toFixed(1)}" fill="${fill}">${live ? '<animate attributeName="opacity" values="1;0.45;1" dur="1.8s" repeatCount="indefinite"/>' : ''}</rect>`
  }).join('')
  return svg(width, 8, ticks)
}

// The ring in the header: the step the flow is at, out of all steps.
export function ring(step: number, total: number, kind: Kind): string {
  const r = 18, len = 2 * Math.PI * r, share = kind === 'done' ? 1 : Math.max(0, Math.min(1, (step - 1) / Math.max(1, total)))
  const c = HEX[kind]
  return svg(44, 44, `<circle cx="22" cy="22" r="${r}" fill="none" stroke="${MUTED}" stroke-width="4"/>`
    + `<circle cx="22" cy="22" r="${r}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(len * share).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 22 22)"/>`
    + `<text x="22" y="26" text-anchor="middle" font-size="11" font-weight="700" fill="${TEXT}">${esc(kind === 'done' ? '✓' : `${step}/${total}`)}</text>`)
}

const ACCESS_HEX = { R: '#6ea8ff', W: '#3ecf8e', 'R/W': '#b79cff' } as const
// The memory flow of a template: one row for each topic, one column for each step, a colored badge where the step reads or writes.
export function flowGrid(topics: string[], cells: Record<string, ('R' | 'W' | 'R/W' | '')[]>, steps: number[]): string {
  const left = 150, col = 44, row = 28, width = left + col * steps.length + 4, height = 26 + row * topics.length
  const head = steps.map((n, i) => `<text x="${left + i * col + col / 2}" y="16" text-anchor="middle" font-size="11" fill="#8b93a5">${n}</text>`).join('')
  const body = topics.map((t, r) => {
    const y = 26 + r * row
    const badges = (cells[t] ?? []).map((a, i) => a ? `<rect x="${left + i * col + 6}" y="${y + 3}" width="${col - 12}" height="20" rx="6" fill="${ACCESS_HEX[a]}" fill-opacity="0.18" stroke="${ACCESS_HEX[a]}" stroke-opacity="0.6"/><text x="${left + i * col + col / 2}" y="${y + 17}" text-anchor="middle" font-size="11" font-weight="700" fill="${ACCESS_HEX[a]}">${a}</text>` : `<text x="${left + i * col + col / 2}" y="${y + 17}" text-anchor="middle" font-size="12" fill="#4a5060">·</text>`).join('')
    return `<text x="0" y="${y + 17}" font-size="12" fill="${TEXT}">${esc(t.length > 20 ? `${t.slice(0, 19)}…` : t)}<title>${esc(t)}</title></text>${badges}`
  }).join('')
  return svg(width, height, head + body)
}

// A status word as a soft pill: a tinted fill, a thin border, a dot and the word. Mid-tone colors read in both themes.
export function softPill(word: string, hex: string): { source: string; width: number; height: number } {
  const w = Math.round(word.length * 6.6 + 30), h = 20
  return {
    width: w, height: h,
    source: svg(w, h, `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${hex}" fill-opacity="0.16" stroke="${hex}" stroke-opacity="0.5"/>`
      + `<circle cx="11" cy="10" r="3" fill="${hex}"/><text x="19" y="14" font-size="11" font-weight="700" fill="${hex}">${esc(word)}</text>`),
  }
}

// The flow name in the header: larger and bolder than the app font allows. Its color follows the system scheme.
export function titleText(name: string): { source: string; width: number; height: number } {
  const w = Math.round(name.length * 9.6 + 6), h = 26
  return {
    width: w, height: h,
    source: svg(w, h, `<style>text{fill:#2a2f3a}@media (prefers-color-scheme:dark){text{fill:#e6e9f0}}</style><text x="2" y="19" font-size="18" font-weight="700">${esc(name)}</text>`),
  }
}
