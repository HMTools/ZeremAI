import type { StepRow } from '../../infra/flow-pane/flow-pane'
import { LOOK, needsUser, symbolOf } from '../../infra/flow-pane/status-look'
import { nodeSegment, ring, titleText } from '../../infra/flow-pane/rich'
import { activityOf } from '../../infra/flow-pane/activity'
import { flowGrid } from '../../infra/flow-pane/rich'
import { say, st } from '../pane-state'
import type { Ctx } from '../ctx'

export async function boundScreen(c: Ctx): Promise<unknown> {
  const { resume, gate, approve, requestChanges, close } = c
  const { Box, Button, Input, Client, card, detail, e, files, k, line, narrow, nav, openInViewer, picture, redraw, rich, tabRow, toggle, views } = c
  const bound = c.bound!
  const own = bound.dir === st.boundDir // View opens another flow read only: it has no buttons that act on the session
  // A flow is bound to the session: the pane shows that one flow, or the detail of one of its steps.
  const look = LOOK[bound.kind]
  const kindWord = (kind: keyof typeof LOOK) => line(LOOK[kind].word, { color: LOOK[kind].color })
  const goTo = (dir: string | undefined) => () => { st.shown = dir; st.openStep = undefined; st.section = 'steps'; redraw() }
  if (detail) {
    const at = bound.steps.findIndex(s => s.id === detail.id)
    const move = (by: number) => () => { st.openStep = bound.steps[at + by]?.id; redraw() }
    // An empty part shows as a dim dash, so the reader sees it is empty and not missing. A step with nothing at all says so in one line.
    const block = (title: string, items: string[]) => [line(title, { bold: true }), ...(items.length ? items.map(item => line(`  ${item}`)) : [line('  —', { dimColor: true })])]
    const tabNow = st.detailTabs[detail.id] ?? 'definition' // each step keeps its own tab
    const tabButton = (name: 'definition' | 'execution', label: string) => toggle(`dtab-${name}`, label, tabNow === name, () => { st.detailTabs[detail.id] = name; redraw() })
    const lists = tabNow === 'definition'
      ? [['Produces', detail.produces], ['Substeps', detail.substeps], ['Reads memory', detail.reads], ['Writes memory', detail.writes]] as const
      : [['Actions', detail.actions], ['Reasoning', detail.reasoning], ['Decisions', detail.decisions], ['Files', detail.files], ['Produced', detail.produced.map(([k, v]) => `${k}: ${v}`)], ['Notes', detail.notes], ['Problems', detail.problems]] as const
    const parts = lists.some(([, items]) => items.length) ? lists.flatMap(([title, items]) => block(title, [...items])) : []
    return card('step-detail', [
      Box({ flexDirection: 'row', columnGap: 1, children: k ? [line(`${detail.number}. ${detail.name}`, { bold: true }), k.kindPill(detail.kind)] : [line(symbolOf(detail.kind, false), { color: LOOK[detail.kind].color, bold: true }), line(`${detail.number}. ${detail.name}`, { bold: true }), kindWord(detail.kind)] }),
      Box({ flexDirection: 'row', columnGap: 3, children: [
        nav('back-steps', st.section === 'logs' ? 'Back to logs' : 'Back to steps', () => { st.openStep = undefined; redraw() }),
        ...(at > 0 ? [nav('step-prev', `‹ ${bound.steps[at - 1].number}`, move(-1))] : []),
        ...(at >= 0 && at < bound.steps.length - 1 ? [nav('step-next', `${bound.steps[at + 1].number} ›`, move(1))] : []),
      ] }),
      tabRow([tabButton('definition', 'Definition'), tabButton('execution', 'Execution')]),
      line(' '),
      ...(parts.length ? parts : [line(tabNow === 'definition' ? 'This step has no definition.' : 'Nothing recorded yet.', { dimColor: true })]),
    ], needsUser(detail.kind))
  }
  const stepRows = (s: StepRow, i: number) => [
    Box({ key: `row-${s.id}`, flexDirection: 'row', columnGap: 1, children: [
      rich ? picture(nodeSegment(s.kind, { first: i === 0, last: i === bound.steps.length - 1, height: 22 }), LOOK[s.kind].word, 24, 22) : line(symbolOf(s.kind, false), { color: LOOK[s.kind].color, bold: s.active }),
      Button({ key: `step-${s.id}`, label: `${s.number}. ${s.name}`, plain: true, onPress: () => { st.openStep = s.id; redraw() } }),
      ...(needsUser(s.kind) ? [kindWord(s.kind)] : []),
    ] }),
    ...(narrow ? [] : s.substeps.map(sub => line(`    ${sub.active ? '◀' : '·'} ${sub.number} ${sub.name}`, { dimColor: !sub.active, ...(sub.active ? { color: look.color } : {}) }))),
    ...(narrow ? [] : s.children.map((c, n) => Box({ key: `child-${s.id}-${n}`, flexDirection: 'row', columnGap: 1, children: [
      line('  └', { dimColor: true }), line(symbolOf(c.kind, false), { color: LOOK[c.kind].color }),
      Button({ key: `sub-${s.id}-${n}`, label: c.name, plain: true, onPress: goTo(c.dir) }), kindWord(c.kind),
    ] }))),
  ]
  // Desktop: a card for each step, with its substeps as chips and a sub-flow under it in a dashed card.
  const stepCards = (s: StepRow, i: number) => {
    const activeSub = s.substeps.find(x => x.active)?.number ?? 0
    return [
      k!.card(`scard-${s.id}`, [
        Box({ flexDirection: 'row', columnGap: 1, children: [
          picture(nodeSegment(s.kind, { first: true, last: true, height: 22 }), LOOK[s.kind].word, 24, 22),
          Button({ key: `step-${s.id}`, label: `${s.number}. ${s.name}`, plain: true, dimColor: s.kind === 'done' || s.kind === 'pending', onPress: () => { st.openStep = s.id; redraw() } }),
          s.kind === 'pending' || s.kind === 'done' ? line(LOOK[s.kind].word, { dimColor: true }) : k!.kindPill(s.kind),
        ] }),
        ...(narrow || !s.substeps.length ? [] : [k!.wrap(s.substeps.map(sub => k!.chip(`${sub.number} ${sub.name}`, sub.active ? 'active' : sub.number < activeSub ? 'done' : 'idle')))]),
      ], { hot: needsUser(s.kind), active: s.active }),
      ...(narrow ? [] : s.children.map((c, n) => Box({ key: `child-${s.id}-${n}`, marginLeft: 3, flexDirection: 'column', children: [
        k!.card(`ccard-${s.id}-${n}`, [Box({ flexDirection: 'row', columnGap: 1, children: [line('↳', { dimColor: true }), Button({ key: `sub-${s.id}-${n}`, label: c.name, plain: true, onPress: goTo(c.dir) }), k!.kindPill(c.kind)] })], { dashed: true }),
      ] }))),
    ]
  }
  // Desktop: the steps as a graph the user can move. The terminal and the toggle's other side keep the timeline.
  const node = (id: string, label: string, kind: keyof typeof LOOK, sub: string, go: 'step' | 'open', target: string) =>
    ({ id, label, sub, symbol: symbolOf(kind, false), color: LOOK[kind].color, hot: needsUser(kind), go, target })
  const graphButtons = [
    toggle('mode-graph', 'Graph', st.graphOn, () => { st.graphOn = true; redraw() }),
    toggle('mode-list', 'Timeline', !st.graphOn, () => { st.graphOn = false; redraw() }),
  ]
  const graph = Client && e.surface === 'desktop' && st.graphOn ? Client({
    key: 'graph', module: '../graph-view.ts', width: '100%', height: 22,
    props: {
      ...(bound.parent ? { parent: node('parent', bound.parent.name, 'running', 'parent flow', 'open', bound.parent.dir) } : {}),
      rows: bound.steps.map(s => ({
        active: s.active,
        step: node(s.id, `${s.number}. ${s.name}`, s.kind, `${LOOK[s.kind].word}${s.substeps.length ? ` · substep ${s.substeps.find(x => x.active)?.number ?? '-'} of ${s.substeps.length}` : ''}`, 'step', s.id),
        children: s.children.map((c, n) => node(`${s.id}-${n}`, c.name, c.kind, `sub-flow · ${LOOK[c.kind].word}`, 'open', c.dir)),
      })),
    },
  }) : undefined
  // The four tabs of a bound flow. A count on a tab says how much is inside.
  const v = views!
  const outputs = v.rows.filter(r => r.output)
  const topicCount = st.section === 'memory' ? v.mem.topics.length : v.counts.topics
  const fileCount = st.section === 'files' ? outputs.length : v.counts.files
  const sec = (name: typeof st.section, label: string, short: string, count = 0) =>
    toggle(`sec-${name}`, `${narrow ? short : label}${count && !narrow ? ` ·${count}` : ''}`, st.section === name, () => { st.section = name; st.message = ''; redraw() })
  const sectionTabs = tabRow([
    sec('steps', 'Steps', 'Steps'), sec('memory', 'Memory', 'Mem', topicCount), sec('logs', 'Logs', 'Logs'), sec('files', 'Files', 'Files', fileCount),
  ], Client && e.surface === 'desktop' && st.section === 'steps' ? graphButtons : []) // Graph and Timeline sit at the right of the same row
  const none = (text: string) => line(text, { dimColor: true })
  const sub = (name: typeof st.memTab, label: string) => toggle(`mem-${name}`, label, st.memTab === name, () => { st.memTab = name; redraw() })
  const toLine = (items: string[]) => items.join(', ') || '-'
  const LONG = 120 // a value longer than this is cut, with a button for the rest
  const topicRows = (t: (typeof v.mem.topics)[number]) => [
    Button({ key: `topic-${t.topic}`, label: `${st.openTopic === t.topic ? '▾' : '▸'} ${t.topic}`, plain: true, onPress: () => { st.openTopic = st.openTopic === t.topic ? undefined : t.topic; redraw() } }),
    ...(st.openTopic === t.topic ? t.entries.flatMap(en => [
      line(`  step ${en.step} ${en.stepName}`, { bold: true }),
      ...en.values.flatMap(([key, val]) => {
        const id = `${t.topic}:${en.step}:${key}`
        if (val.length <= LONG) return [line(`    ${key}: ${val}`)]
        const open = st.openValues.has(id)
        return [line(`    ${key}: ${open ? val : `${val.slice(0, LONG)}…`}`), Button({ key: `more-${id}`, label: open ? '    show less' : '    show more', plain: true, dimColor: true, onPress: () => { if (!st.openValues.delete(id)) st.openValues.add(id); redraw() } })]
      }),
      ...en.decisions.map(d => line(`    decision: ${d}`)), ...en.files.map(f => line(`    file: ${f}`)), ...en.notes.map(n => line(`    note: ${n}`)),
    ]) : []),
  ]
  // Desktop: which step reads and writes which topic, as the same picture the template details draw.
  const stepNumbers = bound.steps.map(s => Number(s.number))
  const flowCells = Object.fromEntries(v.mem.topics.map(t => [t.topic, stepNumbers.map(n => {
    const w = t.writtenBy.includes(String(n)), r = t.readBy.includes(String(n))
    return w && r ? 'R/W' as const : w ? 'W' as const : r ? 'R' as const : '' as const
  })]))
  const flowPicture = [picture(flowGrid(v.mem.topics.map(t => t.topic), flowCells, stepNumbers), 'Which step reads and writes which memory topic', 150 + 44 * stepNumbers.length + 4, 26 + 28 * v.mem.topics.length), line('W writes · R reads · R/W both', { dimColor: true })]
  const diffColor = (l: string) => (l[0] === '+' ? 'success' : l[0] === '-' ? 'error' : 'warning')
  const memoryBody = [
    tabRow([sub('flow', 'Flow'), sub('topics', 'Topics'), sub('history', 'History'), sub('diffs', 'Diffs')]),
    line(' '),
    ...(!v.mem.topics.length ? [none('No memory yet. A step writes memory when it runs.')]
      : st.memTab === 'flow' ? (rich ? flowPicture : v.mem.topics.map(t => line(`${t.topic}  ·  written by ${toLine(t.writtenBy)}  ·  read by ${toLine(t.readBy)}`)))
      : st.memTab === 'topics' ? (k ? [k.stack(v.mem.topics.map(t => k.card(`tcard-${t.topic}`, topicRows(t))))] : v.mem.topics.flatMap(topicRows))
      : st.memTab === 'history' ? (v.mem.history.length ? v.mem.history.map(en => line(`${en.updated.slice(0, 16).replace('T', ' ')}  ${en.topic}  step ${en.step}  ·  ${en.values.length} values`)) : [none('No entries yet.')])
      : (v.mem.diffs.length ? v.mem.diffs.flatMap(d => [line(`${d.topic}: step ${d.from} → step ${d.to}`, { bold: true }), ...d.lines.map(l => line(`  ${l}`, { color: diffColor(l) }))]) : [none('No topic has two entries that differ.')])),
  ]
  const today = new Date().toISOString().slice(0, 10)
  // The time of day, and the date too when it is not today.
  const clock = (t?: string) => (t ? (t.length >= 16 ? `${t.slice(0, 10) === today ? '' : `${t.slice(5, 10)} `}${t.slice(11, 16)}` : t.slice(0, 16)) : '')
  const logRows = (r: (typeof v.logs)[number]) => [
    Box({ key: `logrow-${r.id}`, flexDirection: 'row', columnGap: 1, children: [
      ...(k ? [k.kindPill(r.kind)] : [line(symbolOf(r.kind, false), { color: LOOK[r.kind].color })]),
      Button({ key: `log-${r.id}`, label: `${r.number}. ${r.name}`, plain: true, onPress: () => { st.openStep = r.id; st.detailTabs[r.id] = 'execution'; redraw() } }),
      ...(clock(r.started) ? [line(`${clock(r.started)}${r.completed ? ` – ${clock(r.completed)}` : ''}`, { dimColor: true })] : []),
    ] }),
    ...(narrow ? [] : r.actions.slice(0, 2).map(a => line(`    ${a}`, { dimColor: true }))),
    ...(narrow ? [] : r.problems.slice(0, 2).map(p => line(`    problem: ${p}`, { color: 'error' }))),
  ]
  const shownLogs = v.logs.filter(r => !st.problemsOnly || r.problems.length)
  const logsBody = !v.logs.length ? [none('No log yet. The agent writes one for each step it finishes.')] : [
    toggle('logs-problems', 'Problems only', st.problemsOnly, () => { st.problemsOnly = !st.problemsOnly; redraw() }),
    ...(shownLogs.length ? (k ? [k.stack(shownLogs.map(r => k.card(`logcard-${r.id}`, logRows(r))))] : shownLogs.flatMap(logRows)) : [none('No step reported a problem.')]),
  ]
  const fileRow = (r: (typeof v.rows)[number], i: number) => (k ? (x: unknown) => k.card(`filecard-${i}`, [x]) : (x: unknown) => x)(Box({ key: `filerow-${i}`, flexDirection: 'row', columnGap: 2, children: [
    r.openable ? Button({ key: `file-${r.path}`, label: r.name, plain: true, onPress: async () => { say('error', await openInViewer(r.path, e.surface)); redraw() } }) : line(r.name, { dimColor: true }),
    ...(r.step ? [line(`step ${r.step}`, { dimColor: true })] : []),
  ] }))
  const framework = v.rows.filter(r => !r.output)
  // A file never opens inside the pane: a press hands it to the viewer (see openInViewer).
  const filesBody = [
    ...(outputs.length ? outputs.map(fileRow) : [none('No output file yet. A step lists its files when it finishes.')]),
    ...(framework.length ? [Button({ key: 'fw-toggle', label: `${st.showFramework ? '▾' : '▸'} Framework files (${framework.length})`, plain: true, dimColor: true, onPress: () => { st.showFramework = !st.showFramework; redraw() } })] : []),
    ...(st.showFramework ? framework.map(fileRow) : []),
  ]
  const stepsBody = graph ? [graph] : [...(k ? [k.stack(bound.steps.flatMap(stepCards))] : bound.steps.flatMap(stepRows))]
  const title = titleText(bound.name)
  // The approval step: while it runs, a line says approval comes after it; when the agent asked and no dialog is open, the pane has the buttons.
  const next = gate ? bound.steps[bound.steps.findIndex(s => s.id === gate.stepId) + 1] : undefined
  const gateCard = !gate || !own ? [] : gate.state === 'working'
    ? [line(`Step ${gate.number} "${gate.name}" needs your approval when it is done.`, { dimColor: true })]
    : [card('gate', [
      Box({ flexDirection: 'row', columnGap: 1, children: [line(`Step ${gate.number} "${gate.name}" needs your approval`, { bold: true }), ...(k ? [k.kindPill('waiting')] : [])] }),
      ...(gate.output ? [line(gate.output, { dimColor: true })] : []),
      ...(gate.state === 'dialog'
        ? [line('Claude asked in a dialog. Answer the dialog that is open.', { dimColor: true })]
        : [
          line(`Approve: ${next ? `runs step ${next.number} "${next.name}"` : 'the flow ends'}. Request changes: step ${gate.number} runs again.`, { dimColor: true }),
          Box({ flexDirection: 'row', columnGap: 1, children: [
            Button({ key: 'gate-approve', label: 'Approve', ...(k ? { variant: 'primary' } : {}), onPress: () => approve(gate.stepId) }),
            Button({ key: 'gate-changes', label: st.changing ? 'Cancel' : 'Request changes', ...(k ? { variant: 'secondary' } : { plain: true }), onPress: () => { st.changing = !st.changing; st.reason = ''; redraw() } }),
          ] }),
          ...(st.changing ? [
            Input({ key: 'gate-reason', label: 'What should change?', value: st.reason, autoFocus: true, onInput: (text: string) => { st.reason = text }, submitLabel: 'send', onSubmit: async (text: string) => { st.reason = text; if (text.trim()) await requestChanges(gate.stepId, text) } }),
            Button({ key: 'gate-send', label: 'Send changes', dimColor: !st.reason.trim(), plain: true, onPress: () => (st.reason.trim() ? requestChanges(gate.stepId, st.reason) : undefined) }),
          ] : []),
        ]),
    ], gate.state === 'ready')]
  const activity = activityOf(bound.kind, st.flows.find(p => p.dir === bound.dir)?.lastLogMs, Date.now())
  const activityLine = activity ? [line(activity.text, activity.quiet ? { color: 'warning' } : { dimColor: true })] : []
  // A failed or paused flow says why it stopped, and has one button to go on. The button hands the agent the flow again, with one extra line.
  const attention = bound.attention
  const attentionCard = attention ? [card('attention', [
    Box({ flexDirection: 'row', columnGap: 1, children: [line(bound.kind === 'failed' ? `Step ${attention.number} failed` : 'The flow is paused', { bold: true }), ...(k ? [k.kindPill(bound.kind)] : [])] }),
    line(attention.reason || (bound.kind === 'failed' ? 'The log holds no error text.' : `It stopped at step ${attention.number} "${attention.name}".`), { dimColor: true }),
    ...(!own ? [line('Resume it from the list to go on.', { dimColor: true })] : [Button({ key: 'retry', label: bound.kind === 'failed' ? 'Retry step' : 'Resume', ...(k ? { variant: 'primary' } : {}),
      onPress: () => resume(bound.dir, bound.kind === 'failed' ? `The user pressed Retry on step ${attention.number} "${attention.name}". Run that step again.` : 'The user pressed Resume on a paused flow.') })]),
  ], true)] : []
  return card('bound', [
    ...(bound.parent ? [nav('parent', `↑ ${bound.parent.name}`, goTo(bound.parent.dir))] : []),
    ...(rich
      ? [Box({ flexDirection: 'row', columnGap: 2, children: [
        picture(ring(bound.step, bound.total, bound.kind), `Step ${bound.step} of ${bound.total}`, 44, 44),
        Box({ flexDirection: 'column', children: [
          Box({ flexDirection: 'row', columnGap: 1, children: [picture(title.source, bound.name, title.width, title.height), k!.kindPill(bound.kind)] }),
          line(`Step ${bound.step} of ${bound.total}${bound.steps[bound.step - 1] ? `  ·  ${bound.steps[bound.step - 1].name}` : ''}`, { dimColor: true }),
          ...activityLine,
        ] }),
      ] })]
      : [Box({ flexDirection: 'row', columnGap: 1, children: [line(symbolOf(bound.kind, false), { color: look.color, bold: true }), line(bound.name, { bold: true }), line(look.word, { color: look.color })] }),
        line(`Step ${bound.step} of ${bound.total}`, { dimColor: true }), ...activityLine]),
    ...(own ? [] : [line('Viewing only. The session does not work on this flow.', { dimColor: true })]),
    ...attentionCard,
    ...gateCard,
    sectionTabs,
    line(' '),
    ...(st.section === 'memory' ? memoryBody : st.section === 'logs' ? logsBody : st.section === 'files' ? filesBody : stepsBody),
    line(' '),
    Box({ flexDirection: 'row', columnGap: 3, children: [
      nav('back-list', k ? '← Back to list' : 'Back to list', () => { st.view = 'list'; st.tab = 'continue'; st.shown = st.boundDir; redraw() }),
      ...(own ? [Button({ key: 'close-flow', label: 'Close flow', ...(k ? { variant: 'secondary' } : { plain: true, dimColor: true }), onPress: close })] : []),
    ] }),
  ], needsUser(bound.kind))
}
