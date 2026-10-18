# P12 · View widgets and the UI app

> Status and result live in `../progress.html` (entry `P12`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

> **Scope warning**: the owner decided the UI move is a **later project** ("UI inside the session"). The research here is only a **map**: how the UI works today, and what the later round must study. Do not try to design the later UI. First guess is `later`.

## 1. Context (no previous knowledge needed)
`zeremai` (v2.0.28) runs resumable workflows ("flows") whose state sits in JSON files under `~/.claude/zeremai/`. A separate Electron app, `../agentic-flows-ui`, shows those files (dashboard, step diagram, Q&A, marketplace) and can start and drive `claude` sessions. Templates (in `../ZeremAI-marketplace`) can attach a small HTML **view widget** to an approval-gate step, which the app shows as a sandboxed iframe so the user can answer an approval by clicking in the widget. The question for the mods migration is what a later round would need to bring this UI into the Claude Code session itself (terminal and Desktop), using mods UI elements.

## 2. What exists today
**A. View widgets (plugin side and templates side)**
- Type: `types/view-definition.ts` (36 lines): `type: 'view'`, `id` (UUID), `name`, `htmlFile`, optional inlined `html`, `operationIds`, `mockData` (keyed by operation id). A template step points at it with `viewRef` (`types/template-definition.ts:69-70`); the resolved view is embedded in the flow step (`types/flow-instance.ts:225-228`).
- Resolution: `scripts/flow_manager.py:307-322` builds a registry of `<template>/views/<name>/<name>.json` by `id`; `:345-357` resolves a step's `viewRef`, errors if the UUID or the `htmlFile` is missing, copies `id, name, htmlFile, operationIds, mockData` and inlines `html` (`view["html"] = html_file.read_text()`, `:357`). Self-check: `scripts/test_view_resolution.py`.
- Gate data: a pending-interaction option carries `data` only when the step's view declares that option id as an operation id (`types/flow-instance.ts:259-261`). The file is `pending-interaction.json` (`:268-290`).
- Examples in the templates repo: 7 template folders reference views; the folders are `templates/flows/infrastructure/{set-concept,create-flow-template,create-guideline,update-flow-template,onboard}/views/<name>/` each with `<name>.json` and `widget.html` (for example `set-concept/views/understand-concept-widget/`, 84-line `widget.html`).
- Widget protocol (from `understand-concept-widget/widget.html:58-80`): the page receives `postMessage({type:'view-data', data})` and calls `parent.postMessage({type:'operation', operationId}, '*')` to act. No other API.

**B. The UI app (`../agentic-flows-ui`, Electron + React)**
- Reading state: `electron/fileWatcher.ts` (185 lines). chokidar over `~/.claude/zeremai` with `usePolling: true`, 1 s interval, depth 4, 300 ms write-stability wait (`fileWatcher.ts:53-63`). It recognises `flow.json`, `log.json`, `pending-interaction.json`, `qa-session.json` and `memory/*.json` (`:72-81`), only under `/active/`, `/completed/`, `/failed/` (`:65-70`), and passes parsed JSON to a callback.
- Fan-out: `electron/main.ts:179-250` (`start-watching`) forwards each change to the renderer (`flow-update`, `memory`, `log-update`, `pending-interaction-update`, `qa-session-update`).
- Writing state: not by editing files. `electron/main.ts:499-563` (`answer-question`) and `:565-` (`complete-question`) spawn `python3 scripts/flow_manager.py ...` in a sibling `zeremai` folder (`main.ts:26`). `main.ts:1198-1215` does the same for `scripts/template_manager.py` (marketplace, see `P09`). **Possible bug, to confirm**: `main.ts:524-530` passes positional arguments (`update-qa-answer <flowPath> <questionId> <answer>`), but `scripts/flow_manager.py:1710-1714` requires `--flow-dir`, `--question-id`, `--answer` flags, so this call looks outdated.
- Widget host: `src/components/ViewWidget/IframeWidget.tsx` renders the widget in `<iframe sandbox="allow-scripts" srcDoc=...>` (no `allow-same-origin`, so it cannot reach `window.electronAPI`, `:10-14`, `:34-41`), posts `view-data` on load (`:19`) and listens for `operation` messages from that iframe only (`:23-26`). Used in `src/components/DiagramView/FlowStepDetailModal.tsx:217-221` (only for an active gate with pending options) and `src/components/Templates/StepModalSections.tsx:341` (template browsing with `mockData`).
- A click does not resolve the gate itself. `FlowStepDetailModal.tsx:67-78` calls `executeLazyPrompt('select-option', ...)`, which either copies a prompt to the clipboard or sends it to the agent session (`src/services/lazyPromptsService.ts:136-160`, actions `clipboard` | `agent-apply`). So the agent still performs the state change.
- Driving `claude`: `electron/agentSessionManager.ts` (800 lines). It starts `claude` in a **herdr** pane (a terminal multiplexer reached over a local socket, `electron/herdrClient.ts`, 143 lines; `agent.start`, `pane.send_text`, `pane.send_keys`, `agent.send`), optionally with `--resume <id>` (`agentSessionManager.ts:225-228`) or `--dangerously-skip-permissions` (`:209-211`). It attaches a session to a flow by typing `/zeremai continue <path>` into the pane (`:76`, `:303-346`). It finds external sessions by reading `.session` files in flow folders (`:509-529`).
- IPC surface: `electron/main.ts:154-1290` (`agent:*`, `marketplace:*`, `read-flow-file`, `watch-file`, `delete-flow-instance`, `overview:*`) and `electron/preload.ts` (487 lines).

**Weaknesses seen (step 3)**: polling file watch (1 s plus 300 ms); the outdated-looking CLI call above; the UI depends on a sibling folder layout (`main.ts:25-26`); widgets only attach to approval gates.

## 3. First guess (step 3, not final)
- Verdict: **later** (needs the UI round).
- Why: the owner's decision is that the UI app keeps reading the same JSON files and the plugin-system migration comes first. Moving the UI into the session is a separate project.
- Mod abilities that a later round might use: render sites `Pane` (sidebar beside the transcript or a framed region above the prompt) and `AbovePrompt` (the band); elements `Box`, `Text`, `Button` (`onPress`, `hotkey`), `Input` (`onSubmit`), `Select` (`onSelect`, `options`), `Markdown` (`text`), `Code`, `Link`, `Client` (a second file you write that draws, posts data to the mod as a `ui.message` event; it gets no mods API); calls `$.ui.open` / `$.ui.close`, `$.ui.invalidate('ui.render')`, `$.ui.resolve(e)`, `$.ui.toast`, `$.ui.status`, `$.prompt.submit({ text, asUser })` (to send the user's choice to Claude), `$.fs.read`, `$.flow.run`, `$.clock.every`, `$.state`, `$.store`. Surfaces: the terminal and the Code tab of Claude Desktop only (some elements, such as `Raster` and `Image`, are terminal-only; `Svg` is Desktop-only). **Not** VS Code's chat panel and **not** `claude -p` (hooks run, nothing draws), and not WSL sessions in Desktop (plugins unavailable) (`mods/overview#where-mods-run`).

## 4. Research questions
1. Which UI app features have a direct mods element equivalent (dashboard list -> `Pane` with `Box`/`Text`; step diagram -> `Box` tree or `Svg` in Desktop; Q&A -> `Input` / `Select` / `Button`; widget -> `Client` or a native element tree; marketplace -> `Select` + `Button`)? Fill a table: feature, current file, mod element, "can it work in the terminal and in Desktop" (elements table, `mods/reference#elements`).
2. Can an HTML view widget run inside a mod? Check what `Client` is (a module file with its own drawing and `ui.message` posting) against the iframe protocol (`view-data` in, `operation` out). Does `Client` allow HTML/DOM, or only the element set? Is it the intended path for custom widgets in both surfaces?
3. How would a mod learn about state changes without the chokidar watcher? `$.fs` has no watch method (`read, write, list, exists, stat, ancestors`), so list the choices: `$.clock.every` polling, events (`classic.PostToolUse`, `tool.call` on the CLI call), or the agent calling a mod tool. State the cost of each (redraw throttle 10/s, 4 MiB read).
4. How would a click in a pane reach the agent? Today: a prompt is pasted or sent to the herdr pane. With mods: `$.prompt.submit({ text, asUser: true })` (waits for idle, starts a turn) or a registered tool. Which preserves "the agent performs the state change through the CLI"?
5. What does the session still need from the Electron app that a mod cannot do (several flows side by side, a window outside the terminal, template browsing with `mockData` preview, herdr multi-session control, Desktop-only vs terminal-only elements)? List what would stay in Electron.
6. What if the surface cannot draw (VS Code, `claude -p`, WSL Desktop)? What fallback exists (`$.ui.log`, a `/zeremai` command returning `{ text }`)? Check `e.surface` and `$.session.surfaces` in the type file.
7. What must hold for the owner's rule "the JSON files are the contract"? List every file shape the UI reads (`flow.json`, `log.json`, `memory/*.json`, `pending-interaction.json`, `qa-session.json`) and note which `types/*.ts` file defines each, so the later round does not change them.
8. Is the `answer-question` call in `main.ts:524-530` really out of date? Compare with the argparse definition at `flow_manager.py:1710-1714`. Record as a finding for the UI repo; do not fix it here.

## 5. How to research
1. Re-read these mods docs pages (full URLs under `https://code.claude.com/docs/en/plugins/mods/`):
   - `interface`: "Build a pane with tabs", "Pick where to draw", "Build a tree from elements" (the `Client` row), "Respond to presses and typing", "Redraw a site", "Keep state".
   - `gallery`: all element samples (the interface gallery), for what a dashboard or a form looks like.
   - `reference`: "Render sites", "Elements" (terminal / Desktop columns), "Limits".
   - `overview`: "Where mods run".
   - `test`: "Test a drawing" (does the later UI need tests on two surfaces).
2. Search the type file for: `ClientElement` / `Client`, `ui.message`, `interface PaneProps`, `PaneOpenOptions`, `ElementTable`, `surface`, `UiSelect`, `Markdown`, `prompt.submit`, `asUser`, `isFullscreen`.
3. Read these repo files: `types/view-definition.ts`, `types/template-definition.ts:60-75`, `types/flow-instance.ts:215-290`, `scripts/flow_manager.py:280-360`, `scripts/test_view_resolution.py`; in `../ZeremAI-marketplace` one `views/<name>/<name>.json` and its `widget.html` (start with `templates/flows/infrastructure/set-concept/views/understand-concept-widget/`); in `../agentic-flows-ui`: `electron/fileWatcher.ts`, `electron/main.ts` (`:154-260`, `:499-565`, `:1195-1295`), `electron/agentSessionManager.ts` (`:200-350`, `:509-530`), `electron/herdrClient.ts`, `src/components/ViewWidget/IframeWidget.tsx`, `src/services/lazyPromptsService.ts`, `src/components/DiagramView/FlowStepDetailModal.tsx` (`:60-80`, `:210-222`).
4. Compare: each UI screen and the widget protocol against the mods element list; each IPC channel against a mod call; write the table from question 1 and the "stays in Electron" list from question 5.
5. Write the answer under "7. Research result": the map (table), the list of things a later project must study (spike candidates), and the verdict (expected: `later`).

## 6. Out of scope
Research only. No UI design, no repo edits (not even the possible bug in `main.ts`), no building a mod. Do not change JSON shapes (the contract). Related items: `P11` (a small status line inside the session, possibly this round), `P09` (marketplace CLI the UI calls), `P07` (files the UI reads), `X01` (what happens when mods are off).

## 7. Research result

Built at the owner's request after the plan page "Mod Migration P06 to P12" (all 5 decisions kept as proposed).

### Claude Code version
2.1.296

### Feature table: what each screen of the app becomes

| The app does | In the mod |
|---|---|
| List of flows | Continue tab (P04) |
| Approve a step | Mod dialog (P02) |
| Questions | Question dialog (P05) |
| Marketplace screen | Templates tab (P09) |
| Step diagram, log, memory view | Later: a Steps tab (`Pane` with `Box` and `Text`) |
| HTML view widgets | Dropped |
| Several flows side by side, herdr control, template preview | Stay in Electron, or are dropped |

### Answers (short)
- Widgets: the gate is now a mod dialog (P02), so no widget has a job. `viewRef`, the view type and the code that copied a widget into a flow are removed (`create-flow.ts`, `types/view-definition.ts`, `types/flow-instance.ts`, `types/template-definition.ts`). A template that still names a view keeps working: the name is ignored.
- State changes: the mod reads files through the tools, so no file watcher is needed.
- A click reaches the agent through `$.prompt.submit({ asUser: true })` or a tool; the agent still changes state through the tools.
- Surfaces that cannot draw (VS Code, print mode): the status line and toasts are wrapped and do nothing there.
- The JSON files are no longer a contract for the app (owner's decision of 2026-10-10).

### Final verdict
**later** for the screens; **drop** for the widgets.

### Risks
The `views/` folders and every `viewRef` line were removed from `ZeremAI-marketplace` (5 templates). Copies already installed under `~/.claude/zeremai/` still hold old `views/` folders and `viewRef`; they are ignored.

### What a later plan must decide
Build the Steps tab.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P12"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
