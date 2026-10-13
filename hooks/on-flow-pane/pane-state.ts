import type { FlowInfo, TemplateInfo } from '../infra/flow-pane/flow-pane'
import type { CatalogEntry, MarketplaceFields, MarketplaceInfo } from '../infra/templates/templates'

export const PANE = 'flow-pane'
export const COMMANDS = ['zeremai', 'zeremai:zeremai']
export const TABS = ['new', 'continue', 'templates'] as const
export const REFRESH_MS = 5000

// The pane keeps what it shows in this one object: a reload of the mod starts it again from the command.
export const st = {
  tab: 'new' as (typeof TABS)[number],
  view: 'list' as 'list' | 'flow', // flow: the pane shows the one flow bound to the session
  boundDir: undefined as string | undefined,
  shown: undefined as string | undefined, // the flow the pane draws: the bound one, or a sub-flow or the parent the user opened
  openStep: undefined as string | undefined, // the step whose detail shows, if any
  detailTabs: {} as Record<string, 'definition' | 'execution'>, // the tab of the step detail, remembered for each step
  problemsOnly: false, // Logs: only the steps that reported a problem
  openValues: new Set<string>(), // Memory: the long values that show in full
  favorites: new Set<string>(), // starred templates (`category/name`), kept in the store as `favorites`
  query: '', // the search words of the New tab
  look: 1, // how much color Desktop draws: 0 none, 1 cards and group titles, 2 + the ground, 3 + colored buttons and chips, 4 + the ground fills the height
  showMissing: false, // the folded group of templates you do not have is open
  category: undefined as string | undefined, // the chip: a category, the favorites, or all
  section: 'steps' as 'steps' | 'memory' | 'logs' | 'files', // the tab of the bound flow
  memTab: 'flow' as 'flow' | 'topics' | 'history' | 'diffs',
  openTopic: undefined as string | undefined,
  showFramework: false,
  graphOn: false, // Desktop: draw the steps as a graph (a Client, behind the Graph button) or as the timeline (default, with SVG nodes)
  allFolders: false, // Continue shows every folder; kept in the store as `allFolders`
  loaded: false,
  timer: undefined as { cancel(): void } | undefined,
  seen: new Set<string>(), // the flows that needed the user at the last look: a new one raises a toast
  primed: false,
  lastPrint: undefined as string | undefined, // the fingerprint of the flow list at the last redraw
  lastViewPrint: '', // the same for what the open bound view reads
  debugClicks: false, // /zeremai debug: a toast for each press and focus move
  lastDraw: Date.now(),
  entries: [] as CatalogEntry[],
  markets: [] as MarketplaceInfo[],
  form: undefined as { original?: string; values: MarketplaceFields } | undefined, // the Add or Edit form of a marketplace
  sure: undefined as string | undefined, // the marketplace whose Remove was pressed once
  templates: [] as TemplateInfo[],
  flows: [] as FlowInfo[],
  chosen: undefined as TemplateInfo | undefined,
  purposeOpen: false, // the Start form shows the whole purpose
  values: {} as Record<string, string>,
  describe: '', // the free text of the Start form: Claude fills the fields from it
  filled: new Set<string>(), // fields Claude filled, marked until the user edits them
  offers: {} as Record<string, string>, // typed fields Claude would change: Replace or Keep
  openFields: [] as string[], // fields Claude left empty because the text does not cover them
  message: '',
  sourceErrors: {} as Record<string, string>, // the last refresh error of each marketplace
  filter: 'all' as 'all' | 'needs' | 'running' | 'done' | 'failed', // the chip of the Continue list
  kind: 'info' as NoticeKind, // how the strip at the top draws the message
  at: 0, // the tick of the timer when the message was set: it clears after two ticks (5 to 10 seconds)
  ticks: 0,
  sureAt: 0, // the tick when the first Remove or Delete press was made: it is taken back at the next tick
  busy: undefined as string | undefined, // the key of the template job that runs now
  changing: false, // the gate card asks for the reason of a change request
  reason: '', // what the user typed there
  firstArg: '', // the text typed after the command: goes into the first field of the template that gets picked
}

// A new form starts with no text, marks or offers.
export function resetFill(): void {
  st.describe = ''
  st.filled = new Set()
  st.offers = {}
  st.openFields = []
}

export type NoticeKind = 'info' | 'success' | 'error'
// Say something in the strip at the top of the pane. An empty text clears it.
export function say(kind: NoticeKind, text: string): void {
  st.message = text
  st.kind = kind
  st.at = st.ticks
}
// The first press of a two-press button (Delete, Remove). The timer takes it back.
export function askAgain(what: string): void {
  st.sure = what
  st.sureAt = st.ticks
}

// Keep what a refresh said about each marketplace: a line "name: ... failed (why)" is an error, any other line clears it.
export function noteRefresh(lines: string[]): void {
  for (const line of lines) {
    const at = line.indexOf(': ')
    if (at < 0) continue
    const name = line.slice(0, at), what = line.slice(at + 2)
    if (/failed/.test(what)) st.sourceErrors[name] = what
    else delete st.sourceErrors[name]
  }
}
