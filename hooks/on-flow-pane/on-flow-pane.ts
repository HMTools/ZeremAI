import type { Register } from 'claude-code'
import { findFlowDir, sessionKey } from '../infra/flow-repository/flow-repository'
import type { FileSystem, ManagerPorts } from '../infra/ports/ports'
import { urlKey } from '../infra/live-page/live-page'
import { fingerprint, listFlows, resumeFlow } from '../infra/flow-pane/flow-pane'
import { activityOf, ago } from '../infra/flow-pane/activity'
import { bandView } from '../infra/flow-pane/band'
import { LOOK, needsUser } from '../infra/flow-pane/status-look'
import { runScript, scriptNote } from '../infra/flow-manager/script'
import { slash } from '../infra/flow-manager/move'
import { stepLine } from '../infra/flow-pane/step-line'
import { startCountingAgain } from '../on-agent-stopping/on-agent-stopping'
import { COMMANDS, REFRESH_MS, st } from './pane-state'

// The line above the prompt: the flow bound to the session, its step and state, and the flows that need the user. One button: a press opens the ZeremAI
// site (the page that /zeremai:init publishes, see ../on-live-page). A timer keeps the line current, and raises a toast when a flow starts to need the user.

function filesOf($: any): FileSystem {
  return {
    home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
  }
}
function linksOf($: any): ManagerPorts['links'] {
  return {
    get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
    add: async (sessionId, dir) => {
      const dirs = ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? []
      await $.store.set(sessionKey(sessionId), [...dirs.filter(d => d !== dir), dir]) // the newest goes last, and answers first
    },
  }
}

// Continue: a blocked step runs again, and the flow goes back to the agent. The same as the site's Continue, built here because a mod cannot share a function that takes `$` across files.
function managerPorts($: any): ManagerPorts {
  return {
    files: filesOf($),
    write: (path, text) => $.fs.write(path, text),
    move: async () => {
      throw new Error('The band does not move folders.')
    },
    remove: async () => {
      throw new Error('The band does not remove folders.')
    },
    now: () => new Date().toISOString(),
    uuid: () => crypto.randomUUID(),
    pluginRoot: slash($.plugin.root),
    cwd: () => $.session.cwd(),
    sessionId: () => $.session.id(),
    links: linksOf($),
    script: async (sub, input) => runScript(argv => $.process.run(argv, { timeoutMs: 60_000 }), await pythonOf($), slash($.plugin.root), sub, input),
  }
}
async function pythonOf($: any): Promise<string> {
  return (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3'
} // Windows has no python3 command
async function continueFlow($: any, dir: string): Promise<void> {
  const started = await resumeFlow(managerPorts($), dir)
  if ('error' in started) throw new Error(started.error)
  const text = `${started.text}\n${scriptNote(slash($.plugin.root), await pythonOf($))}`
  try {
    await $.ui.status(await stepLine(filesOf($), started.dir))
  } catch {
    /* a surface that cannot draw the line */
  }
  startCountingAgain()
  void Promise.resolve($.prompt.submit({ text, asUser: true })).catch(() => {})
}

// Read every flow again, and say so with a toast when one starts to need the user. The first look raises none.
async function refresh($: any): Promise<void> {
  let changed = true
  try {
    st.flows = await listFlows(filesOf($))
    st.boundDir = await findFlowDir(filesOf($), linksOf($), await $.session.id())
    const now = Date.now()
    const print = `${st.boundDir}|${fingerprint(st.flows)}${st.flows.map(p => `${activityOf(p.kind, p.lastLogMs, now)?.text ?? ''}${ago(p.updatedMs, now)}`).join('|')}` // the minute text is part of what the band draws
    changed = print !== st.lastPrint
    st.lastPrint = print
    const needing = st.flows.filter(p => needsUser(p.kind))
    if (st.primed) for (const p of needing) if (!st.seen.has(p.dir)) await $.ui.toast(`${p.name} ${LOOK[p.kind].word}`)
    st.seen = new Set(needing.map(p => p.dir))
    st.primed = true
  } catch {
    /* keep the last list */
  }
  if (changed) $.ui.invalidate('ui.render')
}

// The timer that keeps the band current. A mod has no file watcher.
function ensureTimer($: any): void {
  if (st.timer) return
  try {
    st.timer = $.clock.every(REFRESH_MS, () => refresh($))
  } catch {
    /* no timer: the band stays as it was drawn */
  }
  void refresh($)
}

// ArtifactData and Artifact are deferred tools: a call before they are loaded fails, so load them once with ToolSearch and call again.
async function callTool($: any, input: Record<string, unknown>): Promise<void> {
  const run = () => $.tool.call(input)
  const result = await run().catch(async (error: unknown) => {
    if (!/no tool named/.test(String((error as Error)?.message))) throw error
    await $.tool.call({ tool: 'ToolSearch', query: 'select:Artifact,ArtifactData', max_results: 2 })
    return run()
  })
  if (result.deny || result.isError) throw new Error(String(result.deny ?? result.text ?? 'the tool failed'))
}

// The Artifact tool shows the page in the surface the user works in. If it fails, the system opener shows it in the browser. If that fails too, the link goes in a toast.
async function openSite($: any): Promise<void> {
  const toast = async (text: string) => {
    try {
      await $.ui.toast(text)
    } catch {
      /* a surface with no toast */
    }
  }
  const key = urlKey(await $.session.id())
  let stored = (await $.store.get(key)) as string | undefined
  if (!stored) {
    try {
      await $.command.run({ command: 'zeremai:init' })
      return
    } catch {
      /* command failed: fall through to toast */
    }
  }
  stored = (await $.store.get(key)) as string | undefined
  if (!stored) return toast('Could not set up ZeremAI. Run /zeremai:init to try again.')
  const id = await $.session.id()
  await $.store.set(`openedAt:${id}`, new Date().toISOString()).catch(() => {}) // the page picks the session that opened it last, when its link has no session
  const url = `${stored}?s=${id}#${id}` // the session that runs the actions of the site
  try {
    await callTool($, { tool: 'Artifact', action: 'open', url })
    return
  } catch {
    /* the system opener next */
  }
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  for (const argv of windows
    ? [['cmd', '/c', 'start', '', url]]
    : [
        ['open', url],
        ['xdg-open', url],
      ]) {
    const run = await $.process.run(argv).catch(() => undefined)
    if (run && run.exitCode === 0) return
  }
  await toast(`ZeremAI: ${url}`)
}

export const register: Register = on => {
  // The command is registered in on-flow-tools. on-live-page answers every word of it.
  on('command.run', { command: COMMANDS }, (_$, e, next) => next(e))

  // The button above the prompt: always there, with the count of flows that need the user.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    ensureTimer($)
    const { Box, Button, Text } = $.ui.resolve(e)
    const band = bandView(st.flows, st.boundDir, Date.now())
    const blocked = st.boundDir !== undefined && st.flows.some(p => p.dir === st.boundDir && p.kind === 'blocked') // this session's flow waits for the user
    const theirs = await next(e).catch(() => undefined) // a mod after this one that fails must not blank the button
    return Box({
      flexDirection: 'column',
      children: [
        // The parts carry a theme color each (a state is also a word and a symbol, never color alone).
        Box({
          flexDirection: 'row',
          children: [
            Button({
              key: 'band-open',
              plain: true,
              dimColor: !band.hot && !st.boundDir,
              onPress: () => void openSite($),
              children: [...band.parts.map(part => (part.tone ? Text({ children: [part.text], ...(part.tone === 'dim' ? { dimColor: true } : { color: part.tone }) }) : part.text)), ' · ZeremAI ↗'],
            }),
            ...(blocked
              ? [
                  Button({
                    key: 'band-continue',
                    onPress: () => void continueFlow($, st.boundDir!).catch((error: unknown) => $.ui.toast(`Continue failed: ${error instanceof Error ? error.message : String(error)}`)),
                    children: [' ▶ Continue'],
                  }),
                ]
              : []),
          ],
        }),
        ...(theirs ? [theirs] : []), // keep what the mods after this one draw
      ],
    })
  })
}
