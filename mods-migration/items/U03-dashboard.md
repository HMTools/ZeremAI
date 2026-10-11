# U03 · Dashboard: flow list, filters, cards

> Status and result live in `../progress.html` (entry `U03`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/zeremai` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. The dashboard is the app's home screen: every flow, filtered by status, as a tree or a flat list. The mod's Continue tab lists only the active flows as one line each (P04). This item studies what the full list needs.

## 2. What exists today
- `../agentic-flows-ui/src/components/Dashboard/index.tsx` (344 lines): filter tabs All, Active, Completed, Failed (default Active); a toggle to show errors; a hierarchy view (parent and child flows, expand and collapse) and a flat view.
- `../agentic-flows-ui/src/components/Dashboard/FlowCard.tsx` (196 lines): a status dot (completed, failed, running), the name, step progress, a "Herdr connected" badge, a button "Kill external flow and resume in this app", a delete button with a confirmation dialog.
- `../agentic-flows-ui/electron/fileWatcher.ts` (184 lines): chokidar polling every 1 s over `active/`, `completed/`, `failed/`; parsed JSON goes to the screen.
- The mod today: `listFlows` in `hooks/infra/flow-pane/flow-pane.ts` reads `active/` only and shows name, step, time.

## 3. First guess (step 3, not final)
- Verdict: replace
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. Which fields does a card need, and which come from `flow.json` (`status`, `steps`, `currentState`, `subFlowState`, `metadata`)? Draw one card at 60 and 100 columns.
2. How are completed and failed flows read, and how many folders can the pane read for one redraw (4 MiB per file, 10 s per hook)? Is paging or a limit needed?
3. How is the parent and child tree drawn with elements (indent, connectors, expand and collapse state)?
4. Delete: the app removes a flow folder after a confirmation. A mod cannot delete with `$.fs`. Is it `$.flow.run` with a plain-name check (as in P09), and is a two-press button enough?
5. How does the list refresh without a watcher: after each flow tool call, after a timer, on pane open? What does a stale list cost the user?
6. Resume: the card button should resume a flow. P04 already does this from the Continue tab. What changes when the flow is in `completed/` or `failed/`?
7. Sort order, search, and a status filter: which of these are `Select` or `Input`, and which are hotkeys?

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
Dashboard not migrated (owner, 2026-10-10): the mod UI is scoped to one flow once bound; before that the pane shows New / Continue / Templates (see U02). The flow list with a waiting badge and a folder switch is covered by U02 claims 1, 3 and 4. The bound-flow view is filled by U04 and U05.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U03"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.
