# U11 · Toasts, errors, confirmations and update banner

> Status and result live in `../progress.html` (entry `U11`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/zeremai` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. These are the small parts of the app shell: messages, error screens, yes/no dialogs and the update banner. Most have a direct mod equivalent. This item lists them and decides each.

## 2. What exists today
- `Toast/index.tsx` (114): short messages.
- `ErrorDisplay/index.tsx`, `ErrorBoundary/index.tsx` (115): an error screen with a retry.
- `ConfirmationModal/index.tsx` (186) and `Alert`: yes/no dialogs (delete a flow, create an agent session).
- `UpdateBanner/index.tsx` (108), `useAutoUpdate.ts`: Electron auto-update; a banner when a new app version is ready.
- The mod already uses `$.ui.toast` (P08), a two-press button (marketplace remove), and `$.ui.ask` (the approval dialog).

## 3. First guess (step 3, not final)
- Verdict: replace
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. Toasts: `$.ui.toast(text)` shows 4 seconds (`timeoutMs` up to 60,000). Does a toast show in the Desktop app? What does a pane hold while a dialog shows (`holdToasts`)?
2. Errors in a pane: a red `Text` line (as today) or a `Box` with a border? What does a failed `ui.render` show (`the engine drew its own`)? Is a retry button needed?
3. Confirmations: `$.ui.ask(question, options)`, a two-press button, or a dialog pane? Which fits each case (delete a flow, remove a marketplace)?
4. Update banner: Claude Code updates plugins itself. Is a version line in the pane enough (`$.plugin`, `plugin.json` version)? Drop the rest?
5. Verdict for each part, one line each.

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
Verdict **replace** by what exists (decided from the code, no plan page: nothing is left to build):
- **Toast** → `$.ui.toast`. Used when a flow starts to wait (`on-flow-pane.ts`, the 5 second timer) and for open improvement findings at session start (`on-flow-tools.ts`). A toast needs no pane, so it works at any width.
- **Error screen and retry** → a red `Text` line in the pane (`message`); a failed form or tool shows its reason there. If a render hook returns a tree the engine refuses, the engine draws its own and prints a dim line; the user can reopen the pane. No boundary component is needed.
- **Confirmation modal** → the two-press button (marketplace Remove: first press asks "Sure?") and `$.ui.ask` (the approval dialog). No dialog pane.
- **Update banner** → dropped. Claude Code updates plugins itself (`/plugin`). A version line in the pane was not added.
- Built afterwards (owner: "handle all the still open items"): **Delete** on a Continue card. It asks twice ("Sure?"), then `deleteFlow` moves the folder from `active/` to `deleted/` (a name that is taken gets a time suffix; any folder not straight under `active/` is refused). The flow this session works on cannot be deleted. The folder stays on disk, so the user can move it back by hand. 267 tests pass.
- No version line in the pane: `/plugin` shows the version.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U11"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.
