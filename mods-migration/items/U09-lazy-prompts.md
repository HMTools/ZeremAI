# U09 · Lazy prompts and gate shortcuts

> Status and result live in `../progress.html` (entry `U09`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/zeremai` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. A lazy prompt is a ready-made message for the agent: Continue flow, Select option, New flow. The app builds the text and either copies it or sends it to the agent session. In the mod, the approval gate is a dialog (P02) and Continue and New are in the pane (P04), so most of this may already exist.

## 2. What exists today
- `LazyPromptModal/index.tsx` (532): a list: the options of an open approval, and Continue flow; a warning when no agent session exists; a confirmation to create one; keyboard control; a live update of the options while open.
- `LazyPromptButton`, `lazyPromptsService.ts`: types `continue-flow`, `select-option`, `new-flow`; two actions: copy to the clipboard, or send to the agent.
- Shift+P opens it from the diagram. A setting turns it on and sets the default action.
- Data: `pending-interaction.json` (gone: the gate is a store record).

## 3. First guess (step 3, not final)
- Verdict: replace
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. Which lazy prompts still have a use now: Continue (a button on a card that calls the resume code), Select option (the dialog does it), New (the New tab)?
2. Is there any prompt a user wants to send often that has no screen? A command or a button list of saved prompts, kept in `$.store`?
3. `$.prompt.submit({ text, asUser: true })` waits for idle and starts a turn. Is that the one send path? Copy to the clipboard: `$.ui.copy`?
4. How does a user open a quick prompt list with one key?
5. Verdict: replace by what exists, and list what is dropped.

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
Verdict **remove** (decided from the code, no plan page: nothing is left to build). The three lazy prompts each have a screen in the mod:
- Continue flow: a Resume button on a Continue card (`flow-N`, U02), which calls `resumeFlow` and submits the hand-off as the user's prompt with `$.prompt.submit({ text, asUser: true })`.
- New flow: the Start button on the New tab (U07).
- Select option: the approval dialog (`$.ui.ask`, P02, `on-approval-gate`).

The app's two actions (copy, send to an agent session) existed because the app was outside the session. The mod is the session, so `$.prompt.submit` is the one send path and there is no copy step. The pending-interaction file is gone (the gate is a store record). Open: the app never had a list of saved quick prompts, so none is built. If the owner wants one, it is a new item: a `$.store` list and a button row.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U09"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.
