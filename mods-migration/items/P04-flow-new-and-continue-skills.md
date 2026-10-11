# P04 · flow-new and flow-continue skills

> Status and result live in `../progress.html` (entry `P04`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") from templates. Two skills are the "drivers": `/flow-new` creates a flow from a template and runs its steps; `/flow-continue` resumes an existing one. They are long prose instructions the main model follows: they tell it to pick a template, collect parameters, bind the session to the flow folder, call `flow_manager.py`, delegate each step to the `step-executor` subagent, handle approval checkpoints and sub-flows. Both set `disable-model-invocation: true`, so only the user starts them by typing the command. Related items: P06 (step executor and delegation skill), P03 (approve), C01 (session lookup used by all hooks), P01 (CLI), H-series for hooks.

## 2. What exists today
Files:
- `skills/flow-new/SKILL.md` (232 lines). Key sections: "Always Use Templates" 28; "Check for Existing Flows" 50; "List Available Templates" 55; "Collect Parameters" 62; "Verify Step Definitions" 68; "Create Flow Instance" 78 (session binding at 80-84, `create-flow` call 86-94); "Start Flow" 99; "Step Execution Loop" 105 (mark in progress first, line 110); "Sub-Flow Step Handling" 119-187 (A resolve, B create child, C register child, D bind session, E drive child steps, F complete); "Handling Approval Checkpoints" 189-222; "Subagent Delegation" 228.
- `skills/flow-continue/SKILL.md` (193 lines). "Discover Active Flows" 30; "Bind Session to Flow (first action)" 37-43; "Read Flow State" 45; "Read Memory Topic Files" 50; "Summarize Current State" 55; "Update Current State" 63; "Proceed with Step Execution" 69; sub-flow handling 99-167; "State Restoration" 169; "Sync Point Handling" 176.
- `scripts/bind-session-to-flow.sh` (PostToolUse on `Write|StrReplace|Edit`): when a file under `~/.claude/zeremai/active/<p>/` is written and `.session` is empty or missing, it writes the hook's `session_id` into `<p>/.session`.
- `scripts/flow_manager.py:268-453` `cmd_create_flow` (resolves `stepRef` UUIDs to step definitions by scanning template sub-folders, resolves views, auto-injects `framework-steps/continuous-improvement` and `framework-steps/end-flow-validation`, writes `flow.json`, `memory/_cross-references.json`, `log.json`); `register-child-flow` 1023; `update-flow-status` 906.
- Templates live in `~/.claude/zeremai/templates/flows/` and come from `../ZeremAI-marketplace` through `scripts/template_manager.py`.

Behaviour in plain words:
- Session binding is a trick: the skill tells the model to `Write` an EMPTY `.session` file into the new flow folder; the PostToolUse hook fills it with the session id. Every enforcement hook then finds "its" flow by comparing `.session` contents with its own `session_id` (loop over `active/*/.session`, copied into 8 scripts; see C01). Without binding, "all enforcement hooks will be silently disabled" (flow-continue SKILL.md line 43).
- The model drives the whole loop: for each step it first runs `update-step-status --status in_progress` ("tells the Stop hook a subagent is already working the step"), then invokes the `step-executor-delegation` skill, then handles approval, then moves on. The Stop hook `block-stop-pending-steps.sh` forces it to continue while pending steps remain, and treats a step `in_progress` for over 10 minutes as a crashed subagent.
- Sub-flow steps (`subFlowTrigger` plus empty `stepDefinition`) are driven by the same model: resolve template UUID, `create-flow` with `--parent-*` flags, `register-child-flow`, bind session to the child (empty `.session` again), drive child steps recursively, complete the child with `--summary` (which auto-updates the parent).
- Inconsistency seen: in flow-new the child regular step rule says mark in progress first (line 172); in flow-continue the same rule (line 150-152) does not. Not verified whether this matters.
- Weaknesses: correctness depends on the model following ~200 lines of prose; the two skills duplicate ~60 lines of sub-flow text; session binding depends on a PostToolUse hook plus a write by the model; the flow "driver" state (which step is current) lives in the model's head, with hooks as backstop.

## 3. First guess (step 3, not final)
- Verdict: improve.
- Why: the creation logic is already in the CLI. What a mod can add is the command entry points, deterministic session binding, template/flow pickers, and re-injecting current state so the model does not need to re-read everything. The model still needs to drive the steps unless a mod drives them (a bigger design question).
- Mod abilities that might apply:
  - `$.command.register` (`flow-new`, `flow-continue`) + `command.run`: the mod does the mechanical start (list templates with `$.fs.list`, ask with `$.ui.ask`, call `create-flow` via `$.flow.run`, write `.session` with `$.fs.write` using `$.session.id`) and returns `{ text }` or uses `$.prompt.submit` to hand the model the first instruction. This removes the empty-file-plus-hook binding trick.
  - `prompt.context` / `prompt.section` / `prompt.attachment`: inject "current flow, current step, next action" at the start of each turn so the model does not need to rediscover it; replaces much of flow-continue steps 1-6.
  - `skill.prompt`: shorten or specialise the skill text per flow state.
  - `$.store` / `$.state`: remember the session-to-flow binding (still write `.session` for the UI and other tools).
  - `$.agent.register` / `agent.spawn`, `$.agent.list()`: see P06 for step execution; may let a mod run the step loop.
  - `turn.complete` / `classic.Stop` with `block`: auto-advance (replaces `block-stop-pending-steps.sh`; see the H-item for that hook).

## 4. Research questions
1. Can a mod command (`$.command.register`) start the flow-new flow and then give the model its instructions, for example by returning `{ text }` (which Claude reads) or calling `$.prompt.submit`? Which is better when the model must then run many tool calls?
2. Can the mod write `<flow-dir>/.session` itself with `$.fs.write` and the real session id (`$.session.id`)? Is the id the same value the settings hooks receive as `session_id`? What happens to the binding after `/clear`, `/resume`, `/branch` (the session id may change; see `session.end` reasons)?
3. Can `prompt.context` or `prompt.section` carry "current flow state" every turn, and how stable is it for the prompt cache? Can it replace flow-continue's read-state-and-summarise steps?
4. Which parts of the two skills are pure choreography that a mod can do deterministically (template list, parameter prompts, `create-flow`, child spawn, `register-child-flow`) and which need the model (parameter inference from context, deciding approvals)?
5. Could the two skills be merged into one command with a picker, now that both do "find or make a flow, bind, run steps"? What do the UI and users rely on in the two names?
6. If a mod replaces the model-driven loop with a mod-driven loop (mod picks the next step and starts the subagent), what does the plugin lose (model judgment, user interruption) and what does it gain? This is the biggest design choice: list options, do not decide.
7. What still works when mods are off (admin policy, `--safe-mode`, VS Code)? Do the skills remain as the fallback with the existing hooks? (See X01.)

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/api#add-a-command-or-a-tool and `#start-a-turn-from-a-background-job` (`$.prompt.submit`) and `#reach-files-flows-and-the-network`
   - https://code.claude.com/docs/en/plugins/mods/events#rewrite-or-add-to-a-prompt (`prompt.submit`, `prompt.context`, `prompt.section`, `skill.prompt`)
   - https://code.claude.com/docs/en/plugins/mods/events#follow-a-turn
   - https://code.claude.com/docs/en/plugins/mods/interface#keep-state (`$.state` vs `$.store`; state after `/clear` and `/resume`)
   - https://code.claude.com/docs/en/plugins/mods/reference#events (Prompts, Session, Subagents) and `#mods-api-methods`
2. Search the type file for: `skill.prompt`, `prompt.context`, `PromptContextResult`, `blocks`, `session.start`, `SessionEndInput`, `reason`, `$.session` `id`, `prompt.submit`, `asUser`.
3. Read these repo files: both SKILL.md files in full, `scripts/bind-session-to-flow.sh`, `scripts/flow_manager.py:268-453`, `scripts/block-stop-pending-steps.sh`, `hooks/hooks.json`, `framework-steps/*/*.json` (skim), `../agentic-flows-ui/electron/agentSessionManager.ts` (search `.session`, `--resume`: the UI relies on `.session` to link sessions to flows).
4. Compare: for each numbered section of the two skills, label it (a) mod can do deterministically, (b) needs model, (c) stays as CLI. Compare the duplicated sub-flow text and note any behavioural differences between the two copies.
5. Write the answer under "7. Research result".

## 6. Out of scope
No implementation. No plugin edits. No building a mod. Do not start or resume real flows. (Only items S01-S03 may build a throwaway mod outside this repo.)

## 7. Research result

Built instead of only researched, at the owner's request (plan page "Flow Pane in the Mod", 3 decisions kept as proposed).

### Claude Code version
2.1.296 (Claude Code)

### Answers per question (1-7, each with evidence)
1. **Command plus pane, then one prompt.** `/flow` opens a pane (`$.ui.open`). A button callback sends `$.prompt.submit({ text, asUser: true })` (not awaited). Returning `{ text }` from the command was not used: the flow is chosen inside the pane, after the command ended. Test: `on-flow-pane.test.ts`.
2. **The store holds the link, not a file.** `bindSession` (H08, C01) is called by the pane with `$.session.id()`. Not verified live: that this id equals the hook `session_id`, and what it does after `/clear`, `/resume`, `/branch` (S02). After `/clear` the user opens `/flow` again, which binds the new id.
3. **Not used.** The pane builds the state message once (`handoff` in `hooks/infra/flow-pane/flow-pane.ts`). `prompt.context` each turn was not needed and would cost cache. Replaces steps 3-6 of flow-continue.
4. **Mod: template list, fields, `create_flow`, binding, state summary, flow list. Model: step loop, approvals, sub-flow steps, parameter choice (now the user's).** The sub-flow steps (create child, register child) stay model-driven in the `flow-run` skill; a `start_sub_flow` tool is a later option.
5. **Merged.** One command `/flow`, two tabs. The names `/flow-new` and `/flow-continue` are gone. The UI app is obsolete, so nothing relies on them.
6. **Not changed.** The model still drives the step loop. A mod-driven loop (mod starts each subagent) was not built; that stays a separate decision (see H01, P06).
7. **No fallback.** The tools are mod tools, so with mods off the plugin cannot change a flow. A skill fallback has no job. The pane needs the terminal or the Desktop app (no pane elsewhere).

### Final verdict
**replace.** The pane does what the two skills did before the step loop. One shared skill `flow-run` keeps the loop, approval and sub-flow text (about 110 lines, down from 369 in two skills; the sub-flow text exists once now).

### Evidence (doc page + section, type-file names, repo file:line)
- Docs: mods interface (pane, `Input`, `Button`), mods api (`$.command.register`, `$.prompt.submit`), mods test (`$.ui.mount`).
- Added: `hooks/infra/flow-pane/flow-pane.ts`, `hooks/on-flow-pane/on-flow-pane.ts`, `skills/flow-run/SKILL.md`, and the two test files next to them.
- Changed: `hooks/register.ts`, `hooks/on-flow-tools/on-flow-tools.ts` (registers the command; a plugin can have only one `session.start` hook without a matcher, and the old `command.run` hook for the skill names is gone), `agents/flow-spawner.md` (calls `create_flow`, not the skill), `agents/step-executor.md`, `skills/step-executor-delegation`, `skills/flow-state-update`, `README.md`, `framework-steps/continuous-improvement`.
- Deleted: `skills/flow-new`, `skills/flow-continue`.
- Found by a test: a prompt sent with `asUser: true` still has `origin.kind: "plugin"`, so `on-user-prompt` skips it. The pane raises the log flag and restarts the re-prompt count itself (`handOff`).
- Found by a test: an `Input` must have `onSubmit`. Enter in a field creates the flow.
- `claude plugin test .`: 218 pass, 0 fail. `claude plugin validate .`: passed with warnings.

### Open questions
- Live run not done: the pane in a real terminal and in the Desktop app.
- Is `/flow` free of a built-in name collision? The register call is wrapped so a clash does not stop the session.
- Does `$.session.id()` equal the hook `session_id`, and what changes after `/clear`, `/resume`? (S02)
- Does the model read the `flow-run` skill when the hand-off asks for it? Not run live.

### Risks
- The first turn after Create or Resume now starts with the link in place (this removes the H08 risk "first prompt runs before the link"). A resume after `/clear` needs the user to open `/flow` again, as before.
- The pane keeps its state in module variables: a reload of the mod closes it back to the start.
- Create shows an error line when a required field is empty. There is no disabled button.
- Template install is not in the pane (P09). With no template, the New tab says so.

### What a later plan must decide
- Whether a mod tool should start sub-flows, to shorten `flow-run` further.
- Whether the mod, not the model, drives the step loop (H01, P06).

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P04"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1-3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
