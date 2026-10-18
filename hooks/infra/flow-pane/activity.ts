import type { Kind } from './status-look'

// How long ago a running flow wrote its log. A long tool call writes no log, so the words say "no log", never "stalled".
// Only a running flow gets a note: a flow that waits for the user or is paused has nothing to write.
export const NO_LOG_MINUTES = 10

// A run with no log for this long shows IDLE on its card. The state in the file stays "running".
export const IDLE_MINUTES = 24 * 60
export const isIdle = (kind: Kind, lastLogMs: number | undefined, now: number) => kind === 'running' && lastLogMs !== undefined && now - lastLogMs >= IDLE_MINUTES * 60_000

// "5 min", "3 h", "12 days": a span, for "no log for ...".
export function span(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

export type Activity = { text: string; quiet: boolean }

export function activityOf(kind: Kind, lastLogMs: number | undefined, now: number): Activity | undefined {
  if (kind !== 'running' || lastLogMs === undefined) return undefined
  const minutes = Math.max(0, Math.floor((now - lastLogMs) / 60_000))
  if (minutes >= NO_LOG_MINUTES) return { text: `no log for ${span(minutes)}`, quiet: true }
  return { text: minutes < 1 ? 'last log just now' : `last log ${minutes} min ago`, quiet: false }
}

// "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago": how long ago a flow changed.
export function ago(ms: number | undefined, now: number): string {
  if (ms === undefined) return ''
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
