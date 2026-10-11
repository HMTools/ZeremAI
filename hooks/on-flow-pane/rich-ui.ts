import { HEX, PALETTE, softPill } from '../infra/flow-pane/rich'
import { LOOK } from '../infra/flow-pane/status-look'
import type { Kind } from '../infra/flow-pane/status-look'

// The Desktop look: cards, pills and chips made of the mod's own elements, so every part keeps its hover and press and follows the app theme.
// Colors are theme keys (success, warning, claude...), never fixed values. `inverse` swaps text and background, so a pill or an active chip is
// a block of the theme color in either theme. The terminal never calls this: it keeps its symbols and words (see on-flow-pane).

export function richKit({ Box, Text, Button, Svg }: any, look = 4) {
  // A status word as a soft pill picture (see rich.softPill). An Svg takes no press, so a pill never sits alone as a control.
  const pill = (text: string, hex: string) => { const p = softPill(text, hex); return Svg({ source: p.source, alt: text, width: p.width, height: p.height }) }
  const kindPill = (kind: Kind) => pill(LOOK[kind].word, HEX[kind])
  // A small label: done in green, the active one on a block, the rest dim.
  const chip = (text: string, tone: 'done' | 'active' | 'idle') =>
    Text({ children: [tone === 'active' ? ` ${text} ` : tone === 'done' ? `✓ ${text}` : text], ...(tone === 'active' ? { color: 'warning', inverse: true } : tone === 'done' ? { color: 'success' } : { dimColor: true }) })
  // A card: a round border. A waiting step has a warning border, the active one the accent color, a sub-flow a dashed border.
  // It has a lighter fill than the ground, and an optional colored edge at the left (a one-cell bar).
  const card = (key: string, children: unknown[], o: { hot?: boolean; active?: boolean; dashed?: boolean; edge?: string } = {}) => Box({
    key, flexDirection: 'column', borderStyle: o.dashed ? 'dashed' : 'round', borderColor: o.hot ? 'warning' : o.active ? 'claude' : look >= 1 ? PALETTE.border : 'inactive', ...(look >= 1 ? { backgroundColor: PALETTE.card } : {}),
    paddingLeft: look >= 1 && o.edge ? 0 : 1, paddingRight: 1, hover: { borderColor: 'claude' },
    children: look >= 1 && o.edge ? [Box({ flexDirection: 'row', children: [Box({ width: 1, backgroundColor: o.edge, children: [Text({ children: [' '] })] }), Box({ flexDirection: 'column', flexGrow: 1, paddingLeft: 1, children })] })] : children,
  })
  // A button drawn as a colored block: `go` is the one main action of a card, `slate` the others. It is a plain Button, so it keeps its press.
  const action = (key: string, label: string, onPress: () => void, tone: 'go' | 'slate' = 'slate') => look < 3
    ? Button({ key, label, variant: tone === 'go' ? 'primary' : 'secondary', onPress })
    : Button({ key, plain: true, onPress, children: [Text({ children: [` ${label} `], color: '#ffffff', backgroundColor: tone === 'go' ? PALETTE.go : PALETTE.slate, bold: tone === 'go' })] })
  // A filter chip: a dot in the group color and the name, a dim count; the open one is a block of the color. Look 0 keeps the plain button.
  // The neutral color (All) has no dot.
  const colorChip = (key: string, label: string, active: boolean, color: string, onPress: () => void, count?: number) => look < 1
    ? Button({ key, label: count == null ? label : `${label} ·${count}`, variant: active ? 'primary' : 'secondary', onPress })
    : Button({ key, plain: true, onPress, children: active
      ? [Text({ children: [` ${color === PALETTE.neutral ? '' : '● '}${label}${count == null ? '' : ` ${count}`} `], color: '#111111', backgroundColor: color, bold: true })]
      : [...(color === PALETTE.neutral ? [] : [Text({ children: ['● '], color })]), Text({ children: [label] }), ...(count == null ? [] : [Text({ children: [` ${count}`], dimColor: true })])] })
  const heading = (title: string, color: string) => (look >= 1 ? Text({ children: [`● ${title}`], color, bold: true }) : Text({ children: [title], bold: true, dimColor: true }))
  // The ground of the pane: the slate that replaces the black.
  const ground = (children: unknown[]) => look < 2 ? Box({ flexDirection: 'column', children }) : Box({ flexDirection: 'column', ...(look >= 4 ? { minHeight: '100%' } : {}), backgroundColor: PALETTE.ground, paddingLeft: 1, paddingRight: 1, paddingTop: 1, children })
  // A row of buttons with no frame: the open one is the primary button. `right` sits at the far end of the row.
  const segmented = (buttons: unknown[], right: unknown[] = []) => Box({ flexDirection: 'row', columnGap: 1, children: right.length ? [...buttons, Box({ flexGrow: 1, children: [Text({ children: [' '] })] }), ...right] : buttons })
  const tab = (key: string, label: string, active: boolean, onPress: () => void) => Button({ key, label, variant: active ? 'primary' : 'secondary', onPress })
  const stack = (children: unknown[]) => Box({ flexDirection: 'column', rowGap: 1, children })
  const wrap = (children: unknown[]) => Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, marginLeft: 3, children })
  return { pill, kindPill, chip, card, action, colorChip, heading, ground, segmented, tab, stack, wrap }
}
