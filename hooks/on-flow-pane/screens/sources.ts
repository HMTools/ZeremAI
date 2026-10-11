import { addMarketplace, refreshMarketplaces, removeMarketplace, toggleMarketplace, updateMarketplace } from '../../infra/templates/templates'
import type { MarketplaceFields } from '../../infra/templates/templates'
import { ago } from '../../infra/flow-pane/activity'
import { HEX } from '../../infra/flow-pane/rich'
import { askAgain, noteRefresh, st } from '../pane-state'
import type { Ctx } from '../ctx'

export async function sourcesScreen(c: Ctx): Promise<unknown[]> {
  const { Box, Button, Input, card, k, line, ports, redraw, templateJob } = c
  const now = Date.now()
  // Each source is a card: the name and a state pill, the address and branch, the templates and age. A failed refresh shows its error in red.
  const shortUrl = (url: string) => url.replace(/^(https?|ssh):\/\//, '').replace(/\.git$/, '')
  const marketplaces = st.markets.map((m, i) => {
    const error = st.sourceErrors[m.name]
    const state = error ? 'ERROR' : m.enabled ? 'ON' : 'OFF'
    const hex = error ? HEX.failed : m.enabled ? HEX.running : HEX.pending
    const facts = m.cached ? `${st.entries.filter(e => e.marketplace === m.name).length} templates${m.lastSynced ? `  ·  synced ${ago(Date.parse(m.lastSynced), now)}` : ''}${m.priority === 100 ? '' : `  ·  priority ${m.priority}`}` : 'not refreshed'
    const children = [
      Box({ flexDirection: 'row', columnGap: 1, children: [line(m.name, { bold: true, dimColor: !m.enabled }), k ? k.pill(state, hex) : line(state.toLowerCase(), { color: error ? 'error' : m.enabled ? 'success' : 'inactive' })] }),
      line(`${shortUrl(m.url)}  ·  ${m.branch || 'main'}`, { dimColor: true }),
      line(facts, { dimColor: true }),
      ...(error ? [line(`✕ ${error}`, { color: 'error' })] : []),
      // The quiet words. Remove deletes the cache: the first press asks, the second removes.
      Box({ flexDirection: 'row', columnGap: 2, paddingTop: k ? 1 : 0, children: [
        Button({ key: `mk-toggle-${i}`, label: m.enabled ? 'Turn off' : 'Turn on', plain: true, dimColor: true, onPress: () => templateJob(ports => toggleMarketplace(ports, m.name)) }),
        Button({ key: `mk-edit-${i}`, label: 'Edit', plain: true, dimColor: true, onPress: () => { st.form = { original: m.name, values: { name: m.name, url: m.url, branch: m.branch, priority: String(m.priority) } }; st.message = ''; redraw() } }),
        Button({ key: `mk-remove-${i}`, label: st.sure === m.name ? 'Sure?' : 'Remove', plain: true, dimColor: st.sure !== m.name, onPress: () => { if (st.sure === m.name) return templateJob(ports => removeMarketplace(ports, m.name)); askAgain(m.name); redraw() } }),
      ] }),
    ]
    return k ? k.card(`mk-${i}`, children, { edge: hex }) : card(`mk-${i}`, children, !!error)
  })
  // A field like on the Start form: the label with a star (or optional), the hint, then the input.
  const fields: [keyof MarketplaceFields, string, boolean, string][] = [['name', 'name', true, 'shown in the list'], ['url', 'git address', true, 'https://, ssh://, git@host: or a local path'], ['branch', 'branch', false, 'default: main'], ['priority', 'priority', false, 'default: 100']]
  const field = ([key, label, required, hint]: (typeof fields)[number], i: number) => Box({ key: `mk-fld-${key}`, flexDirection: 'column', children: [
    Box({ flexDirection: 'row', columnGap: 1, children: [line(label, { bold: true }), required ? line('*', { color: 'warning' }) : line('optional', { dimColor: true })] }),
    line(hint, { dimColor: true }),
    Input({
      key: `mk-field-${key}`, value: st.form!.values[key], ...(i === 0 ? { autoFocus: true } : {}),
      onInput: (text: string) => { st.form!.values[key] = text },
      submitLabel: '↵', onSubmit: async (text: string) => { st.form!.values[key] = text; await save() }, // the engine always draws this button; a bare Enter sign says what it is without a second Save
    }),
  ] })
  const editorBody = st.form && [
    Box({ flexDirection: 'column', children: fields.map(field) }),
    Box({ flexDirection: 'row', columnGap: 3, children: [
      k ? k.action('mk-save', 'Save', save, 'go') : Button({ key: 'mk-save', label: 'Save', onPress: save }),
      Button({ key: 'mk-cancel', label: 'Cancel', plain: true, dimColor: true, onPress: () => { st.form = undefined; st.message = ''; redraw() } }),
    ] }),
  ]
  const editor = st.form && [
    k ? k.heading(st.form.original ? `Edit ${st.form.original}` : 'Add a marketplace', '#9aa3b8') : line(st.form.original ? `Edit ${st.form.original}` : 'Add a marketplace', { bold: true }),
    ...(k ? [k.card('mk-form', editorBody!)] : editorBody!),
  ]
  const refresh = () => templateJob(async ports => { const lines = await refreshMarketplaces(ports); noteRefresh(lines); return lines.join('\n') }, 'refresh')
  const add = () => { st.form = { values: { name: '', url: '', branch: '', priority: '' } }; st.message = ''; redraw() }
  async function save() {
    const f = st.form!
    await templateJob(async ports => { await (f.original ? updateMarketplace(ports, f.original, f.values) : addMarketplace(ports, f.values)); st.form = undefined })
  }
  const errors = Object.keys(st.sourceErrors).filter(name => st.markets.some(m => m.name === name)).length
  const top = Box({ flexDirection: 'row', columnGap: 2, flexWrap: 'wrap', children: [
    k ? k.action('tpl-refresh', st.busy === 'refresh' ? 'Refreshing…' : '↻ Refresh', refresh, 'go') : Button({ key: 'tpl-refresh', label: st.busy === 'refresh' ? 'Refreshing…' : 'Refresh', onPress: refresh }),
    k ? k.action('mk-add', '+ Add marketplace', add) : Button({ key: 'mk-add', label: 'Add marketplace', onPress: add }),
    line(`${st.markets.length} source${st.markets.length === 1 ? '' : 's'}${errors ? `  ·  ${errors} error${errors === 1 ? '' : 's'}` : ''}`, { dimColor: true }),
  ] })
  return editor ?? [
    top,
    line(' '),
    ...(st.markets.length ? [] : [line('No source yet. Press Add marketplace and give a git address.', { dimColor: true })]),
    ...(k ? [k.stack(marketplaces)] : marketplaces),
  ]
}
