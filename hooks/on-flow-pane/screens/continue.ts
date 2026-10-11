import { deleteFlow, inFolder, resumeFlow } from '../../infra/flow-pane/flow-pane'
import type { FlowInfo } from '../../infra/flow-pane/flow-pane'
import { LOOK, needsUser, symbolOf } from '../../infra/flow-pane/status-look'
import { HEX, progressBar } from '../../infra/flow-pane/rich'
import { activityOf, ago, isIdle } from '../../infra/flow-pane/activity'
import { stateWord } from '../../infra/flow-pane/band'
import { askAgain, say, st } from '../pane-state'
import type { Ctx } from '../ctx'

export async function continueScreen(c: Ctx): Promise<unknown[]> {
  const { Box, Button, card, cwd, handOff, k, line, narrow, picture, redraw, refresh, rich, toggle, ports, store } = c
  const flowCard = (p: FlowInfo, i: number) => {
    const look = LOOK[p.kind]
    const now = Date.now()
    const activity = activityOf(p.kind, p.lastLogMs, now)
    // What it is, where it is, why it needs you, and how long ago it changed.
    const where = `${p.template ? `${p.template}  ·  ` : ''}step ${p.step} of ${p.total}${p.stepName ? `  ·  ${p.stepName}` : ''}`
    // Each fact once: the pill says the state, so a running card says how old it is and how long it wrote no log.
    const idle = isIdle(p.kind, p.lastLogMs, now)
    const age = p.updatedMs !== undefined ? ago(p.updatedMs, now) : ''
    const why = p.kind === 'running' ? [age, activity?.text].filter(Boolean).join('  ·  ') : `${stateWord(p)}${age ? `  ·  ${age}` : ''}`
    const view = () => { st.view = 'flow'; st.shown = p.dir; st.openStep = undefined; st.section = 'steps'; st.message = ''; redraw() } // read only: the session keeps its own flow
    const whyLine = line(why, activity?.quiet ? { color: 'warning' } : { dimColor: true })
    const filled = p.kind === 'done' ? 20 : Math.round(((p.step - 1) / Math.max(1, p.total)) * 20)
    const resume = async () => handOff(await resumeFlow(ports(), p.dir))
    // Delete moves the folder to deleted/ and asks twice. The flow this session works on stays.
    const deletePress = async () => {
      if (p.dir === st.boundDir) { say('error', 'This session works on that flow. Close it first.'); redraw(); return }
      if (st.sure !== p.dir) { askAgain(p.dir); say('info', ''); redraw(); return }
      st.sure = undefined
      try { say('success', `Moved to ${await deleteFlow(ports(), p.dir)}`) } catch (error) { say('error', error instanceof Error ? error.message : String(error)) }
      await refresh()
    }
    if (k) {
      return k.card(`card-${i}`, [
        Box({ flexDirection: 'row', columnGap: 1, children: [line(p.name, { bold: true }), idle ? k.pill('idle', HEX.waiting) : k.kindPill(p.kind)] }),
        line(where, { dimColor: true }),
        whyLine,
        ...(narrow ? [] : [Box({ flexDirection: 'row', columnGap: 1, children: [picture(progressBar(p.kind === 'done' ? p.total : p.step - 1, p.total, p.kind, 240), `step ${p.step} of ${p.total}`, 240, 8), line(`step ${p.step} of ${p.total}`, { dimColor: true })] })]),
        // One filled Resume; View and Delete are quiet words. Delete asks twice: the first press shows a red Sure?.
        Box({ flexDirection: 'row', columnGap: 1, paddingTop: 1, children: [
          k.action(`flow-${i}`, 'Resume', resume, 'go'),
          Button({ key: `view-${i}`, label: 'View', plain: true, dimColor: true, onPress: view }),
          st.sure === p.dir ? Button({ key: `del-${i}`, plain: true, onPress: deletePress, children: [line('Sure?', { color: 'error' })] }) : Button({ key: `del-${i}`, label: 'Delete', plain: true, dimColor: true, onPress: deletePress }),
        ] }),
      ], { hot: needsUser(p.kind), edge: idle ? HEX.waiting : HEX[p.kind] })
    }
    return card(`card-${i}`, [
      Box({
        flexDirection: 'row', columnGap: 1,
        children: [
          line(symbolOf(p.kind, false), { color: look.color, bold: true }),
          Button({ key: `flow-${i}`, plain: true, label: p.name, onPress: resume }),
          Button({ key: `view-${i}`, plain: true, label: 'View', dimColor: true, onPress: view }),
          line(idle ? 'idle' : look.word, { color: idle ? 'warning' : look.color }),
          Button({ key: `del-${i}`, label: st.sure === p.dir ? 'Sure?' : 'Delete', plain: true, dimColor: st.sure !== p.dir, onPress: deletePress }),
        ],
      }),
      line(narrow ? `step ${p.step}/${p.total}` : where, { dimColor: true }),
      ...(narrow ? (activity?.quiet ? [whyLine] : []) : [whyLine]),
      ...(narrow ? [] : [rich ? picture(progressBar(p.kind === 'done' ? p.total : p.step - 1, p.total, p.kind, 240), `step ${p.step} of ${p.total}`, 240, 8) : line('█'.repeat(filled).padEnd(20, '░'), { color: look.color })]),
    ], needsUser(p.kind))
  }

  const here = inFolder(st.flows, cwd, st.allFolders)
  const FILTERS = [['all', 'All', () => true], ['needs', 'Needs me', (p: FlowInfo) => needsUser(p.kind)], ['running', 'Running', (p: FlowInfo) => p.kind === 'running'],
    ['done', 'Done', (p: FlowInfo) => p.kind === 'done'], ['failed', 'Failed', (p: FlowInfo) => p.kind === 'failed']] as const
  const filter = FILTERS.find(f => f[0] === st.filter) ?? FILTERS[0]
  const visible = here.filter(filter[2])
  const chips = Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: FILTERS.map(([id, label, test]) => {
    const n = here.filter(test).length
    return toggle(`flt-${id}`, `${label}${n && !narrow ? ` ·${n}` : ''}`, st.filter === id, () => { st.filter = id; redraw() })
  }) })
  const setFolders = (all: boolean) => async () => { st.allFolders = all; await store.set('allFolders', all); redraw() }
  // One line under the chips: what you see, and one button for the other choice.
  const countLine = Box({ flexDirection: 'row', columnGap: 2, paddingBottom: 1, children: [
    line(`${here.length} flow${here.length === 1 ? '' : 'es'} in ${st.allFolders ? 'all folders' : 'this folder'}`, { dimColor: true }),
    st.allFolders ? Button({ key: 'folder-here', label: 'This folder only', plain: true, onPress: setFolders(false) }) : Button({ key: 'folder-all', label: 'All folders', plain: true, onPress: setFolders(true) }),
  ] })
  return [
    ...(here.length > 1 || st.filter !== 'all' ? [chips] : []),
    countLine,
    ...(visible.length
      ? (k ? [k.stack(visible.map(flowCard))] : visible.map(flowCard))
      : here.length ? [line('No flow matches this filter. Press All.', { dimColor: true })]
      : [line(st.allFolders || !st.flows.length ? 'No flow is running. Start one on the New tab.' : 'No flow in this folder. Press All folders to see every flow.', { dimColor: true })]),
  ]
}
