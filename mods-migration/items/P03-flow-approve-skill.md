# P03 · flow-approve skill

> Status and result live in `../progress.html` (entry `P03`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows made of steps. Steps with `approvalRequired: true` must be approved by the USER, never by the model. Approval is recorded as `approved: true` on the step in `flow.json`, and `update-step-status --status completed` refuses to complete such a step without it. The user approves by typing `/zeremai:flow-approve <flow-dir> <step-id>`. This item studies that skill and the "token" trick that keeps the model from approving by itself. Related: P02 (the wait file), H-items for `block-approve-step.sh` (see H-series in `../progress.html`).

## 2. What exists today
Files:
- `skills/flow-approve/SKILL.md` (55 lines). Frontmatter (lines 1-7): `disable-model-invocation: true` (the model cannot invoke it and its description is not loaded), `context: fork` (runs in an isolated subagent), `allowed-tools: Bash(python3 *flow_manager.py*) Write Read Glob`.
- `scripts/block-approve-step.sh` (59 lines), PreToolUse on `Bash` (`hooks/hooks.json`, matcher `Bash`).
- `scripts/hook_extract_flow_dir.py`: regex for `--flow-dir` in the command string.
- `scripts/flow_manager.py:513-554` `cmd_approve_step`.
- `scripts/flow_manager.py:455-505` `cmd_update_step_status` (the completion gate).
- Callers' text that tells the model to hand the user the exact command: `skills/flow-new/SKILL.md` and `skills/flow-continue/SKILL.md` ("Handling Approval Checkpoints"); `block-approve-step.sh:49-52` (the block message).

Behaviour in plain words:
1. User runs `/zeremai:flow-approve <flow-dir> <step-id>` (SKILL.md lines 13-19). Without arguments the skill is meant to auto-detect the flow from `.session` files, but SKILL.md itself says a bare call "has been observed to fail silently" (forked subagent gets no task).
2. The forked subagent reads `flow.json`, shows deliverables (workflow steps 1-3, lines 23-27), writes an EMPTY file `<flow-dir>/.approve-token` with the Write tool (step 4), then runs `flow_manager.py approve-step` (step 5), then `write-pending --delete` (step 6), then prints "Step '<name>' approved successfully" (step 7).
3. `block-approve-step.sh` sees a Bash command matching `flow_manager\.py.*\bapprove-step\b` (line 19), extracts the flow dir (line 26), and if `.approve-token` exists it deletes it and allows (lines 39-43). With no token it blocks with exit 2 and a message telling the model to ask the user to run the exact command (lines 45-53). If it cannot find the flow dir it blocks (28-32). Any other Bash command passes.
4. `cmd_approve_step` sets `approved = true` on the step. It requires the step to be `approvalRequired` and `pending-interaction.json` NOT to exist (lines 531-541). So the model must first delete the pending file, or the skill's step 6 (delete) comes AFTER step 5 (approve) and would fail by this check. By reading, the skill's order (approve-step, then delete pending) contradicts the CLI's check (approve refuses while pending exists). Not run; verify. (`block-tools-on-pending.sh:50` allows Bash with `flow_manager.py`, so the hook is not the cause.)
5. The UI: the skill's Notes (line 54) say "the UI app calls approve-step directly". In `../agentic-flows-ui/electron/` there is NO `approve-step` call (only `update-qa-answer` and `complete-qa-question` at `main.ts:524-590`), and no `.approve-token` handling. Unsure how the UI approves; verify before relying on the note.
- Extra gate: `approve-step` is in `_LOG_GATED_COMMANDS` (flow_manager.py:1732-1741). The `UserPromptSubmit` hook `create-log-flag.sh` creates the `pending-log-<session>` flag on every prompt when the session is bound to a flow. So after the user types `/flow-approve`, the flag can exist, `enforce-log-first.sh:41-43` blocks `Write` (the token write) and `_check_pending_log` blocks `approve-step`, until a `log-interaction` runs. Whether the forked skill subagent shares the session id, and how it passes this gate, is unknown: verify.
- Weaknesses: the token is a file on disk any flow can create (the model can also `Write` it if the log flag is clear); the gate relies on a regex over a shell string; `context: fork` is the only thing hiding the token mechanism from the model; bare-command failure is documented in the skill.

## 3. First guess (step 3, not final)
- Verdict: replace.
- Why: the point of the skill is "only a human action can approve". A mod can see the user's own action directly, so no token, regex or forked subagent is needed.
- Mod abilities that might apply:
  - `$.command.register({ name: 'approve', argumentHint: '[step]' })` + `command.run` with `{ command: 'approve' }`: a user-typed command is not model-invokable; the handler calls `$.flow.run(['python3', flow_manager.py, 'approve-step', ...])` itself. No token, no fork, auto-detection can be done with `$.session.id`.
  - `$.ui.ask` / `Button` + `ui.press` for an in-session approve button.
  - `tool.call` with `{ tool: 'Bash' }` returning `{ deny: reason }` when the command contains `approve-step` and was not issued by the mod (the mod's own `$.flow.run` does not go through the model's Bash tool): replaces `block-approve-step.sh` completely.
  - `prompt.submit`: could detect `/flow-approve` typed text; probably not needed.
  - `$.fs` for reading `flow.json` deliverables to show them.

## 4. Research questions
1. Does a `command.run` handler run only when the USER types the command, never when the model calls it? Can the model invoke a mod command (check the `Skill` tool, `$.command.run`, and the `disable-model-invocation`-style options)?
2. Can a mod call `$.flow.run` with the approve command so that it does NOT pass through the model's `Bash` tool and its `tool.call` guard (so the deny rule does not block the mod's own call)? Check the events table: "Every mods API method is also an event" (`flow.run` event) and who fires it.
3. Is a `tool.call` deny on `Bash` commands containing `approve-step` enough to stop the model from approving, including from subagents (`e.agentId`) and including commands built indirectly (variable, script file, `python3 -c`)? How does this compare with the current regex hook, which has the same indirect-command gap?
4. How does a mod command get its target flow and step: from `e.args`, from `$.session.id` matched to the flow `.session` files, or from `$.store`? Can it list candidate steps with `$.ui.ask` when called bare (fixing the bare-command failure)?
5. Can the command show deliverables before approving (`$.ui.open` pane with `Markdown`/`Code`, or `$.ui.ask` text)?
6. Must the mod command respect the CLI's gates (log flag, pending file ordering)? Which of the two orderings conflict today (point 4 and the log-flag point in section 2) and does a mod-run call avoid them or inherit them?
7. What replaces the user-only guarantee when mods are off (admin policy, `--safe-mode`, other surfaces such as VS Code)? Keep the token hook as fallback? (See X01.)
8. Does the UI approve some other way? (Answer by searching the UI repo for how a step becomes `approved: true`; if nothing writes it, the UI cannot approve today.)

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/api#add-a-command-or-a-tool (command registration, `command.run`, built-in name clash)
   - https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call
   - https://code.claude.com/docs/en/plugins/mods/events#where-settings-hooks-run-in-the-order (order of mods and settings hooks)
   - https://code.claude.com/docs/en/plugins/mods/reference#events (Commands and configuration; "Mods API calls" paragraph)
   - https://code.claude.com/docs/en/plugins/mods/overview and `/admin` (what disables mods)
   - https://code.claude.com/docs/en/plugins/mods/interface (`$.ui.ask`, `ui.press`)
2. Search the type file for: `command.run`, `CommandRunInput`, `CommandRunResult`, `immediate`, `register(` under `command`, `flow.run`, `ToolCallInput`, `agentId`, `ask(`.
3. Read these repo files: `skills/flow-approve/SKILL.md`, `scripts/block-approve-step.sh`, `scripts/hook_extract_flow_dir.py`, `scripts/flow_manager.py:455-554` and `1732-1755`, `scripts/create-log-flag.sh`, `scripts/enforce-log-first.sh`, `skills/flow-new/SKILL.md` section "Handling Approval Checkpoints"; in the UI repo `electron/main.ts` (search `approve`) and `src/components/DiagramView/FlowStepDetailModal.tsx`.
4. Compare: today's chain (skill fork -> Write token -> Bash approve-step -> hook consumes token) against a mod chain (user command -> mod -> `$.flow.run`). Write one table row per security property (model cannot approve; user can approve from CLI; user can approve from UI).
5. Write the answer under "7. Research result".

## 6. Out of scope
No implementation. No plugin edits. No building a mod. Do not run `approve-step` against real flows. (Only items S01-S03 may build a throwaway mod outside this repo.)

## 7. Research result
Planned and built 2026-10-10 as one feature: items H07, P02 and P03 together (plan page: https://claude.ai/artifact/E6mZkfXRWuKywfs63rU9pQ). Not committed.

### Claude Code version
`2.1.296 (Claude Code)`. Type file from the `plugin-authoring` skill for this build.

### Answers per question
1. A mod tool serves the agent's ask. The user's click is the approval. No mod command was needed.
2. The mod writes `approved` itself with `$.fs.write`, so it does not pass through the Bash tool.
3. The approve command left the CLI, so there is nothing to guard. Only a hand edit of `flow.json` is left (Write, Edit, Bash text rule).
4. The mod finds the flow from the session, so a bare command problem is gone.
5. The dialog shows the step name, its output description and artifacts, and the flow folder.
6. The CLI order conflict (approve before deleting the pending file) is gone with the pending file.
7. Mods off: nothing guards (X01).
8. The UI had no approve call (found by this research). Dropped.

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
- Texts rewritten: `skills/zeremai continue`, `flow-new`, `flow-state-update`, `agents/step-executor.md`, `docs/flow-management.md`.
- Tests: `claude plugin test .` 125 pass; `claude plugin validate .` passes (one `logo` warning). `scripts/test_view_resolution.py` passes without its write-pending test.

### Evidence
- Repo before: `skills/flow-approve/SKILL.md`, `scripts/flow_manager.py` `cmd_approve_step`, `scripts/flow_manager.py` completion check (kept).

### Open questions
- Not run in a live session (S01): `$.ui.ask` as the approval dialog (time the user takes, terminal and Desktop), `$.tool.register` with `isDeferred: false`, a tool call held for the answer, `$.store` across a restart, `$.fs.write` of `flow.json`, `$.prompt.submit` after the hook has returned, a refused prompt never needed.
- A test host has no screen, so `$.ui.ask` is dismissed there. The answers are tested through `askGate`, not through the tool.
- Order of the new `tool.call` hooks against `on-pending-checkpoint`, `on-agent-editing` and `on-todo-tool`: not tested.
- If mods are off, nothing guards approval (X01).
- Step views (option `data` for steps with a `view`) were part of `write-pending`; they go with the UI move and are not rebuilt.
- A hand edit through a script file passes. Closed fully only when the mod is the only writer of the flow file (P01).
- `.approve-token` and `pending-interaction.json` may still sit in old flow folders; nothing reads them.

### What a later plan must decide
- Whether the dialog should list real output files. Today it names the step's output description and artifacts.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P03"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1-3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
