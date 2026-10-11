import type { Register } from 'claude-code'
import { findFlowDir, readFlow, sessionKey } from '../infra/flow-repository/flow-repository'
import { askGate, findApprovalStep, isHandEdit, HAND_EDIT_TEXT, REQUEST_APPROVAL_TOOL } from '../infra/approval-gate/approval-gate'
import type { Ask, FileSystem, FileWriter, Gate, GateStore, SessionLinks } from '../infra/ports/ports'

// The user approves a step with a click. The agent asks with the tool `request_approval` (listed by on-flow-tools); the call waits for the answer.
// Only this mod writes `approved` in flow.json. The agent cannot edit that file by hand.
// A fault in the hand-edit check refuses the call. A fault elsewhere approves nothing.

const FULL_TOOL = `mcp__zeremai__${REQUEST_APPROVAL_TOOL.name}`

const filesOf = ($: any): FileSystem => ({
  home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')), // Windows has no HOME in every shell
  list: path => $.fs.list(path),
  exists: path => $.fs.exists(path),
  read: path => $.fs.read(path),
})
const linksOf = ($: any): SessionLinks => ({
  get: async sessionId => ((await $.store.get(sessionKey(sessionId))) as string[] | undefined) ?? [],
})
const writerOf = ($: any): FileWriter => (path, text) => $.fs.write(path, text)
const askOf = ($: any): Ask => (question, options) => $.ui.ask(question, options)
const gatesOf = ($: any): GateStore => ({
  get: async sessionId => ((await $.store.get(`gate:${sessionId}`)) as Gate | undefined) ?? undefined,
  set: (sessionId, gate) => $.store.set(`gate:${sessionId}`, gate),
  clear: sessionId => $.store.delete(`gate:${sessionId}`),
})

const reply = (text: string) => ({ result: { content: [{ type: 'text', text }], isError: false } }) as never


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
  on('tool.call', { tool: FULL_TOOL }, async ($, e) => {
    const sessionId = await $.session.id()
    const files = filesOf($)
    const dir = await findFlowDir(files, linksOf($), sessionId)
    if (!dir) return reply('No flow is bound to this session.')
    const step = findApprovalStep(await readFlow(files, dir))
    if (!step?.id) return reply('No step is waiting for approval.')
    const gates = gatesOf($)
    const gate = { dir, stepId: step.id }
    await gates.set(sessionId, gate)
    return reply((await askGate(files, writerOf($), gates, askOf($), sessionId, gate)) ?? 'The approval dialog is already open. Wait for the user.')
  })

  on('tool.call', { tool: ['Write', 'Edit', 'MultiEdit', 'Bash'] }, async ($, e, next) => {
    if (!isHandEdit(e as any)) return next(e)
    await say($, 'Flow: Claude tried to edit a flow file by hand. The call was refused.')
    return { deny: HAND_EDIT_TEXT }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: HAND_EDIT_TEXT }))
}
