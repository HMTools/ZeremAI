# U06 · Flows overview: tiles, tree, condensed diagrams

> Status and result live in `../progress.html` (entry `U06`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/zeremai` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. The overview is a second window for many flows at once: a grid of tiles, each with a small diagram, a flow tree and a count of the flows that need attention. It exists for a person who runs several flows in parallel. A mod lives inside one session, so this screen may not fit.

## 2. What exists today
- `FlowsOverview/index.tsx` (207), `TileManager.tsx` (373): layout presets, resize, auto-shrink of the layout, a request queue for focusing a tile; a pop-out into an external window (`overview-window.html`, `src/components/OverviewWindow`).
- `FlowTree.tsx` (182), `FlowTreeItem.tsx` (94): a tree of parents and children.
- `CondensedDiagram.tsx` (260): a small diagram with live memory and log updates for each tile.
- A context menu for each tile; an attention count from pending approvals.

## 3. First guess (step 3, not final)
- Verdict: later
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. Does one session need to see many flows? The session binds one flow folder at a time (parent then child). Is the use case really several sessions at once?
2. Can one pane show a compact list or a tile grid of flows (`Box` rows and columns)? How many tiles fit at 100 and 144 columns?
3. Can a mod see other sessions? Check `$.session.send`, `$.store` shared by sessions, and `session.attach`. What would an overview pane read, and from where?
4. Is the attention count better as a message in the band above the prompt than as a screen?
5. What would stay in the Electron app if a window outside the terminal is a must (a pop-out, a second monitor)?
6. Verdict: is `later` right, or is a small list inside the dashboard (U03) enough?

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
Flows overview not migrated (owner, 2026-10-10): the dashboard and overview are out of scope. See U02 claim 1.1.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U06"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.
