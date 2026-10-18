# U05 · Memory, logs and files views

> Status and result live in `../progress.html` (entry `U05`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/zeremai` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. Next to the diagram the app has a right panel with three tabs: Memory, Logs and Files. They show what the flow produced, what the agent did and which files it touched. The mod has none of these views today.

## 2. What exists today
- `RightPanel.tsx` (208): the tabs Memory, Logs, Files; collapse to icons.
- `MemoryView.tsx` (371) and `MemoryExplorerModal.tsx` (643): topics from `memory/*.json`; tabs Flow (which step wrote and read which topic), Topics, History (by update time) and Diffs (between step entries).
- `LogsView.tsx` (371): `log.json` steps with several timestamp formats (a string, `{ startedAt, completedAt }`, `{ started, completed }`); actions, reasoning, problems, decisions, user interactions.
- `FilesView.tsx` (253) and `FileContentModal/index.tsx` (548): the files a flow touched, a viewer that renders Markdown and Mermaid, with hot reload by a file watch.
- Data: `memory/*.json` and `_cross-references.json`, `log.json`, `filesModified` lists. The file-change tracking hook was removed earlier, so check where the file list comes from now.

## 3. First guess (step 3, not final)
- Verdict: replace
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. Which memory and log data does each view need, and is the shape stable (types in `types/memory-file.ts`, `types/log-file.ts`)? Which timestamp formats must the reader still handle?
2. Where does the Files list come from now that the tracking hook is gone (`filesModified` in the log, the memory cross-references)? Is the tab still wanted?
3. How is a file shown: `Code` with `language` and `startLine`, `Markdown`? Is `format` a diff view? What size limits apply to `$.fs.read` (4 MiB) and to one tree (100,000 characters)?
4. Mermaid diagrams: the terminal cannot draw them. Is the fallback the source text, and does the Desktop app render an `Svg` made another way?
5. Hot reload of a viewed file: no watcher. Is a manual refresh key enough?
6. The Diffs and History views: what do they add over the log? Which are worth building?
7. Where does this panel sit: a tab of the flow pane, a second pane, the same pane split? What happens at 60 columns?

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
Verdict: **replace**. Plan page answered 2026-10-10: Steps, Memory, Logs and Files are tabs inside the bound flow; Memory gets all four app sub-tabs (Flow, Topics, History, Diffs); a file with a Mermaid diagram is not drawn: the viewer has an **Open in editor** button (the owner's idea: "navigate to the file in the IDE").

Built (258 tests pass, `claude plugin validate .` passes):
- `hooks/infra/flow-pane/flow-views.ts` (new): `memoryView` (topics with writtenBy and readBy, history newest first, diffs between the entries of a topic), `logView` (one row for each step; `timesOf` reads the three time formats), `filesView` (output files, framework files, the step that touched each; the list comes from the folder plus `filesModified` in the log and `filesModifiedCreated` in memory), `readText` (cut at 60,000 characters).
- `hooks/on-flow-pane/on-flow-pane.ts`: the tab row with counts (short names below 52 columns); Memory sub-tabs; a Logs row opens the step detail on its Execution tab (button reads Back to logs); a file opens as `Markdown` or `Code` with Back to files and Open in editor.
- Open in editor runs `code --goto <path>`. If `code` is missing the pane shows the path. The IDE-specific route (the VS Code surface) was not tried.
- The tabs read their files on each draw, so the 5 second timer is the live refresh. Differences from the plan: the file limit is 60,000 characters (one drawing holds 100,000), not 1 MiB; Desktop uses the same elements as the terminal with cards and hover, not the richer mock.
- Open: not seen on a real Desktop or terminal session; `code` may not be on the PATH; the Mermaid text shows as a code block inside Markdown.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U05"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.

### Change after the build (owner: "never open directly the files, always via the file viewer")
The pane no longer draws a file. A press on a file row calls `openInViewer`: in the terminal it runs `code --goto <path>`; on Desktop it runs the system opener (`open`, `xdg-open`, or `start`). The inline Markdown/Code viewer, Back to files, Open in editor and `readText` are removed. The mods API has no call for the Desktop app's own file viewer: the system opener is a stand-in, so ask the owner what "built-in capabilities" means. If nothing opens, the pane shows the path.
