import { missingFields, startFlow } from '../../infra/flow-pane/flow-pane'
import { FAVORITES, groupRows, lastUsedNames, matches, mergeTemplates, templateDetail, viewPath } from '../../infra/flow-pane/template-views'
import type { TemplateRow } from '../../infra/flow-pane/template-views'
import { ago } from '../../infra/flow-pane/activity'
import { CATEGORY_KEYS, HEX, PALETTE, categoryIndex } from '../../infra/flow-pane/rich'
import { installTemplate, refreshMarketplaces, removeTemplate } from '../../infra/templates/templates'
import { askAgain, noteRefresh, resetFill, say, st } from '../pane-state'
import type { Ctx } from '../ctx'

export async function newScreen(c: Ctx): Promise<unknown[]> {
  const { Box, Button, Input, Text, card, files, k, line, narrow, ports, redraw, store, templateJob, viewTemplate } = c
  const allRows = mergeTemplates(st.templates, st.entries)
  const saveFavorites = async () => { await store.set('favorites', [...st.favorites]); redraw() }
  const toggleFavorite = (key: string) => () => { if (!st.favorites.delete(key)) st.favorites.add(key); return saveFavorites() }
  const star = (key: string, id: string) => Button({ key: id, label: st.favorites.has(key) ? '★' : '☆', plain: true, onPress: toggleFavorite(key) })
  const install = (r: TemplateRow) => {
    const label = st.busy === `install-${r.key}` ? 'Installing…' : r.state === 'update' ? 'Update' : 'Install'
    const press = () => templateJob(ports => installTemplate(ports, r.entry!), `install-${r.key}`)
    return k ? k.action(`tpl-install-${r.key}`, label, press) : Button({ key: `tpl-install-${r.key}`, label, onPress: press })
  }
  const start = (r: TemplateRow) => {
    const press = () => { st.chosen = r.template; st.values = r.template!.fields[0] && st.firstArg ? { [r.template!.fields[0].name]: st.firstArg } : {}; st.purposeOpen = false; st.message = ''; resetFill(); redraw() }
    return k ? k.action(`start-${r.key}`, 'Start', press, 'go') : Button({ key: `start-${r.key}`, label: 'Start', variant: 'primary', onPress: press })
  }
  const cats = [...new Set(allRows.map(r => r.category))].sort()
  const pick = (value: string | undefined) => () => { st.category = value; redraw() }
  // One chip for both surfaces: Desktop a dot and a block (see rich-ui), the terminal a theme-colored dot and a reversed block.
  const chip = (id: string, label: string, value: string | undefined, hex: string, word?: string, count?: number) => {
    const active = st.category === value
    if (k) return k.colorChip(id, label, active, hex, pick(value), count)
    const dot = word ? [Text({ children: ['● '], color: word })] : []
    return Button({ key: id, plain: true, onPress: pick(value), children: active
      ? [Text({ children: [` ${word ? '● ' : ''}${label}${count == null ? '' : ` ${count}`} `], inverse: true, bold: true })]
      : [...dot, Text({ children: [label], dimColor: !word }), ...(count == null ? [] : [Text({ children: [` ${count}`], dimColor: true })])] })
  }
  const colorOf = (category: string) => PALETTE.categories[categoryIndex(category, cats)]
  const shownRows = matches(allRows, st.query, st.category, st.favorites)
  const parts = groupRows(shownRows, st.favorites, lastUsedNames(st.flows), !st.category)
  const view = (r: TemplateRow) => async () => {
    const path = viewPath((await files.home()) ?? '', r)
    if (!path) { say('error', 'This template has no file to view. Press Refresh.'); return redraw() }
    await viewTemplate(path)
  }
  // Remove asks twice: the first press asks, the second removes. The next tick takes the question back.
  const remove = (r: TemplateRow) => Button({ key: `tpl-remove-${r.key}`, label: st.sure === `tpl:${r.key}` ? 'Sure?' : 'Remove', plain: true, onPress: () => { if (st.sure === `tpl:${r.key}`) return templateJob(ports => removeTemplate(ports, r)); askAgain(`tpl:${r.key}`); redraw() } })
  // One template: its name without the category, "update available" only when it matters, two lines of purpose, its buttons.
  const item = (r: TemplateRow, edge?: string) => (k ? (key: string, children: unknown[]) => k.card(key, children, { edge: edge ?? colorOf(r.category) }) : card)(`tcard-${r.key}`, [
    Box({ flexDirection: 'row', columnGap: 1, children: [
      star(r.key, `fav-${r.key}`), line(r.title, { bold: true }),
      ...(r.state === 'update' ? [k ? k.pill('update available', HEX.waiting) : line('update available', { dimColor: true })] : []),
    ] }),
    ...(r.steps != null ? [line(`${r.steps} steps`, { dimColor: true })] : []),
    ...(narrow || !r.purpose ? [] : [line(r.purpose.length > 170 ? `${r.purpose.slice(0, 169)}…` : r.purpose, { dimColor: true })]),
    Box({ flexDirection: 'row', columnGap: 1, children: [
      ...(r.template ? [start(r)] : []), ...(r.entry && r.state !== 'installed' ? [install(r)] : []),
      k ? k.action(`template-${r.key}`, 'Details', view(r)) : Button({ key: `template-${r.key}`, label: 'Details', variant: 'secondary', onPress: view(r) }),
      ...(r.state !== 'available' ? [remove(r)] : []),
    ] }),
  ])
  // A group title in its color: a hex on Desktop, a theme word in the terminal.
  const header = (title: string, hex: string, key: string) => (k ? k.heading(title, hex) : line(title, { bold: true, color: key }))
  const section = (title: string, rows: TemplateRow[], hex: string, key: string, category?: string) => rows.length ? [header(title, hex, key), ...(k ? [k.stack(rows.map(r => item(r, hex)))] : rows.map(r => item(r)))] : []
  const missingOpen = st.showMissing || !!st.query
  const synced = Math.max(0, ...st.markets.map(m => (m.lastSynced ? Date.parse(m.lastSynced) : 0) || 0))
  return [
    ...(st.flows.length ? [] : [line('Pick a template. Claude runs it and stops for your approval at gates.', { dimColor: true })]), // a hint for a first run
    Input({ key: 'search', placeholder: 'Search by name, category or purpose', value: st.query, onInput: (text: string) => { st.query = text; redraw() }, onSubmit: (text: string) => { st.query = text; redraw() } }),
    ...(st.query ? [Button({ key: 'search-clear', label: '× Clear the search', plain: true, dimColor: true, onPress: () => { st.query = ''; redraw() } })] : []),
    Box({ flexDirection: 'row', columnGap: narrow ? 1 : 2, flexWrap: 'wrap', children: [
      chip('cat-all', 'All', undefined, PALETTE.neutral), chip('cat-fav', '★ Favorites', FAVORITES, PALETTE.favorites, 'warning', st.favorites.size || undefined),
      ...cats.map(c => chip(`cat-${c}`, c, c, colorOf(c), CATEGORY_KEYS[categoryIndex(c, cats)], narrow ? undefined : allRows.filter(r => r.category === c).length)),
    ] }),
    line(' '),
    // One quiet line: how many match and how old the list is, with Refresh at the far end.
    Box({ flexDirection: 'row', columnGap: 2, justifyContent: 'space-between', children: [
      line(`${st.query || st.category ? `${shownRows.length} of ${allRows.length}` : allRows.length} templates${synced ? `  ·  synced ${ago(synced, Date.now())}` : ''}`, { dimColor: true }),
      Button({ key: 'tpl-refresh', label: st.busy === 'refresh' ? 'Refreshing…' : '↻ Refresh', plain: true, onPress: () => templateJob(async ports => { const lines = await refreshMarketplaces(ports); noteRefresh(lines); return lines.join('\n') }, 'refresh') }),
    ] }),
    line(' '),
    ...(shownRows.length ? [
      ...section('★ Favorites', parts.favorites, PALETTE.favorites, 'warning'), ...section('Last used', parts.last, PALETTE.last, 'suggestion'),
      ...parts.groups.flatMap(g => section(st.category === FAVORITES ? '★ Favorites' : g.category, g.rows, st.category === FAVORITES ? PALETTE.favorites : colorOf(g.category), st.category === FAVORITES ? 'warning' : CATEGORY_KEYS[categoryIndex(g.category, cats)])),
      ...(parts.missing.length ? [
        Button({ key: 'fold-missing', label: `${missingOpen ? '▾' : '▸'} Not installed ·${parts.missing.length}`, plain: true, onPress: () => { st.showMissing = !st.showMissing; redraw() } }),
        ...(missingOpen ? (k ? [k.stack(parts.missing.map(r => item(r)))] : parts.missing.map(r => item(r))) : []),
      ] : []),
    ] : [line(st.category === FAVORITES && !st.favorites.size ? 'No favorite yet. Press ☆ next to a template.' : allRows.length ? 'No template matches. Clear the search or press All.' : (st.markets.length ? 'No template yet. Press Refresh to read the marketplaces.' : 'No marketplace yet. Open the Sources tab, then press Add marketplace, to get templates.'), { dimColor: true })]),
  ]
}

export async function formScreen(c: Ctx): Promise<unknown[]> {
  const { Box, Button, Input, card, files, fill, handOff, k, line, narrow, ports, redraw } = c
  const template = st.chosen!
  const create = async () => handOff(await startFlow(ports(), template, st.values), `Started ${template.name}`)
  const missing = missingFields(template, st.values)
  const d = await templateDetail(files, template.path)
  const asks = d ? d.steps.filter(s => s.approval).length : 0
  const purpose = d?.purpose ?? ''
  // The header: name, category, the purpose (cut at 170 characters until Show more), a row for each step ("asks you" on an approval step).
  const long = purpose.length > 170
  const headBody = [
    Box({ flexDirection: 'row', columnGap: 1, children: [line(template.name, { bold: true }), ...(k ? [k.pill(template.category, HEX.waiting)] : [line(`(${template.category})`, { dimColor: true })])] }),
    ...(purpose ? [line(long && !st.purposeOpen ? `${purpose.slice(0, 169)}…` : purpose, { dimColor: true })] : []),
    ...(long ? [Button({ key: 'purpose-more', label: st.purposeOpen ? 'Show less' : 'Show more', plain: true, onPress: () => { st.purposeOpen = !st.purposeOpen; redraw() } })] : []),
    ...(d ? d.steps.map(s => Box({ key: `step-${s.number}`, flexDirection: 'row', columnGap: 1, children: [line(String(s.number), { bold: true }), line(s.name), ...(s.approval ? [k ? k.pill('asks you 🔒', HEX.waiting) : line('🔒 asks you', { color: 'warning' })] : [])] })) : []),
  ]
  const heading = (title: string, hex: string, key: string) => (k ? k.heading(title, hex) : line(title, { bold: true, color: key }))
  // A field: the label with a star (or "optional"), a mark when Claude filled it, the hint, then the input at full width. Enter in the field creates.
  // When Claude would change a field the user typed, Claude's text shows under it with Replace and Keep.
  const field = (f: (typeof template.fields)[number]) => Box({ key: `fld-${f.name}`, flexDirection: 'column', children: [
    Box({ flexDirection: 'row', columnGap: 1, children: [
      line(f.name, { bold: true }), f.required ? line('*', { color: 'warning' }) : line('optional', { dimColor: true }),
      ...(st.filled.has(f.name) ? [line('✦ from your text', { dimColor: true })] : []),
      ...(st.openFields.includes(f.name) && !st.values[f.name]?.trim() ? [line('not in your text', { color: 'warning' })] : []),
    ] }),
    ...(f.description && !narrow ? [line(f.description, { dimColor: true })] : []),
    Input({
      key: `field-${f.name}`, placeholder: f.example ? `e.g. ${f.example}` : f.description,
      value: st.values[f.name] ?? '',
      onInput: (text: string) => { const was = missingFields(template, st.values).length; st.values[f.name] = text; st.filled.delete(f.name); if (missingFields(template, st.values).length !== was) redraw() }, // redraw only when the hint changes
      submitLabel: 'Enter ↵', onSubmit: async (text: string) => { st.values[f.name] = text; await create() },
    }),
    ...(st.offers[f.name] ? [Box({ flexDirection: 'row', columnGap: 1, children: [
      line(`Claude: ${st.offers[f.name].length > 60 ? `${st.offers[f.name].slice(0, 59)}…` : st.offers[f.name]}`, { dimColor: true }),
      Button({ key: `replace-${f.name}`, label: 'Replace', plain: true, onPress: () => { st.values[f.name] = st.offers[f.name]; st.filled.add(f.name); delete st.offers[f.name]; redraw() } }),
      Button({ key: `keep-${f.name}`, label: 'Keep mine', plain: true, onPress: () => { delete st.offers[f.name]; redraw() } }),
    ] })] : []),
  ] })
  // Describe it: one free text above the fields. Enter in it asks Claude to fill them (the fork of this session knows what was talked about).
  const describe = Box({ key: 'fld-describe', flexDirection: 'column', children: [
    Box({ flexDirection: 'row', columnGap: 1, children: [line('Describe it', { bold: true }), line('optional', { dimColor: true })] }),
    ...(narrow ? [] : [line('Tell Claude what you want. It fills the fields below.', { dimColor: true })]),
    Input({
      key: 'describe', placeholder: 'e.g. a template for payflow feature work, used for PR reviews', value: st.describe, autoFocus: true,
      onInput: (text: string) => { st.describe = text; redraw() }, // the frame below shows all of it
      submitLabel: st.busy === 'fill' ? 'Filling…' : 'Fill ✦', onSubmit: async (text: string) => { st.describe = text; await fill(template, purpose, text) },
    }),
    // The field is one line in Claude Code, so a frame five lines tall shows the whole text wrapped.
    Box({ key: 'describe-text', flexDirection: 'column', minHeight: 5, borderStyle: 'round', borderColor: 'inactive', paddingLeft: 1, paddingRight: 1, children: [line('Your text', { dimColor: true }), line(st.describe || ' ')] }),
  ] })
  const fields = template.fields.map(field)
  // Above Create: what is left, or "ready".
  const hint = missing.length ? line(`${missing.length} field${missing.length === 1 ? '' : 's'} left: ${missing.join(', ')}`, { color: 'warning' }) : line('ready', { color: 'success' })
  const actions = Box({
    flexDirection: 'column', children: [hint, Box({
      flexDirection: 'row', columnGap: 3,
      children: [
        k ? k.action('create', 'Create', create, 'go') : Button({ key: 'create', label: 'Create', dimColor: missing.length > 0, onPress: create }), // a press with a field empty still says what is missing
        Button({ key: 'back', label: 'Back', plain: true, onPress: () => { st.chosen = undefined; st.purposeOpen = false; st.message = ''; redraw() } }),
      ],
    })],
  })
  const blocks = [
    heading('What runs', '#9aa3b8', 'inactive'), k ? k.card('form-head', headBody) : card('form-head', headBody),
    heading('What you give', PALETTE.favorites, 'warning'), ...(k ? [k.stack([describe, ...fields])] : [describe, ...fields]), actions,
  ]
  return k ? [k.stack(blocks)] : blocks.flatMap(b => [b, line(' ')])
}
