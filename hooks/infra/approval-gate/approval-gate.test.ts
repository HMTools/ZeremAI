import { test, expect } from 'claude-code/testing'
import { APPROVE, CHANGES, approveFromPane, askGate, findApprovalStep, gateForPane, hasOpenGate, isHandEdit, questionFor, reopenPanel, requestChangesFromPane } from './approval-gate'
import type { Ask, FileSystem, Gate, GateStore } from '../ports/ports'

const DIR = '/h/.claude/zeremai/active/p1'
const gate: Gate = { dir: DIR, stepId: 's1' }
const step = { id: 's1', number: 1, name: 'Design', status: 'in_progress', approvalRequired: true, stepDefinition: { output: { description: 'The design', artifacts: ['design.md'] } } }
const flowJson = (extra = {}) => JSON.stringify({ status: 'running', metadata: { lastUpdated: 'then' }, steps: [{ ...step, ...extra }] })

// a fake disk with one flow.json; the approver (a stand-in for the script's approve-step) writes into `written`
function world(json = flowJson()) {
  const written: Record<string, string> = {}
  const files: FileSystem = {
    home: async () => '/h',
    list: async () => [],
    exists: async p => p === `${DIR}/flow.json`,
    read: async p => {
      if (p !== `${DIR}/flow.json`) throw new Error('missing')
      return json
    },
  }
  const write = async (dir: string, stepId: string) => {
    // approve-step: set approved on the step, touch lastUpdated, write the file the way the script does
    const flow = JSON.parse(json)
    flow.steps.find((s: any) => s.id === stepId).approved = true
    flow.metadata.lastUpdated = 'now'
    written[`${dir}/flow.json`] = JSON.stringify(flow, null, 2) + '\n'
  }
  const gates = new Map<string, Gate>([['S1', gate]])
  const store: GateStore = {
    get: async id => gates.get(id),
    set: async (id, g) => {
      gates.set(id, g)
    },
    clear: async id => {
      gates.delete(id)
    },
  }
  return { files, write, store, written }
}
const answers =
  (label: string): Ask =>
  async () =>
    label

test('the question names the step, its output and the folder', () => {
  const q = questionFor(step, DIR)
  expect(q).toContain('Approve step 1 "Design"?')
  expect(q).toContain('The design')
  expect(q).toContain('Output: design.md')
  expect(q).toContain(`Flow dir: ${DIR}`)
})
test('the step to approve is the one in progress, not yet approved', () => {
  expect(findApprovalStep({ steps: [step] })?.id).toBe('s1')
  expect(findApprovalStep({ steps: [{ ...step, approved: true }] })).toBeUndefined()
  expect(findApprovalStep({ steps: [{ ...step, status: 'pending' }] })).toBeUndefined()
  expect(findApprovalStep({ steps: [{ ...step, approvalRequired: false }] })).toBeUndefined()
})

test('Approve: sets approved, keeps the other fields, closes the gate', async () => {
  const w = world()
  const text = await askGate(w.files, w.write, w.store, answers(APPROVE), 'S1', gate)
  expect(text).toContain('The user approved step 1')
  const saved = JSON.parse(w.written[`${DIR}/flow.json`])
  expect(saved.steps[0].approved).toBe(true)
  expect(saved.steps[0].name).toBe('Design')
  expect(saved.metadata.lastUpdated).not.toBe('then')
  expect(await hasOpenGate(w.store, 'S1')).toBe(false)
})
test('Request changes with text: the agent reads the text, nothing is approved', async () => {
  const w = world()
  const text = await askGate(w.files, w.write, w.store, answers('use blue'), 'S1', gate)
  expect(text).toContain('use blue')
  expect(w.written).toEqual({})
  expect(await hasOpenGate(w.store, 'S1')).toBe(false)
})
test('Request changes with no text', async () => {
  const w = world()
  expect(await askGate(w.files, w.write, w.store, answers(CHANGES), 'S1', gate)).toContain('(no text given)')
  expect(w.written).toEqual({})
})
test('a dismissed dialog: nothing is approved and the gate stays open', async () => {
  const w = world()
  const text = await askGate(
    w.files,
    w.write,
    w.store,
    async () => {
      throw new Error('dismissed')
    },
    'S1',
    gate,
  )
  expect(text).toContain('only the user can approve')
  expect(w.written).toEqual({})
  expect(await hasOpenGate(w.store, 'S1')).toBe(true)
})
test('a gate for a step that is gone is closed', async () => {
  const w = world(JSON.stringify({ steps: [] }))
  expect(await askGate(w.files, w.write, w.store, answers(APPROVE), 'S1', gate)).toContain('no longer in the flow')
  expect(w.written).toEqual({})
  expect(await hasOpenGate(w.store, 'S1')).toBe(false)
})
test('one question at a time: the second asker gets nothing', async () => {
  const w = world()
  let release = () => {}
  const slow: Ask = () =>
    new Promise(resolve => {
      release = () => resolve(APPROVE)
    })
  const first = askGate(w.files, w.write, w.store, slow, 'S1', gate)
  await new Promise(r => setTimeout(r, 0))
  expect(await askGate(w.files, w.write, w.store, answers(APPROVE), 'S1', gate)).toBeUndefined()
  release()
  expect(await first).toContain('approved')
})

test('a prompt with an open gate: the dialog opens and the answer is sent as a prompt', async () => {
  const w = world()
  const sent: string[] = []
  await reopenPanel(
    w.files,
    w.write,
    w.store,
    answers(APPROVE),
    async t => {
      sent.push(t)
    },
    'S1',
  )
  await new Promise(r => setTimeout(r, 0))
  expect(sent[0]).toContain('The user approved step 1')
})
test('a prompt with an open gate and a dismissed dialog: nothing is sent', async () => {
  const w = world()
  const sent: string[] = []
  await reopenPanel(
    w.files,
    w.write,
    w.store,
    async () => {
      throw new Error('dismissed')
    },
    async t => {
      sent.push(t)
    },
    'S1',
  )
  await new Promise(r => setTimeout(r, 0))
  expect(sent).toEqual([])
  expect(await hasOpenGate(w.store, 'S1')).toBe(true)
})
test('a prompt with no gate: nothing happens', async () => {
  const w = world()
  await w.store.clear('S1')
  const sent: string[] = []
  await reopenPanel(
    w.files,
    w.write,
    w.store,
    answers(APPROVE),
    async t => {
      sent.push(t)
    },
    'S1',
  )
  await new Promise(r => setTimeout(r, 0))
  expect(sent).toEqual([])
})

const P = '/h/.claude/zeremai/active/p1/flow.json'
for (const tool of ['Write', 'Edit', 'MultiEdit']) {
  test(`hand edit: ${tool} on a flow file is refused`, () => expect(isHandEdit({ tool, file_path: P })).toBe(true))
}
test('hand edit: a Write to another file passes', () => {
  expect(isHandEdit({ tool: 'Write', file_path: '/h/.claude/zeremai/active/p1/notes.md' })).toBe(false)
  expect(isHandEdit({ tool: 'Write', file_path: '/work/app/flow.json' })).toBe(false)
})
for (const file of ['log.json', 'memory/context.json', 'memory/_cross-references.json']) {
  test(`hand edit: Write on ${file} is refused`, () => {
    expect(isHandEdit({ tool: 'Write', file_path: `/h/.claude/zeremai/active/p1/${file}` })).toBe(true)
    expect(isHandEdit({ tool: 'Edit', file_path: `/h/.claude/zeremai/completed/p1/${file}` })).toBe(true)
  })
}
test('hand edit: Windows paths, with backslashes, are refused too', () => {
  expect(isHandEdit({ tool: 'Write', file_path: 'C:\\Users\\me\\.claude\\zeremai\\active\\p1\\flow.json' })).toBe(true)
  expect(isHandEdit({ tool: 'Edit', file_path: 'C:\\Users\\me\\.claude\\zeremai\\completed\\p1\\memory\\context.json' })).toBe(true)
  expect(isHandEdit({ tool: 'Write', file_path: 'C:\\Users\\me\\.claude\\zeremai\\active\\p1\\notes.md' })).toBe(false)
  expect(isHandEdit({ tool: 'Bash', command: 'sed -i s/a/b/ C:\\Users\\me\\.claude\\zeremai\\active\\p1\\memory\\context.json' })).toBe(true)
})
test('hand edit: Write on an improvement finding is refused', () => {
  expect(isHandEdit({ tool: 'Write', file_path: '/h/.claude/zeremai/improvement-findings/t1/p1.json' })).toBe(true)
})
test('hand edit: Bash that writes log.json is refused', () => {
  expect(isHandEdit({ tool: 'Bash', command: `echo '{}' > ${P.replace('flow.json', 'log.json')}` })).toBe(true)
})
for (const command of [`sed -i 's/false/true/' ${P}`, `echo '{}' > ${P}`, `python3 -c "import json; open('${P}','w').write('{}')"`, `cat x | tee ${P}`, `jq '.a=1' ${P} > /tmp/x && mv /tmp/x ${P}`]) {
  test(`hand edit: Bash refused: ${command.slice(0, 40)}`, () => expect(isHandEdit({ tool: 'Bash', command })).toBe(true))
}
for (const command of [`cat ${P}`, `ls ${P} 2>/dev/null`, 'python3 /x/flow_manager.py update-step-status --flow-dir /p', 'git status']) {
  test(`hand edit: Bash passes: ${command.slice(0, 40)}`, () => expect(isHandEdit({ tool: 'Bash', command })).toBe(false))
}
test('hand edit: other tools pass', () => expect(isHandEdit({ tool: 'Read', file_path: P })).toBe(false))

// ── The same answer from the pane ──
const doc = (extra = {}) => ({ steps: [{ ...step, ...extra }] })

test('the gate card is working until the agent asks, dialog while the question is open, ready when it was dismissed', () => {
  expect(gateForPane(doc(), undefined, DIR)).toMatchObject({ state: 'working', stepId: 's1', number: '1', name: 'Design', output: 'The design · Output: design.md' })
  expect(gateForPane(doc(), { dir: DIR, stepId: 's9' }, DIR)?.state).toBe('working') // a gate for another step
  expect(gateForPane(doc(), { dir: '/other', stepId: 's1' }, DIR)?.state).toBe('working') // a gate for another flow
  expect(gateForPane(doc(), { ...gate, dialog: true }, DIR)?.state).toBe('dialog')
  expect(gateForPane(doc(), gate, DIR)?.state).toBe('ready')
  expect(gateForPane(doc({ approved: true }), gate, DIR)).toBeUndefined()
  expect(gateForPane({ steps: [{ ...step, status: 'pending' }] }, gate, DIR)).toBeUndefined()
})

test('while the question is open the gate says so, and a dismissed question gives the pane the buttons', async () => {
  const w = world()
  let during: Gate | undefined
  await askGate(
    w.files,
    w.write,
    w.store,
    async () => {
      during = await w.store.get('S1')
      throw new Error('dismissed')
    },
    'S1',
    gate,
  )
  expect(during?.dialog).toBe(true)
  expect((await w.store.get('S1'))?.dialog).toBeUndefined()
})

test('Approve in the pane writes approved under the same rules as the dialog, closes the gate and returns the text for the agent', async () => {
  const w = world()
  const answer = await approveFromPane(w.files, w.write, w.store, 'S1', DIR, 's1')
  expect(answer).toEqual({ text: 'The user approved step 1 "Design". Complete it with update-step-status (status completed).' })
  expect(JSON.parse(w.written[`${DIR}/flow.json`]).steps[0].approved).toBe(true)
  expect(await hasOpenGate(w.store, 'S1')).toBe(false)
})

test('Approve in the pane is refused while the agent has not asked, while the dialog is open, and for a step that is not the one that waits', async () => {
  const w = world()
  await w.store.clear('S1')
  expect(await approveFromPane(w.files, w.write, w.store, 'S1', DIR, 's1')).toEqual({ error: 'The agent has not asked for approval yet.' })
  await w.store.set('S1', { ...gate, dialog: true })
  expect(await approveFromPane(w.files, w.write, w.store, 'S1', DIR, 's1')).toEqual({ error: 'Answer the dialog that is open.' })
  await w.store.set('S1', gate)
  expect(await approveFromPane(w.files, w.write, w.store, 'S1', DIR, 's2')).toEqual({ error: 'That step no longer waits for approval.' })
  expect(w.written).toEqual({})
  expect(await hasOpenGate(w.store, 'S1')).toBe(true) // nothing was answered, so the gate stays
})

test('a step approved a moment ago cannot be approved again from a card that was drawn before', async () => {
  const w = world(flowJson({ approved: true }))
  expect(await approveFromPane(w.files, w.write, w.store, 'S1', DIR, 's1')).toEqual({ error: 'That step no longer waits for approval.' })
  expect(w.written).toEqual({})
})

test('Request changes in the pane sends the reason, approves nothing and closes the gate', async () => {
  const w = world()
  const answer = await requestChangesFromPane(w.files, w.write, w.store, 'S1', DIR, 's1', ' use blue ')
  expect(answer).toEqual({ text: 'The user asked for changes to step 1 "Design": use blue\nChange the step. When it is ready, call request-approval again.' })
  expect(w.written).toEqual({})
  expect(await hasOpenGate(w.store, 'S1')).toBe(false)
  expect(await requestChangesFromPane(world().files, w.write, world().store, 'S1', DIR, 's1', '  ')).toMatchObject({ text: expect.stringContaining('(no text given)') })
})
