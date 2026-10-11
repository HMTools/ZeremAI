import type { FileSystem, ManagerPorts } from '../infra/ports/ports'
import type { PaneGate } from '../infra/approval-gate/approval-gate'
import type { Started, boundView, stepDetail } from '../infra/flow-pane/flow-pane'
import type { TemplateInfo } from '../infra/flow-pane/flow-pane'
import type { TemplatePorts } from '../infra/templates/templates'
import type { richKit } from './rich-ui'
import type { readViews } from './on-flow-pane'

// What a screen gets from the pane: the element makers, the small drawing helpers, and a few closures over `$`.
// A screen never receives `$` itself: mods cannot share a function that takes `$` across files.
export interface Ctx {
  e: any
  Box: any; Text: any; Button: any; Input: any; Svg: any; Client: any
  line: (text: string, props?: Record<string, unknown>) => unknown
  narrow: boolean
  rich: boolean
  picture: (source: string, alt: string, width: number, height: number) => unknown
  k: ReturnType<typeof richKit> | undefined
  toggle: (key: string, label: string, active: boolean, onPress: () => void) => unknown
  tabRow: (buttons: unknown[], right?: unknown[]) => unknown
  nav: (key: string, label: string, onPress: () => void) => unknown
  card: (key: string, children: unknown[], hot?: boolean) => unknown
  redraw: () => void
  cwd: string
  bound: Awaited<ReturnType<typeof boundView>> | undefined
  detail: Awaited<ReturnType<typeof stepDetail>> | undefined
  views: Awaited<ReturnType<typeof readViews>> | undefined
  files: FileSystem
  ports: () => ManagerPorts
  store: { set(key: string, value: unknown): unknown }
  templateJob: (job: (ports: TemplatePorts) => Promise<string | void>, busy?: string) => Promise<void>
  fill: (template: TemplateInfo, purpose: string, text: string) => Promise<void> // Claude fills the Start form from the text
  handOff: (started: Started, toast?: string) => Promise<void> // `toast` shows before the pane closes
  openInViewer: (path: string, surface: string) => Promise<string>
  refresh: () => Promise<void>
  gate: PaneGate | undefined // the approval step of the bound flow, and whether the pane can answer it
  approve: (stepId: string) => Promise<void>
  requestChanges: (stepId: string, reason: string) => Promise<void>
  close: () => Promise<void> // the session lets go of the bound flow
  resume: (dir: string, note?: string) => Promise<void> // bind the flow again and hand it to the agent, with one extra line
}
