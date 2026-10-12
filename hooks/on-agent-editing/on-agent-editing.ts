import type { Register } from 'claude-code'
import { sessionKey } from '../infra/flow-repository/flow-repository'
import { findLogOwed } from '../infra/log-first/log-first'
import type { FileSystem, SessionLinks } from '../infra/ports/ports'

// While the agent owes a log entry, it cannot edit files or start a subagent. (It cannot change the flow either: see on-flow-tools.)
// The command `log-interaction` of the flow script is the way out (see on-flow-tools): when it succeeds, the log is no longer owed.
// A subagent's own calls pass.

const EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task'] // Agent is the subagent tool; Task is its old name

const filesOf = ($: any): FileSystem => ({
  home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
  list: path => $.fs.list(path),
  exists: path => $.fs.exists(path),
  read: path => $.fs.read(path),
})
const linksOf = ($: any): SessionLinks => ({
  get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
})


// A guard that blocks or re-prompts the agent says so in a toast: the user then knows why Claude changed course. One toast in 30 seconds for the same text.
let lastToast = ''
let lastToastMs = 0
async function say($: any, text: string): Promise<void> {
  const now = Date.now()
  if (text === lastToast && now - lastToastMs < 30_000) return
  lastToast = text
  lastToastMs = now
  try { await $.ui.toast(text) } catch { /* a surface that cannot show a toast */ }
}

export const register: Register = on => {
  on('tool.call', { tool: EDIT_TOOLS }, async ($, e, next) => {
    const sessionId = await $.session.id()
    if (e.agentId) return next(e)
    const logOwed = await findLogOwed(filesOf($), linksOf($), sessionId)
    if (logOwed) { await say($, 'Flow: Claude must log your last prompt before it edits files.'); return { deny: logOwed.text } }
    return next(e)
  })
}
