import type { Register } from 'claude-code'
import { runsScript } from '../infra/flow-manager/script'
import { slash } from '../infra/flow-manager/move'
import { PAGE_CAPABILITIES, heartbeat, pushFlows } from '../infra/live-page/live-page'
import type { LivePorts } from '../infra/live-page/live-page'
import { COMMANDS } from '../on-flow-pane/pane-state'

// /zeremai live publishes the live flow page once and keeps its link. From then on the mod writes the state of every active flow to the page's
// database: after each flow script command, every 5 seconds (a flow can change outside this session), and a heartbeat every 30 seconds.
// With no link stored, nothing here does anything. A failed write never touches the flow: the reason is kept in the store as `livePageError`.
// The page only reads: there is no way back from the page to a flow.

const URL_KEY = 'livePageUrl'
const ERR_KEY = 'livePageError'
const TIP_KEY = 'livePageTipped'
const PUSH_MS = 5000
const BEAT_EVERY = 6 // pushes: 6 × 5 s = 30 s

const last = new Map<string, string>() // the text of each document at the last push
let timer: { cancel(): void } | undefined
let ticks = 0
let busy = false
let hadError = false

// ArtifactData and Artifact are deferred tools: a call before they are loaded fails, so load them once with ToolSearch and call again.
async function call($: any, input: Record<string, unknown>): Promise<any> {
  const run = () => $.tool.call(input)
  const result = await run().catch(async (error: unknown) => {
    if (!/no tool named/.test(String((error as Error)?.message))) throw error
    await $.tool.call({ tool: 'ToolSearch', query: 'select:Artifact,ArtifactData', max_results: 2 })
    return run()
  })
  if (result.deny || result.isError) throw new Error(String(result.deny ?? result.text ?? 'the tool failed'))
  return result
}

const portsOf = ($: any, url: string): LivePorts => ({
  files: {
    home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')),
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
  },
  batch: async writes => { await call($, { tool: 'ArtifactData', action: 'batch', url, writes }) },
  now: () => new Date().toISOString(),
})

async function push($: any, beat = false): Promise<void> {
  const url = (await $.store.get(URL_KEY)) as string | undefined
  if (!url || busy) return
  busy = true
  try {
    const ports = portsOf($, url)
    await pushFlows(ports, last)
    if (beat) await heartbeat(ports)
    if (hadError) { hadError = false; await $.store.delete(ERR_KEY) }
  } catch (error) {
    hadError = true
    await $.store.set(ERR_KEY, error instanceof Error ? error.message : String(error)).catch(() => {})
  }
  busy = false
}

// One timer for the mod. A mod has no file watcher, and `session.start` and `prompt.submit` are taken (see on-flow-tools, on-user-prompt), so it starts at the first flow command or /zeremai live.
async function ensureTimer($: any): Promise<void> {
  if (timer || !(await $.store.get(URL_KEY))) return
  try { timer = $.clock.every(PUSH_MS, () => push($, ++ticks % BEAT_EVERY === 0)) } catch { return /* no timer: flow commands still push */ }
  await push($, true)
}

// The page file ships in skills/live-flow. If the Artifact tool refuses a path outside the project, a copy in the project folder goes instead.
async function publish($: any): Promise<string> {
  const page = `${slash($.plugin.root)}/skills/live-flow/page.html`
  if (!(await $.fs.exists(page))) throw new Error('skills/live-flow/page.html is missing from the plugin')
  const input = (file_path: string) => ({ tool: 'Artifact', file_path, icon: 'flow', description: 'Every flow and its steps, live.', capabilities: PAGE_CAPABILITIES, pin: true })
  const result = await call($, input(page)).catch(async () => {
    const copy = `${slash(await $.session.cwd())}/.claude/zeremai-live-page.html`
    await $.fs.write(copy, await $.fs.read(page))
    return call($, input(copy))
  })
  const link = String(result.text ?? '').match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/)?.[0]
  if (!link) throw new Error(`published, but no link in the answer: ${String(result.text ?? '').slice(0, 200)}`)
  return link
}

// The Artifact tool shows the page in the surface the user works in. A surface that cannot (print mode, no tool) refuses: the link is in the answer anyway.
async function openPage($: any, url: string): Promise<boolean> {
  try { await call($, { tool: 'Artifact', action: 'open', url }); return true } catch { return false }
}

// One message, once, when the first flow starts and the page does not exist yet.
async function tip($: any): Promise<void> {
  if ((await $.store.get(URL_KEY)) || (await $.store.get(TIP_KEY))) return
  await $.store.set(TIP_KEY, true)
  try { await $.ui.toast('A live page shows all your flows. Run /zeremai live.') } catch { /* a surface with no toast */ }
}

const createdFlow = (command: string, result: any): boolean => {
  if (!/\bcreate-flow\b/.test(command)) return false
  try { return JSON.parse(String(result?.result?.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '').status === 'ok' } catch { return false }
}

export const register: Register = on => {
  // The script has run when `next` answers, whichever hook sits above or beneath this one.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (runsScript((e as any).command)) {
      await ensureTimer($); await push($)
      if (createdFlow((e as any).command, result)) await tip($)
    }
    return result
  })

  // A second line under the band of on-flow-pane: one button, once a link is stored. What the hooks beneath draw stays.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const url = (await $.store.get(URL_KEY)) as string | undefined
    const theirs = await next(e).catch(() => undefined)
    if (!url) return theirs
    const { Box, Button } = $.ui.resolve(e)
    return Box({ flexDirection: 'column', children: [...(theirs ? [theirs] : []), Button({ key: 'band-live', plain: true, onPress: () => void openPage($, url), children: ['Live page ↗'] })] })
  })

  // on-flow-pane answers every other word of /zeremai and passes "live" on.
  on('command.run', { command: COMMANDS }, async ($, e, next) => {
    if (String(e.args ?? '').trim().split(/\s+/)[0]?.toLowerCase() !== 'live') return next(e)
    try {
      let url = (await $.store.get(URL_KEY)) as string | undefined
      if (!url) { url = await publish($); await $.store.set(URL_KEY, url); last.clear() }
      await ensureTimer($)
      await push($, true)
      const opened = await openPage($, url)
      const problem = (await $.store.get(ERR_KEY)) as string | undefined
      return { text: `Live page ${opened ? 'opened' : 'link'}: ${url}${problem ? `\nThe last write failed: ${problem}` : ''}` } as never
    } catch (error) {
      return { text: `Could not set up the live page: ${error instanceof Error ? error.message : String(error)}` } as never
    }
  })
}
