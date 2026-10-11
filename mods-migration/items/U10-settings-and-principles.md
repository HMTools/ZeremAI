# U10 · Settings and operating principles

> Status and result live in `../progress.html` (entry `U10`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`. This item belongs to the UI phase (group `U`): the UI app moves into the mod. Do `U01` first, and use its result.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The plugin is now a Claude Code mod: the flow rules, tools, the `/flow` pane and a step line are done (items H, C, P). A separate Electron app, `../agentic-flows-ui`, still shows the flows. Owner's decision of 2026-10-10: the whole UI moves into the mod, the connection to the app is obsolete, and the JSON files are no longer a contract for it. The owner also wants the mod UI to look less plain and more like a GUI. The app has a settings screen and an editor for the operating principles that every step must follow. The mod has no settings today. Claude Code has two ways to keep options for a plugin, and a pane can hold a form.

## 2. What exists today
- `Settings/index.tsx` (344): Lazy prompts (on or off, default action: copy or send), Agent sessions (auto-attach, permission mode, terminal font size), a list of available lazy prompts.
- `PrinciplesConfig/index.tsx` (130), `PrinciplesList.tsx` (91), `PrincipleCard.tsx` (88): edit `~/.claude/zeremai/config/operating-principles.json`: id, name, rule, verification, enabled, order. The load was still a TODO in the app.
- The step agent reads that file (`agents/step-executor.md`, "Load Operating Principles") and prints the principles each step (P06 open question).
- Plugin options: `userConfig` in `plugin.json` is passed to `register(on, options)`; `$.config` lists `/config` rows (`config.describe`).

## 3. First guess (step 3, not final)
- Verdict: replace
- Why: see the context. A mod draws with elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Svg` on the Desktop app, `Client`) in a pane or the band above the prompt.

## 4. Research questions
1. Which settings survive: most of the app's settings belong to the terminal and lazy-prompt features, which U08 and U09 may drop. What is left?
2. `userConfig` fields in `plugin.json` (validated, with defaults, edited through Claude Code's plugin settings) against a settings tab in the pane against `/config` rows: which is best for each setting?
3. Operating principles: a list with an enabled toggle, a reorder, an edit form. Which elements (`Button` toggle, `Input`, `Select`) give this? Is there a checkbox?
4. Where are the principles kept so the step agent still reads them: the same file (written with `$.fs.write`, not atomic) or the mod store? Does the agent need the file, or can the mod inject them with `prompt.section`?
5. Is the principles check still worth its token cost each step, now that the guards enforce the main rules (H items)?
6. Where does a setting that several sessions read live (`$.store`, shared by all sessions)?

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
Verdict **remove** (owner, 2026-10-10: "remove the principles feature from the framework"). A plan page for a principles editor was published first; the owner then found that no principles exist on the machine (the config file was never created, the app's editor never loaded it) and removed the feature.

Done in the framework repo (265 tests pass, `claude plugin validate .` passes):
- `agents/step-executor.md`: the "Load Operating Principles" step, the config file line, the principles check in the end-step verification and the closing "Operating Principles" section are gone. The substep count report and a short end-step check (decisions and files recorded) stay.
- `types/step-definition.ts`: the `principles` field is gone. `types/template-definition.ts`: a comment fixed.
- `framework-steps/continuous-improvement`: the last substep is now "End-Step: Log Problems" (it keeps the problem logging).
- Other settings: lazy prompts (U09), agent sessions and the terminal (U08) are removed. No `userConfig` is needed.

Open:
- Templates repo (done after the owner asked): 17 step files had the end-step substep "Compliance Check" ("Verify principles were followed in this step"). It is now "End-Step: Log Problems" with only the problem-logging action; the two Verify lines and the "compliance with operating principles" output line are gone. A "(LOG FIRST principle)" remark in one step is trimmed. No file mentions principles any more.
- `framework-steps/end-flow-validation` (decided with a plan page, 2026-10-10): the compliance checks are removed, the step is renamed `framework-steps/complete-flow` and keeps two substeps: delete the artifact files (the owner chose to keep this, as before), then call `update_flow_status` with `completed`. The status tool now writes `metadata.completed` itself (test added). The `complianceChecklist` field is gone from the types and from `create-flow`. README, the flow-run skill and the templates repo (README, one orchestrator note) use the new name. A flow that started before this keeps its old copy of the step.
- The app's principles editor is in the obsolete UI app and was not touched.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "U10"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set `status`, `verdict`, `summary`, `open`, `updated` (today's date `YYYY-MM-DD`). Do not change other entries. Check the file still parses (`node --check` on the script) and open it in a browser.
