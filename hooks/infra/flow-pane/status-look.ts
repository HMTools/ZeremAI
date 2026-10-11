// How a flow or a step looks in the pane: a symbol, an ASCII twin, a word and a theme color. A symbol and a word
// always go together, so color is never the only signal. The theme keys follow the user's theme (dark or light).

export type Kind = 'waiting' | 'running' | 'done' | 'failed' | 'paused' | 'pending'

export const LOOK: Record<Kind, { symbol: string; ascii: string; word: string; color: string }> = {
  waiting: { symbol: '▲', ascii: '!', word: 'waits for you', color: 'warning' },
  running: { symbol: '●', ascii: '*', word: 'running', color: 'success' },
  done: { symbol: '✓', ascii: 'v', word: 'done', color: 'inactive' },
  failed: { symbol: '✕', ascii: 'x', word: 'failed', color: 'error' },
  paused: { symbol: '‖', ascii: '=', word: 'paused', color: 'permission' },
  pending: { symbol: '○', ascii: 'o', word: 'pending', color: 'inactive' },
}

export const symbolOf = (kind: Kind, ascii: boolean) => (ascii ? LOOK[kind].ascii : LOOK[kind].symbol)

// A step status in the flow files, as a Kind.
export function stepKind(status: string | undefined): Kind {
  if (status === 'completed' || status === 'skipped') return 'done'
  if (status === 'awaiting_approval') return 'waiting'
  if (status === 'in_progress') return 'running'
  if (status === 'failed') return 'failed'
  return 'pending'
}

// These need the user.
export const needsUser = (kind: Kind) => kind === 'waiting' || kind === 'failed' || kind === 'paused'
