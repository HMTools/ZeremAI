# U01 · Look and feel of the mod UI

> Status and result live in `../progress.html` (entry `U01`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/zeremai` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. The mod draws its screens with a few elements. Today the flow pane is lines of text and bracket buttons, and it looks plain next to the UI app, which has cards, status colors and a dark IDE theme. The owner wants the mod UI to look more like a GUI. This item sets the design language that U02 to U11 use. It is the first item of the UI phase.

## 2. What exists today
- The current pane: `hooks/on-flow-pane/on-flow-pane.ts` (~230 lines; three tabs as plain buttons; flow, template and marketplace rows as `Button` and `Text`) and `hooks/infra/flow-pane/step-line.ts`. No `borderStyle`, no `backgroundColor`, no padding.
- The app look: Tailwind v4 with a dark theme, status colors for flow and step states (`../agentic-flows-ui/src/components/Dashboard/FlowCard.tsx:107-108` uses `bg-status-completed`, `bg-status-failed`), cards, a sidebar, modals.
- What the mods API offers (reference, v2.1.290): `Box` with flex layout, `gap`, `padding`, `margin`, `width`, `height`, `borderStyle` (10 names, `round` among them), `backgroundColor`, `position`, `hover`; `Text` with `color` (a theme key or a color), `bold`, `dimColor`, `inverse`; `Button` with `hotkey`, `plain`; `Markdown`, `Code`, `Link`, `Input`, `Select`; `Svg` (Desktop only); `Raster` and `Image` (terminal only); `Client` (a second file that draws and takes pointer input, both apps).
- Panes: `placement` is `dock` (beside the transcript in a wide fullscreen terminal) or `inline` (above the prompt). Width is `e.props.bodyColumns`; a pane grows with its tree up to a limit; Ctrl+X and arrows resize it.

## 3. First guess (step 3, not final)
- Verdict: improve
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. Which `Box` props make a card (border, padding, background, `hover`) and which render the same in the terminal and the Desktop app? Make a table.
2. What are the theme color keys, and do they read in both dark and light? Which colors are safe? (A color is a theme key or a name such as `'red'`.)
3. What status vocabulary works without color alone: symbols and words for running, completed, failed, paused, awaiting approval, skipped, pending? Give an ASCII fallback.
4. How wide must a card be, and what happens at 60, 100 and 144 columns (dock versus inline placement, `bodyColumns`)? What is the smallest terminal that gets the card layout?
5. How does navigation look: tabs as buttons, a sidebar column, hotkeys? What is the focus order (Tab, arrows, hotkey rules)?
6. What can `Client` do that elements cannot (animation, pointer input, own drawing)? Can it draw a graph? Does it work in both apps? What does a failed `Client` show (`ui.fault`)?
7. What do `Raster` and `Image` add in the terminal (a progress bar, a sparkline), and what does the Desktop app get instead (`Svg`)?
8. What do animation and live updates cost: the redraw throttle (10 a second, 30 for the visible pane), `$.clock.every`, `$.state` against `invalidate`?
9. Produce mocks (HTML in the result or in a file next to the item) of three screens: the flow list, a step detail, and the templates list, at 60 and 100 columns, in the terminal look and in the Desktop look.
10. Which surfaces cannot draw (VS Code panel, `claude -p`, WSL Desktop)? What is the text fallback (`$.ui.log`, a command that returns `{ text }`)?

## 4b. Shared questions (every U item answers these, for the terminal and for the Desktop app)
S1. What does the app screen do today? (files, sizes, behaviour in plain words; a screenshot if the app can run.)
S2. What draws it in the mod? Name the render site (`Pane`, `AbovePrompt`, ...), the elements and their props. Say what works in the terminal alone and what the Desktop app adds (`Svg`, `hover`). The terminal design must work alone.
S3. How does the screen learn of a change? A mod has no file watcher: use the flow tool calls, `$.clock.every`, or an event. Give the cost (redraw limit 10 a second, 4 MiB file read).
S4. What stays outside the mod, or is dropped? Say why.
S5. Verdict (`replace`, `improve`, `keep`, `later`) and what a later plan must decide.
Apply the design result of `U01` (look and feel) to every answer. If `U01` is not done yet, answer for the current look and mark it.

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`): `interface` (panes, `$.ui.open`, keyboard focus, state), `reference#elements` and `#render-sites`, and `gallery` (element samples). Check each prop you rely on in the type file.
2. Read the app files listed in section 2. The app has no screenshots in the repo: if you need one, run `npm run dev` in `../agentic-flows-ui` (the owner can run it and paste a picture).
3. Read the current mod pane for comparison: `hooks/on-flow-pane/on-flow-pane.ts` and `hooks/infra/flow-pane/flow-pane.ts`.
4. Answer the questions in section 4 and 4b under "7. Research result".
5. Build one throwaway mod `ui-look-spike` in `../ui-look-spike` (outside this repo, deleted after the report). It draws the card list from the mocks with fake data on a `/look` command. The owner runs it with `claude --plugin-dir ../ui-look-spike` and judges the look in the terminal. Record what the owner said.

## 6. Out of scope
No implementation. No plugin edits. Do not edit the UI app. Do not change the JSON file shapes without saying so in the result (the UI app is obsolete, so they are free to change, but a later plan decides). Only `U01` may build a throwaway mod, outside this repo. The throwaway mod is allowed here (and only here in the U group).

## 7. Research result
Claude Code version: 2.1.296 (type file of build 2.1.295 read; docs `interface`, `reference`). Spike `ui-look-spike` built and run by the owner (`/look`, fake data). **Owner said: it works, and it looks good.** The owner ran it in the Claude Code app; no other feedback was given, so the terminal-only look and the exact widths were not judged separately.

### Design language (what the spike drew)
- **Card:** `Box` with `borderStyle="round"`, `paddingLeft/Right={1}`, `borderColor` by state (`warning` for waits, `inactive` otherwise), a keyed Box with `hover={{ borderColor: 'claude' }}`. Inside: status symbol + bold name + status word, a dim line `step 3 of 6 · 2 min ago`, a bar `█████░░░`.
- **Tabs:** plain `Button`s with digit hotkeys, `dimColor` for the inactive tab, a count on Continue.
- **Desktop only:** `Svg` icon rail beside the content (`alt` required, `width`, `height`, optional `isInteractive` for hover and tooltips). The terminal draws the tab row alone.
- **Width:** read `e.props.bodyColumns`. Below about 52 columns: short tab labels, no bar, short step text. A footer in the spike shows surface, columns and mode.

### Answers to section 4
1. **Card props.** `Box`: flex layout, `columnGap`, `padding*`, `margin`, `width`, `height`, `borderStyle` (single, double, round, bold, singleDouble, doubleSingle, classic, arrow, dashed, quote), `borderColor`, `backgroundColor`, `position`, `hover`. `hover` may change `borderStyle`, `borderColor`, `backgroundColor` and offsets, never the layout; it needs a keyed `Box` (or a `scope`). Text `hover` is refused outside a keyed Box. Used and seen to render: round border, `borderColor`, `hover`, padding. A table of terminal against Desktop for every prop was not built; only the props above were seen.
2. **Colors.** A color is a theme key or a name. Theme keys: text, inverseText, inactive, subtle, suggestion, remember, success, error, warning, merged, claude, permission, planMode, autoAccept, promptBorder, bashBorder, ide, diffAdded, diffRemoved (+ dimmed and word variants). A theme key follows the user's theme, so it is the safe choice; raw hex or names do not. The spike used only theme keys and the owner saw no problem; dark and light were not both checked.
3. **Status vocabulary (symbol, ASCII, word, theme key):** waits `▲ ! waits for you warning`; running `● * running success`; done `✓ v done inactive`; failed `✕ x failed error`; paused `‖ = paused permission`; pending `○ o pending inactive`. Symbol plus word, so color is never the only signal. The `a` key in the spike switches to the ASCII set. Skipped is not drawn yet: use `–` and "skipped".
4. **Widths.** `bodyColumns` is the width. A dock pane is beside the transcript in a wide fullscreen terminal; otherwise it is inline above the prompt. The spike handles two modes (about 52 columns is the switch). 60, 100 and 144 columns were not tested one by one.
5. **Navigation.** Tabs as `Button`s with hotkeys 1 to 4 (worked). Tab and arrows move focus; they cannot be rebound. A sidebar column is Desktop only (`Svg` rail). See U02.
6. **`Client`.** Not tried. The docs list it for both apps (own drawing, pointer input, a failed `Client` raises `ui.fault`). Whether it can draw a graph is **open**.
7. **`Raster` and `Image`.** Not tried. Terminal only. The Desktop app has `Svg` instead.
8. **Cost.** Redraw limit 10 a second, 30 for the visible pane; `$.ui.invalidate('ui.render')` or `$.state` writes redraw; a timer with `$.clock.every` is needed because a mod has no file watcher.
9. **Mocks.** Replaced by the running spike. HTML mocks at 60 and 100 columns were not made.
10. **Surfaces that cannot draw:** VS Code panel and `claude -p` (reading list, Overview). Fallback: `$.ui.status`, `$.ui.log`, or a command that returns `{ text }`. `e.surface` is `terminal`, `desktop`, `vscode` or `mobile`.

### Gotchas found by running it (these cost a debug round)
- A prop an element does not take makes the engine refuse the **whole tree** and draw its own, so the pane is blank. Seen: `key` on `Text` (Text has no `key`; `Box`, `Button` do).
- A transcript line names the refusal: `<plugin>: ui.render (Pane) refused: <reason>; the engine drew its own`.
- Give every `Button` an `onPress` (the spike's Approve button had none; fixed before the owner's final run, so whether it was required is unknown).
- Write the module as `.tsx` and take elements from `$.ui.resolve(e)`.

### Verdict and later plan
Verdict **improve**: the flow pane stays and gets the card look, status vocabulary and a Desktop rail. A later plan must decide: the final card content; a light-theme check; whether `Client` is worth a spike for the step diagram (U04); where the status vocabulary lives (one shared helper); an ASCII fallback switch.

### Open questions
- `Client` capability (graph, animation) on both apps.
- Light theme and Desktop-against-terminal differences per prop.
- 60, 100 and 144 column behaviour.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U01"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.
