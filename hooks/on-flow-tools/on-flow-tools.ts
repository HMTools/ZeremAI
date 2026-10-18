import type { Register } from 'claude-code'
import { findFlowDir, readFlow, sessionKey } from '../infra/flow-repository/flow-repository'
import { bindSession } from '../infra/flow-manager/bind-session'
import { LINE_COMMANDS, checkCall, runScript, runsScript } from '../infra/flow-manager/script'
import { stepLine } from '../infra/flow-pane/step-line'
import { moveCommands, slash } from '../infra/flow-manager/move'
import type { FileSystem, ManagerPorts } from '../infra/ports/ports'

// The flow script (scripts/flow_manager.py) is the only writer of flow files. The agent runs it with Bash, one command form:
//   python3 <plugin>/scripts/flow_manager.py <subcommand> --json '<one JSON object>'
// This hook decides if a call may run: at this moment (a flow is bound, no approval dialog is open) and with these
// arguments (the schema of the subcommand, only a flow folder of this session). A call that fails a rule never reaches the script.

function filesOf($: any): FileSystem {
  return {
    home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
  }
}
function portsOf($: any): ManagerPorts {
  return {
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
    remove: async () => {
      throw new Error('The flow tools do not remove folders.')
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
    script: async (sub, input) => runScript(argv => $.process.run(argv, { timeoutMs: 60_000 }), (await $.env.get('OS')) === 'Windows_NT' ? 'python' : 'python3', slash($.plugin.root), sub, input),
  }
}
// The line under the prompt. A surface that cannot draw it (VS Code, print mode) throws or ignores: the flow goes on without it.
async function showStepLine($: any, dir: string | undefined): Promise<void> {
  try {
    await $.ui.status(dir ? await stepLine(filesOf($), dir) : '')
  } catch {
    /* no line */
  }
}

// One message at session start when improvement findings wait. Nothing is shown for none.
async function nudgeFindings($: any): Promise<void> {
  try {
    const open = ((await portsOf($).script('list-findings', { status: 'open' })).findings as unknown[] | undefined)?.length ?? 0
    if (open) await $.ui.toast(`${open} improvement finding${open === 1 ? '' : 's'} wait. Run /zeremai:apply-improvements to review ${open === 1 ? 'it' : 'them'}.`)
  } catch {
    /* no message */
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const dir = await findFlowDir(filesOf($), portsOf($).links, await $.session.id())
    if (dir) await showStepLine($, dir)
    await nudgeFindings($)
    // The command that opens the flow pane (see ../on-flow-pane). A name that is taken throws, so it must not stop the session.
    await $.command.register({ name: 'zeremai', description: 'Start a new flow or resume one', argumentHint: '[new | continue | templates | debug | first field]' }).catch(() => {})
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = (e as any).command as string
    if (!runsScript(command)) return next(e)
    const sessionId = await $.session.id()
    const ports = portsOf($)
    const files = filesOf($)
    const bound = await ports.links.get(sessionId)
    const dir = await findFlowDir(files, ports.links, sessionId)
    const verdict = checkCall(command, {
      pluginRoot: slash($.plugin.root),
      home: (await files.home()) ?? '',
      bound,
      dialogOpen: (await $.store.get(`gate:${sessionId}`)) !== undefined,
      steps: (dir ? (await readFlow(files, dir))?.steps : undefined) ?? [],
    })
    if ('deny' in verdict) return { deny: verdict.deny } as never
    if ('approval' in verdict) return next(e) // the approval hook answers request-approval before this one
    const result: any = await next(e)
    let answer: any
    try {
      answer = JSON.parse(
        String(result?.result?.stdout ?? '')
          .trim()
          .split('\n')
          .filter(Boolean)
          .pop() ?? '',
      )
    } catch {
      /* the script printed no JSON: the model reads Bash's own answer */
    }
    if (answer?.status === 'ok') {
      if (verdict.sub === 'create-flow') await bindSession(ports, verdict.input.flowDir as string)
      if (LINE_COMMANDS.includes(verdict.sub)) await showStepLine($, verdict.input.flowDir as string)
    }
    return result
  })
}
