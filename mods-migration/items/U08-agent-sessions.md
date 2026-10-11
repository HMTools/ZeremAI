# U08 · Agent sessions and terminal

> Status and result live in `../progress.html` (entry `U08`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/flow` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. The app starts Claude in terminal panes (through herdr, a terminal multiplexer), attaches a session to a flow, resumes it, and shows the terminal inside the app. With the UI inside Claude Code the user is already in a session, so most of this has no job. This item decides what is left.

## 2. What exists today
- `electron/agentSessionManager.ts` (800 lines): start `claude` in a herdr pane, with `--resume <id>` or `--dangerously-skip-permissions`; type `/flow-continue <path>`; find external sessions by reading `.session` files (obsolete: the link is in the mod store now).
- `electron/herdrClient.ts` (143): a local socket client for herdr (`agent.start`, `pane.send_text`, `pane.send_keys`).
- `AgentSessionPanel/index.tsx` (420) and `Terminal.tsx` (210): an embedded terminal (xterm) under the diagram: start, stop, input, resize.
- `AgentSessions/index.tsx` (306): a list of sessions with cards; `TerminalWindow/index.tsx` (138): a session in its own window.
- Settings: auto-attach, permission mode (regular or allow all), terminal font size.

## 3. First guess (step 3, not final)
- Verdict: keep
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. Which jobs of this feature does a user still need once the UI is inside a session: see the subagents of this flow, start another session, resume a flow in a new terminal?
2. `$.agent.list()` gives subagents and teammates with a status. Can a pane list the step agents of the bound flow with their status, and how is an agent tied to a step?
3. Can a mod start or talk to another session (`$.session.send`, `$.agent.spawn`)? What does it need, and what does the guard allow?
4. Starting `claude` in a new terminal is outside a mod (`$.flow.spawn` could run `claude`, but not draw a terminal). Is it dropped?
5. What does the herdr dependency give that nothing else does? Is it a reason to keep the Electron app for people who run many sessions?
6. Verdict: which parts are dropped, which move to U03 or U04, and what stays in Electron?

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
Not migrated (owner, 2026-10-10): "it is obsolete, from now on the UI is the Claude mod, so it always runs with agents". Verdict **remove**. The app started Claude in terminal panes and showed the terminal; the mod already is a session, so starting sessions, the embedded terminal, session discovery by `.session` files and the herdr link have no job. A plan page proposed a small agent-status mark on the step row; the owner closed the item instead, so nothing was built. Settings (permission mode, auto-attach) go to U10.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U08"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.
