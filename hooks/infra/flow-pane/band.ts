import { activityOf } from './activity'
import type { FlowInfo } from './flow-pane'
import { LOOK, symbolOf } from './status-look'
import type { Kind } from './status-look'

// The line above the prompt. It names the flow bound to the session, its step and its state, then counts the other flows
// that need the user, by kind. Each part has a tone: the pane draws it in a theme color, so a state is never color alone.

export type BandPart = { text: string; tone?: 'warning' | 'error' | 'permission' | 'success' | 'dim' }
export type Band = { parts: BandPart[]; text: string; hot: boolean }

const TONE: Record<Kind, BandPart['tone']> = { waiting: 'warning', failed: 'error', paused: 'permission', running: 'success', done: 'dim', pending: 'dim' }

// What the bound flow is doing, in the words the user acts on.
export const stateWord = (p: FlowInfo) =>
  p.kind === 'waiting' ? (p.waitStep ? `approve step ${p.waitStep}` : 'waits for you') : p.kind === 'running' ? 'running' : LOOK[p.kind].word

// "▲2 approve · ✕1 failed · ‖1 paused", without the kinds that have none.
export function kindCounts(flows: FlowInfo[]): BandPart[] {
  const word: Record<string, string> = { waiting: 'approve', failed: 'failed', paused: 'paused' }
  return (['waiting', 'failed', 'paused'] as const).flatMap(kind => {
    const n = flows.filter(p => p.kind === kind).length
    return n ? [{ text: `${symbolOf(kind, false)}${n} ${word[kind]}`, tone: TONE[kind] }] : []
  })
}

export function bandView(flows: FlowInfo[], boundDir: string | undefined, now: number): Band {
  const bound = boundDir ? flows.find(p => p.dir === boundDir) : undefined
  const parts: BandPart[] = []
  if (bound) {
    const activity = activityOf(bound.kind, bound.lastLogMs, now)
    parts.push({ text: `${symbolOf(bound.kind, false)} ${bound.name} · step ${bound.step}/${bound.total} · ${stateWord(bound)}${activity?.quiet ? ` · ${activity.text}` : ''}`, tone: TONE[bound.kind] })
  } else parts.push({ text: 'Flows', tone: undefined })
  const others = kindCounts(flows.filter(p => p !== bound))
  for (const part of others) parts.push({ text: ' · ', tone: 'dim' }, part)
  return { parts, text: parts.map(p => p.text).join(''), hot: flows.some(p => p.kind === 'waiting' || p.kind === 'failed' || p.kind === 'paused') }
}
