# U02 · Shell: navigation, panes, project folders

> Status and result live in `../progress.html` (entry `U02`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/zeremai` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. The UI app is a window with a sidebar and six screens. In the mod, screens are panes opened by commands. This item decides how a user moves between the screens, how many panes are open at once, and what replaces the project folder list.

## 2. What exists today
- `../agentic-flows-ui/src/components/Layout/Sidebar.tsx` (162 lines): six nav buttons: Dashboard, Flows Overview, Templates, Marketplace, Agent Sessions, Settings; a badge for flows that need attention; a loading mark; a collapse button.
- `../agentic-flows-ui/src/App.tsx` (408 lines): screen state, the list of project working directories (a folder picker: "Click the folder icon to add a project"), update banner, toasts, error boundary.
- Hooks: `useFlows` (reads all flows under the runtime folder, filtered by project), `usePendingInteractions` (the attention badge), `useSettings`.
- The mod today: one command `/zeremai` opens one pane with three tabs: New, Continue, Templates (`on-flow-pane.ts`). The Marketplace is part of the Templates tab (P09). The attention signal is the step line under the prompt (P11).

## 3. First guess (step 3, not final)
- Verdict: replace
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. Tabs in one pane, or several panes (the pane title is a tab when more than one is open)? What does `$.ui.open` with several ids do to focus, width and the `Ctrl+X` keys?
2. One command `/zeremai` with tabs, or a command for each screen (`/zeremai`, `/templates`, `/sessions`)? What does `$.command.register` allow (names, `argumentHint`, `immediate`)?
3. Where does a badge for "a flow needs you" go: a tab label, the band above the prompt (`AbovePrompt`), the step line? What is the cost of a band that every mod shares?
4. Does the mod need a project list? The session has a working folder (`$.session.cwd()`, `$.session.root()`). Is filtering by project still wanted, and where is the choice kept (`$.store`, `$.state`)?
5. What happens to the pane after `/clear`, `/resume` and `/branch` (`$.state` resets; module variables survive)? Which state must be saved where?
6. How does a user open the pane without typing a command (a hotkey, a button in the band)? Is a pane opened by the mod itself allowed in a narrow terminal (144 and 110 column rules)?

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

## 6. Out of scope
No implementation. No plugin edits. Do not edit the UI app. Do not change the JSON file shapes without saying so in the result (the UI app is obsolete, so they are free to change, but a later plan decides). Only `U01` may build a throwaway mod, outside this repo.

## 7. Research result
Claude Code version: 2.1.296 (docs read: mods `interface`, `api`, `reference`; the type file was not read, no spike was run). Owner decisions from the visual plan (`U02` page, answers pasted 2026-10-10): dashboard and overview are **not migrated**; the UI is scoped to one flow once a flow is bound; before that the pane shows New / Continue / Templates; the button above the prompt shows **always**.

### Answers to section 4
1. **Tabs or panes.** One pane with tabs (owner kept the default). Several open panes would each get a tab with its title only (`interface`, "Pick where to draw"), so the mod cannot put a badge on it or order it. `$.ui.open` fields: `id`, `title`, `focus`, `closeOnEscape`, `holdToasts`, `rows`, `columns`. Keys while a pane has focus: Tab, arrows, Enter, button hotkeys, Ctrl+X then arrow resizes, Ctrl+X then X closes, Esc returns to the prompt. A mod cannot rebind Tab or arrows.
2. **Commands.** One `/zeremai` command. A first word that is a tab name (`new`, `continue`, `templates`) opens that tab; any other word is the first field, as today. `$.command.register` takes `name`, `description`, `argumentHint`, `immediate`. Code: `hooks/on-flow-pane/on-flow-pane.ts:105`, `hooks/on-flow-tools/on-flow-tools.ts:70`.
3. **Badge.** Three signals: the step line under the prompt (stays, `hooks/infra/flow-pane/step-line.ts:5`); a count on the Continue tab (new `waitingCount`, app rule: step awaiting approval, failed or paused); a 4 second toast when a step starts to wait. The band above the prompt is shared by every mod: a tree replaces what later mods draw there unless the mod puts `await next(e)` inside its tree. Owner chose a button that is **always** shown, so it costs one screen row in every session and must keep `next(e)` among its children. The button has a digit hotkey that fires from an empty prompt (`reference#elements`).
4. **Project list.** Dropped. The session has a folder (`$.session.cwd()`); every mod-made flow stores it in `metadata.projectPaths` (`hooks/infra/flow-manager/create-flow.ts:97`). The Continue list shows "This folder" with one "All folders" switch. The choice is kept in `$.store` (key `allFolders`).
5. **After /clear, /resume, /branch.** `$.state` resets; module variables survive until the mod reloads; `$.store` lasts. `session.start` does not fire again, so copy saved values back in `classic.SessionStart` with `source` clear, resume or fork. Open tab: module variable. Folder switch: `$.store`. Lists: read from files each time the pane opens. **Open:** the link session to flow is saved under the session id; if /clear gives a new id, the pane shows the list and the step line loses the flow. Not tested (spike S02).
6. **Open without a command.** The always-shown band button with a digit hotkey. A pane opened by a user action (command, press) shows at any width; a pane the mod opens by itself (timer, `turn.start`) shows only from 144 columns, 110 after the user opened it once. So the mod never opens the pane by itself; it redraws and raises a toast.

### Answers to section 4b
- **S1.** `Sidebar.tsx` (162 lines): six icon buttons, badges for active, attention, running sessions and marketplace updates, a loading mark, a collapse button. `App.tsx` (408 lines): screen state, project folder list, update banner, toasts, error boundary.
- **S2.** Render site `Pane` (id `flow-pane`), tabs as plain `Button`s with hotkeys 1 to 3; band: `AbovePrompt`. Terminal: tab row, text badge. Desktop: sidebar rail drawn with `Svg` icons, `Box` `hover`, a dot badge (the owner chose a Desktop rail). Check `e.surface`. Width from `e.props.bodyColumns`; short tab labels at about 52 columns or less.
- **S3.** No file watcher. The pane redraws after each flow tool call and from one `$.clock.every(5000, ...)` timer that calls `$.ui.invalidate('ui.render')`. Cost: redraw limit 10 a second (30 for the visible pane); a `$.fs.read` is limited to 4 MiB.
- **S4.** Dropped: Dashboard, Flows Overview (U06 can close as not needed), folder picker, collapse button (Ctrl+X and an arrow resize the pane). Not decided here: Agent Sessions (U08) and Settings (U10). Update banner, toasts, error boundary go to U11.
- **S5.** Verdict **replace** for the shell. A later plan must decide: tab list when U08 and U10 add screens; the band button's text and the row it takes; what the bound-flow view shows (U04, U05).

### Open questions and risks
- Does /clear keep the session id? Decides if the bound-flow view survives it (spike S02).
- What can `Client` draw on Desktop (a graph for U04)? Not tested.
- The band is always on: it takes one row in every session and competes with other mods.
- U01 is not done: the design here uses the current look.

### Implemented (2026-10-10, owner chose plan then build)
Built in the real mod, with the U01 card look. 246 tests pass (`claude plugin test .`), `claude plugin validate .` passes. Not yet seen in a running session by the owner.
- `hooks/infra/flow-pane/status-look.ts` (new): the status vocabulary (symbol, ASCII, word, theme key) and `stepKind`, `needsUser`.
- `hooks/infra/flow-pane/flow-pane.ts`: `listFlows` adds `kind` and `folders`; new `flowKind`, `inFolder`, `waitingCount`, `boundView`.
- `hooks/on-flow-pane/on-flow-pane.ts`: `/zeremai [new | continue | templates | first field]`; cards with status; Continue tab with the This folder / All folders switch (saved in the store as `allFolders`, read again after /clear, /resume, /branch); a waiting badge on the Continue tab; the bound-flow view with a Back to list button; a Desktop rail of `Svg` icons beside real tab buttons; short labels below 52 columns; the always-on button above the prompt (key 1); a 5 second timer that redraws and raises a toast when a flow starts to wait.
- `hooks/on-flow-tools/on-flow-tools.ts`: the command hint.
- Differences from the plan: the toast comes from the timer, not from the tool call (covers other sessions too); on Desktop the tab buttons stay next to the icons because an `Svg` cannot take a press; no ASCII switch yet.
- Open: key 1 on an empty prompt opens the pane, which may surprise someone who types a 1 as a prompt.


## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U02"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.
