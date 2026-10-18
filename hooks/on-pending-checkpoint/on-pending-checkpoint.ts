import type { Register } from 'claude-code'
import { sessionKey } from '../infra/flow-repository/flow-repository'
import { findPendingBlock } from '../infra/pending-checkpoint/pending-checkpoint'
import type { FileSystem, Gate, GateStore, SessionLinks } from '../infra/ports/ports'

// While an approval gate waits for the user's click, every tool call is refused except research and the log entry.
// No tool filter: MCP tools and subagent calls pass through here too. A fault in the check lets the call pass.

function filesOf($: any): FileSystem {
  return {
    home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
  }
}
function linksOf($: any): SessionLinks {
  return {
    get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
  }
}
function gatesOf($: any): GateStore {
  return {
    get: async sessionId => ((await $.store.get(`gate:${sessionId}`)) as Gate | undefined) ?? undefined,
    set: (sessionId, gate) => $.store.set(`gate:${sessionId}`, gate),
    clear: sessionId => $.store.delete(`gate:${sessionId}`),
  }
}

// A guard that blocks or re-prompts the agent says so in a toast: the user then knows why Claude changed course. One toast in 30 seconds for the same text.
let lastToast = ''
let lastToastMs = 0
async function say($: any, text: string): Promise<void> {
  const now = Date.now()
  if (text === lastToast && now - lastToastMs < 30_000) return
  lastToast = text
  lastToastMs = now
  try {
    await $.ui.toast(text)
  } catch {
    /* a surface that cannot show a toast */
  }
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (next.origin.plugin === $.plugin.name) return next(e) // a call this plugin raises itself (the live site writes its database while a step waits). The agent's calls come from the engine.
    const text = await findPendingBlock(filesOf($), linksOf($), gatesOf($), await $.session.id(), e as any)
    if (text) {
      await say($, 'Flow: a step waits for your approval, so Claude cannot go on.')
      return { deny: text }
    }
    return next(e)
  })
}
