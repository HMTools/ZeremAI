# U04 · Flow diagram and step details

> Status and result live in `../progress.html` (entry `U04`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/flow` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. Opening a flow in the app shows a step graph (React Flow): one node for each step with its status, side nodes for sub-flows, a parent node, and a substep graph. A click on a step opens a detail window. This is the main screen of the app and the hardest to move: a mod has no graph element.

## 2. What exists today
- `../agentic-flows-ui/src/components/DiagramView/index.tsx` (547 lines): the screen: diagram, right panel, agent panel, delete, lazy prompt shortcut (Shift+P).
- `FlowDiagram.tsx` (369): builds nodes and edges from `steps` and `subFlowState`; the parent node first, then steps in a line, sub-flows to the right of the step that spawned them; animated edges for running sub-flows; focus and zoom to a node.
- `StepNode.tsx` (173), `SubFlowNode.tsx` (207), `ParentFlowNode.tsx` (105), `SubstepFlowDiagram.tsx` (153), `SubstepNode.tsx` (91): node looks by status (completed, in progress, awaiting approval, skipped).
- `FlowStepDetailModal.tsx` (531): tabs Definition and Execution; sections Information Produced, Notes, Actions Taken, Agent Reasoning, User Interactions, Problems Encountered, Decisions Made, Files Modified; the view widget (dropped in P12).
- Libraries: `@xyflow/react`, `mermaid`.

## 3. First guess (step 3, not final)
- Verdict: replace
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. How is a step list drawn as a vertical timeline in the terminal (a `Box` column, connector characters, status symbols)? Draw it for 7 steps with one sub-flow.
2. What does the Desktop app gain from `Svg` (a real graph with arrows)? What limit applies (131,072 characters)? Can an `Svg` take clicks, or does it need `Client`?
3. Can `Client` draw an interactive graph with pan and zoom in both apps? What does it cost and what does it give up (no mods API inside it)?
4. Substeps: how are they shown for the active step (a nested list, an expanded row)?
5. Step detail: which sections fit a pane (`Markdown`, `Code`, collapsible `Box` rows), and how does a long list scroll (the pane scrolls as a whole)? Where do the detail sections get their data (`memory/*.json`, `log.json`)?
6. How does the diagram update while a step runs: the existing step line refresh (P11), a timer for the spinner, `$.state`?
7. Which of the diagram features are worth the cost: zoom, pan, minimap, animated edges? What is the smallest version that keeps the value?

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
Verdict: **replace**. Plan page answered 2026-10-10: a press on a sub-flow opens it (parent row to go back); the step detail is a view with Back and prev/next; Desktop draws a graph with zoom and pan in a `Client`.

Built (253 tests pass, `claude plugin validate .` passes):
- `hooks/infra/flow-pane/flow-pane.ts`: `boundView` adds the active step's substeps, the sub-flows under their step and the parent; new `stepDetail` joins the step definition with `memory/*.json` and `log.json`.
- `hooks/on-flow-pane/on-flow-pane.ts`: timeline rows are buttons; the detail view (tabs Definition and Execution, Back to steps, prev and next); sub-flow and parent navigation; a `ui.message` hook for presses on graph nodes; on Desktop a Graph / Timeline toggle.
- `hooks/on-flow-pane/graph-view.ts` (new `Client` surface module): nodes are absolute `Box`es with borders and hover, connectors are text, drag moves the view, `+` and `-` switch two sizes, a press posts the step or the sub-flow to open. `layout` and `hit` are pure and tested.

Open: the graph has not been seen on a real Desktop (negative offsets of absolute boxes, drag capture). Zoom is two sizes, no minimap, no animated edges. Shift+P (lazy prompt) goes to U09, the agent panel to U08. The Memory, Logs and Files screens are U05.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U04"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.
