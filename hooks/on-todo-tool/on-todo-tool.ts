import type { Register } from 'claude-code'
import { findFlowDir, readFlow, hasFlowInstance, isFlowRunning, sessionKey } from '../infra/flow-repository/flow-repository'
import type { FileSystem, SessionLinks } from '../infra/ports/ports'

// While a flow runs, its steps are the task list: the agent cannot keep a second one (that can skip an approval gate).
// A subagent's own calls pass. A fault in the check lets the call pass.

const TODO_TOOLS = ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite']
const TEXT = 'External todo tools are blocked during flow execution — flow steps are your task list'

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
  on('tool.call', { tool: TODO_TOOLS }, async ($, e, next) => {
    if (e.agentId) return next(e)
    const files = filesOf($)
    const flowDir = await findFlowDir(files, linksOf($), await $.session.id())
    if (!hasFlowInstance(flowDir)) return next(e)
    if (!isFlowRunning(await readFlow(files, flowDir))) return next(e)
    await say($, 'Flow: todo tools are off while a flow runs.')
    return { deny: TEXT }
  })
}
