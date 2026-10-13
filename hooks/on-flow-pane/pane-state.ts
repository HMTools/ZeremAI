import type { FlowInfo } from '../infra/flow-pane/flow-pane'

export const COMMANDS = ['zeremai', 'zeremai:zeremai']
export const REFRESH_MS = 5000

// What the band keeps between two timer ticks: a reload of the mod starts it again from the first draw.
export const st = {
  boundDir: undefined as string | undefined,
  flows: [] as FlowInfo[],
  timer: undefined as { cancel(): void } | undefined,
  seen: new Set<string>(), // the flows that needed the user at the last look: a new one raises a toast
  primed: false,
  lastPrint: undefined as string | undefined, // the fingerprint of the flow list at the last redraw
}
