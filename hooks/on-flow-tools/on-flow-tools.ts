import type { Register } from 'claude-code'
import { findFlowDir, hasFlowInstance, sessionKey } from '../infra/flow-repository/flow-repository'
import { FLOW_TOOLS, TOOL_PREFIX, ensureFlowTools, runTool } from '../infra/flow-manager/tools'
import { bindSession } from '../infra/flow-manager/bind-session'
import { listFindings } from '../infra/flow-manager/findings'
import { stepLine } from '../infra/flow-pane/step-line'
import { moveCommands, slash } from '../infra/flow-manager/move'
import type { FileSystem, ManagerPorts } from '../infra/ports/ports'

// The flow tools: the agent changes flow files with them, not with shell commands. The tools are listed when
// the flow pane starts or resumes a flow (see ../on-flow-pane) or when a session already has one.

const filesOf = ($: any): FileSystem => ({
  home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
  list: path => $.fs.list(path),
  exists: path => $.fs.exists(path),
  read: path => $.fs.read(path),
})
const portsOf = ($: any): ManagerPorts => ({
  files: filesOf($),
  write: (path, text) => $.fs.write(path, text),
  move: async (from, to) => {
    // The mods file API cannot move a folder: run the platform's own command. Windows sets OS=Windows_NT in every shell.
    const windows = (await $.env.get('OS')) === 'Windows_NT'
    for (const argv of moveCommands(windows, from, to)) {
      const run = await $.process.run(argv)
      if (run.exitCode !== 0) throw new Error(`${argv[0]} failed: ${(run.stderr || run.stdout).trim()}`)
    }
  },
  now: () => new Date().toISOString(),
  uuid: () => crypto.randomUUID(),
  pluginRoot: slash($.plugin.root),
  cwd: () => $.session.cwd(),
  sessionId: () => $.session.id(),
  links: {
    get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
    add: async (sessionId, dir) => {
      const dirs = ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? []
      await $.store.set(sessionKey(sessionId), [...dirs.filter(d => d !== dir), dir]) // the newest goes last, and answers first
    },
  },
})
// The line under the prompt. A surface that cannot draw it (VS Code, print mode) throws or ignores: the flow goes on without it.
async function showStepLine($: any, dir: string | undefined): Promise<void> {
  try { await $.ui.status(dir ? await stepLine(filesOf($), dir) : '') } catch { /* no line */ }
}
// The tools that change where the flow is.
const LINE_TOOLS = ['create_flow', 'bind_flow', 'update_step_status', 'update_current_state', 'update_active_substep', 'update_flow_status']

// One message at session start when improvement findings wait. Nothing is shown for none.
async function nudgeFindings($: any): Promise<void> {
  try {
    const open = ((await listFindings(portsOf($), { status: 'open' })).findings as unknown[]).length
    if (open) await $.ui.toast(`${open} improvement finding${open === 1 ? '' : 's'} wait. Run /zeremai:apply-improvements to review ${open === 1 ? 'it' : 'them'}.`)
  } catch { /* no message */ }
}

const registerOf = ($: any) => (spec: Parameters<typeof $.tool.register>[0]) => $.tool.register(spec)

export const register: Register = on => {
  // A session that already has a flow lists the tools at once.
  on('session.start', async ($, e, next) => {
    const dir = await findFlowDir(filesOf($), portsOf($).links, await $.session.id())
    if (hasFlowInstance(dir)) {
      await ensureFlowTools(registerOf($), await $.session.id())
      await showStepLine($, dir)
    }
    await nudgeFindings($)
    // The command that opens the flow pane (see ../on-flow-pane). A name that is taken throws, so it must not stop the session.
    await $.command.register({ name: 'flow', description: 'Start a new flow or resume one', argumentHint: '[new | continue | templates | debug | first field]' }).catch(() => {})
    return next(e)
  })

  on('tool.call', { tool: FLOW_TOOLS.map(t => `${TOOL_PREFIX}${t.name}`) }, async ($, e) => {
    const name = e.tool.slice(TOOL_PREFIX.length)
    const args = e as any // the arguments of an MCP tool call sit on e itself
    const ports = portsOf($)
    const result = await runTool(ports, name, args)
    if (name === 'create_flow' && result.status === 'ok') await bindSession(ports, args.flowDir)
    if (LINE_TOOLS.includes(name)) await showStepLine($, args.flowDir)
    const isError = result.status === 'error'
    return { result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError }, ...(isError ? { isError: true } : {}) } as never
  })
}
