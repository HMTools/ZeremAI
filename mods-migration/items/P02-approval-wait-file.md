# P02 · Approval wait file (pending-interaction.json)

> Status and result live in `../progress.html` (entry `P02`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. Some steps have `approvalRequired: true`: after the model finishes the step it must show its deliverables and wait for the user. The plugin represents "waiting for the user" as a file, `pending-interaction.json`, in the flow folder `~/.claude/zeremai/active/<flow>/`. The file is written by the model through `flow_manager.py write-pending`, read by hooks (which block tools and allow stopping while it exists) and by the UI app (which shows the options), and deleted once the user answered. This item is about that file and the protocol around it. The hooks themselves are items H-series (see H01-H11 in `../progress.html`); the approve skill is P03.

## 2. What exists today
Files:
- `scripts/flow_manager.py:1193-1261` `cmd_write_pending`; parser at 1695-1700 (`--flow-dir`, `--options` JSON array, `--delete`).
- `scripts/models.py:426-474` `InteractionOption` (`id`, `label`, `description?`, `isDefault?`, `data?`) and `PendingInteractionFile` (`type: "pending-interaction"`, `options[]`). Only these two fields exist: there is NO question text, step id or timestamp in the file.
- `scripts/flow_manager.py:249-265` `_check_pending_approval`: blocks `update-step-status`, `update-current-state`, `update-active-substep`, `update-flow-status` while the file exists (set at line 1742).
- `scripts/flow_manager.py:513-554` `cmd_approve_step`: refuses while the file exists.
- Hooks: `scripts/check-approval-stop.sh` + `scripts/build_approval_block_message.py` (Stop and SubagentStop: if a step is `in_progress` AND `approvalRequired` and the file does NOT exist, block the stop and tell the model to run `write-pending`; builds an example `options` list with approve / reject / modify and, for steps with a `view`, the required `data` shape); `scripts/block-tools-on-pending.sh` (PreToolUse, all tools: while the file exists, allow Read/Glob/Grep/LS and Write/Edit of flow state files and any Bash containing `flow_manager.py`; block everything else with a long message); `scripts/block-stop-pending-steps.sh:37-41` and `check-approval-stop.sh:36-39` treat the file as "properly at a checkpoint, allow stop". `hooks/hooks.json` wires them.
- Skills that describe the protocol: `skills/flow-new/SKILL.md` ("Handling Approval Checkpoints"), `skills/flow-continue/SKILL.md` (step 7 approval sequence), `skills/flow-state-update/SKILL.md:269-300` (`write-pending`).
- UI: `../agentic-flows-ui/electron/fileWatcher.ts:76` classifies `/pending-interaction.json`; `electron/main.ts:227-233` broadcasts `pending-interaction-update`; `src/components/DiagramView/FlowStepDetailModal.tsx:163-169` shows "Waiting for your input" when it exists; `src/App.tsx:301-302` uses step status `awaiting_approval` or `in_progress && approvalRequired`.

Behaviour in plain words (the protocol):
1. The step-executor finishes the step and returns deliverables. The parent model presents them.
2. Parent calls `write-pending --options '[...]'`. The script refuses unless the active step has `approvalRequired: true`, no `qa-session.json` exists, and (for steps with a `view`) each option listed in `view.operationIds` carries a non-empty `data` object (1244-1257).
3. Hooks now block most tools and allow Stop. The user answers in chat or the UI.
4. Model reads the user's choice, logs it (`log-interaction`), deletes the file (`write-pending --delete`; this path skips the log gate, line 1750), then calls `update-step-status --status completed`, which succeeds only if the user approved (P03).
- Where the user's choice is recorded: only in chat or the UI text. The file never stores the answer; the model reads the conversation. (The UI reading side of "how does the UI answer the checkpoint" was not found in `electron/main.ts`: there is no `write-pending` or approve call there; the UI has `agent:send-prompt` (main.ts:909) which types text into a Claude session. Unsure how the UI answers a checkpoint; verify.)
- Known weaknesses: the file is a flag with no owner (a crash leaves it behind and blocks all non-read tools until deleted); the hook messages tell the model to call `update-step-status --status completed` right after deleting, which then fails if not approved; the blocking is implemented in 3 places (hook, CLI guard, Stop hook) that must agree.

## 3. First guess (step 3, not final)
- Verdict: improve.
- Why: the file is the contract with the UI (the owner decided the UI reads the same JSON files), so it must keep being written. A mod can make the wait itself native and remove the model's ceremony, while still writing the file for the UI.
- Mod abilities that might apply:
  - `$.ui.ask` and `$.ui.open` / `ui.render` with `Button`, `Select`, `Input`: ask the user inside Claude Code (approve / reject / modify) and capture the answer as data, not as chat text. Check the exact shape in the type file.
  - `$.tool.register` + `tool.call`: a tool `request_approval` the model calls that writes `pending-interaction.json` (via `$.fs` or the CLI), waits for the user, and returns the choice as the tool result (no hook-based blocking needed because the tool call itself blocks).
  - `tool.call` / `tool.check` with `{ deny: reason }`: replace `block-tools-on-pending.sh`.
  - `classic.Stop` returning `block` or `turn.complete`: replace the Stop approval hook (see H-items on Stop).
  - `$.fs.exists` / `$.fs.read`, `$.clock.every`: watch the folder for the file being deleted by the UI.
  - `$.state`: show a status band "waiting for approval: <step>".

## 4. Research questions
1. Can a tool call stay open while the mod asks the user (`$.ui.ask`) and then return the answer to the model? What are the time limits (hook 10 s excludes time inside `next` and mods API calls; confirm `$.ui.ask` is such a call) and what happens on interrupt (`next.signal`)?
2. Does `$.ui.ask` support multiple options with labels, a default, and free text? Does it work in the terminal and Desktop, and not in `claude -p`?
3. If the mod handles the ask, should `pending-interaction.json` still be written? (The UI needs it, per the owner's decision.) Who deletes it: the mod when the user answers, or the model?
4. Can a `tool.call` hook deny all tools except read-only ones and `flow_manager.py` Bash commands while the file exists (current rule in `block-tools-on-pending.sh`), including inside subagents (`e.agentId`)? Compare the current hook, which only sees the main session id via `.session`.
5. If the user answers in the UI (a separate Electron flow) rather than in the session, how would the mod learn this? Is polling with `$.clock.every` + `$.fs.exists` workable, or is there a file-watch event?
6. Does the mod need to store the user's answer in the file (new field) for the UI? Check the UI types (`../agentic-flows-ui/src/types/index.ts`) before proposing: the owner says the file shape is the contract.
7. What is the fallback when mods are off (admin policy, `--safe-mode`): do the existing hooks plus CLI guards still protect the flow? (See X01.)

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/interface (`$.ui.*`, panes, `ui.press`/`ui.select`/`ui.input`, "Respond to presses and typing")
   - https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call and `#follow-a-turn`
   - https://code.claude.com/docs/en/plugins/mods/api#add-a-command-or-a-tool and `#run-work-in-the-background`
   - https://code.claude.com/docs/en/plugins/mods/reference#events (Tools, Turns, Interface) and `#limits`
   - https://code.claude.com/docs/en/plugins/mods/overview ("where mods run")
2. Search the type file for: `ask(` (in `$.ui`), `AskUserQuestion`, `ui.select`, `ToolCallInput`, `ClassicResult` (for `Stop`), `agentId`, `TurnCompleteResult`.
3. Read these repo files: the files listed in section 2, in this order: `scripts/flow_manager.py:1193-1261`, `scripts/models.py:426-474`, `scripts/check-approval-stop.sh`, `scripts/build_approval_block_message.py`, `scripts/block-tools-on-pending.sh`, then UI `electron/fileWatcher.ts`, `src/components/DiagramView/FlowStepDetailModal.tsx`.
4. Compare: current flow (file + three enforcement points) against a mod flow (tool or `$.ui.ask` + one `tool.call` guard). List which of today's checks disappear and which remain for the UI or for fallback.
5. Write the answer under "7. Research result".

## 6. Out of scope
No implementation. No plugin edits. No building a mod. Do not change the file shape; do not design UI changes (the UI move is later). (Only items S01-S03 may build a throwaway mod outside this repo.)

## 7. Research result
Planned and built 2026-10-10 as one feature: items H07, P02 and P03 together (plan page: https://claude.ai/artifact/E6mZkfXRWuKywfs63rU9pQ). Not committed.

### Claude Code version
`2.1.296 (Claude Code)`. Type file from the `plugin-authoring` skill for this build.

### Answers per question
1. A tool call can stay open while the mod asks: `request_approval` holds the call on `$.ui.ask`. The hook time limit does not count a `$` call in flight. Not run live.
2. `$.ui.ask` takes 2 to 4 option labels and free text under Other. Request changes uses the Other text. It rejects in `claude -p`.
3. The pending file is gone. The gate is a record in `$.store`. The mod closes it when the user answers.
4. A `tool.call` hook refuses everything but research and the log entry while the gate is open, subagents included (`on-pending-checkpoint`).
5. The UI answering in a separate flow: dropped. The UI moves into the mod.
6. No new file field. The file shape no longer matters.
7. Mods off: nothing guards (X01).

### Final verdict
**replace**

### Design
- The agent calls a tool the mod registers: `mcp__zeremai__request_approval` (`$.tool.register` at `session.start`, served by a `tool.call` hook). The call opens `$.ui.ask` with Approve and Request changes and waits. The answer is the tool result.
- Only the mod writes `approved: true` in `flow.json` (`$.fs.write`). The CLI has no approve command any more.
- The gate is a record in `$.store` (`gate:<sessionId>`). While it is open the agent can research (Read, Glob, Grep, LS, WebFetch, WebSearch, MCP tools, `Agent`/`Task`) and log (`log-interaction`). Write, Edit, Bash and the rest are refused. A subagent's own calls follow the same rule.
- A prompt while a gate is open goes through and opens the dialog again. The answer reaches the agent as a prompt of its own.
- A `.catch` guard refuses `Write`, `Edit`, `MultiEdit` on a flow file and a Bash command that names `flow.json` and looks like a write. A script file that edits it still passes (the mod sees only its name).
- No Reject option. The UI app is not kept in step (it moves into the mod).

### Implemented
- New `hooks/on-approval-gate/on-approval-gate.ts` (tool, hand-edit guard) and `hooks/infra/approval-gate/approval-gate.ts` (question, answer, `reopenPanel`, `isHandEdit`). Registered in `hooks/register.ts`; `hooks/on-user-prompt/on-user-prompt.ts` calls `reopenPanel` (a plugin has one `prompt.submit` hook).
- `findPendingBlock` now reads the gate record and lets research through; the `.approve-token` Write exception is gone. `on-agent-stopping.ts` asks the agent to call `request_approval` and to complete an approved step.
- Removed: `scripts/block-approve-step.sh`, `scripts/hook_extract_flow_dir.py`, `skills/flow-approve/`, the `PreToolUse` entry in `hooks/hooks.json`, `cmd_approve_step`, `cmd_write_pending`, `_check_pending_approval` and the pending models (`scripts/flow_manager.py`, `scripts/models.py`, `types/`), `approve-step` and `write-pending` in the log-gated list.
- Texts rewritten: `skills/flow-continue`, `flow-new`, `flow-state-update`, `agents/step-executor.md`, `docs/flow-management.md`.
- Tests: `claude plugin test .` 125 pass; `claude plugin validate .` passes (one `logo` warning). `scripts/test_view_resolution.py` passes without its write-pending test.

### Evidence
- Repo before: `scripts/flow_manager.py` `cmd_write_pending`, `_check_pending_approval`, `scripts/check-approval-stop.sh` (already a mod), `hooks/infra/pending-checkpoint/pending-checkpoint.ts`.

### Open questions
- Not run in a live session (S01): `$.ui.ask` as the approval dialog (time the user takes, terminal and Desktop), `$.tool.register` with `isDeferred: false`, a tool call held for the answer, `$.store` across a restart, `$.fs.write` of `flow.json`, `$.prompt.submit` after the hook has returned, a refused prompt never needed.
- A test host has no screen, so `$.ui.ask` is dismissed there. The answers are tested through `askGate`, not through the tool.
- Order of the new `tool.call` hooks against `on-pending-checkpoint`, `on-agent-editing` and `on-todo-tool`: not tested.
- If mods are off, nothing guards approval (X01).
- Step views (option `data` for steps with a `view`) were part of `write-pending`; they go with the UI move and are not rebuilt.
- A hand edit through a script file passes. Closed fully only when the mod is the only writer of the flow file (P01).
- `.approve-token` and `pending-interaction.json` may still sit in old flow folders; nothing reads them.

### What a later plan must decide
- Whether step views come back with the UI mod.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P02"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1-3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
