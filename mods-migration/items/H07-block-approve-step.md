# H07 · block-approve-step

> Status and result live in `../progress.html` (entry `H07`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") with steps, approval gates and Q&A, storing state as JSON under `~/.claude/zeremai/`. Some steps have `approvalRequired: true` and must be approved by the **user**, not by the agent. This item, `scripts/block-approve-step.sh`, is the "Layer 3" hook of that user-only approval design (`docs/flow-management.md:110-115`): a `PreToolUse` hook on Bash that refuses `flow_manager.py approve-step` unless a one-time `.approve-token` file exists. The token is written by the user-invoked skill `/flow-approve`. A mod could do this more directly, for example by telling "the user's slash command" apart from "the agent's Bash call". Related: H05, H06, H08, C01, and P-items for the `flow-approve` skill and `approve-step` in `flow_manager.py`.

## 2. What exists today
- Wiring: `hooks/hooks.json:54-63`. Event `PreToolUse`, matcher `Bash`.
- Script `scripts/block-approve-step.sh` (59 lines):
  - Extracts `tool_input.command` with an inline `python3 -c` (`:9-14`). Does not use `parse_hook_input.py`; does not read `session_id`.
  - Trigger test (`:19`): `echo "$COMMAND" | grep -qE 'flow_manager\.py.*\bapprove-step\b'`. A comment (`:16-18`) says an earlier bare substring match on `approve-step` fired on unrelated commands. Not matching: a command that reaches `approve-step` without the literal `flow_manager.py` before it on the same line (for example `cd scripts; python3 pm.py approve-step`, a copied script, `python3 -m`, a shell variable, `bash -c "$(...)"`, a wrapper script, command built across lines with `grep` being line-based). `.` in grep also does not cross newlines. Those are bypasses of the guard.
  - Flow dir: `scripts/hook_extract_flow_dir.py` regex-extracts `--flow-dir "..."`, `'...'` or the first unquoted word (`:26`). Weaknesses: `--flow-dir=PATH` (with `=`) is not matched, so the dir is empty and the command is **blocked** (fail-safe); two `--flow-dir` flags, or a quoted path with spaces and unquoted form, take the first.
  - If no dir: writes the block JSON to **stderr** and `exit 2` (`:28-32`).
  - Windows normalisation `sed 's|^C:|/c|; s|\\|/|g'` (`:35`).
  - Token path `$FLOW_DIR/.approve-token` (`:37`). If it exists: **deletes it** (`rm -f`), prints `{}` to stdout and exit 0 (`:39-43`). Consumed on first use. If missing: reads the active step id from `flow.json` and prints to stderr `{"decision":"block","reason":"Step approval is user-only. Tell the user to run this exact command: /zeremai:flow-approve <dir> <stepId>"}` and `exit 2` (`:45-53`).
  - Not an approve-step command: prints `{}` exit 0.
- Who writes the token: `skills/flow-approve/SKILL.md:26` says the skill "writes an empty file `.approve-token` in the flow directory" (step 4), then runs `flow_manager.py approve-step` (step 5, `:27-31`), then deletes the pending interaction (step 6). The skill uses `context: fork` and is `disable-model-invocation: true` (`SKILL.md:52-53`), so only the user can invoke it and it runs in a forked subagent. The UI channel calls `approve-step` directly, no hook, no token (`SKILL.md:54`).
- Token is not session or user bound: the script only checks that the file exists. Anything that can write the file can approve. The sibling hook `scripts/block-tools-on-pending.sh:41` explicitly **allows** Write/Edit to `*.approve-token` while an approval is pending, so the agent itself is allowed to create the token with the Write tool and then call `approve-step`, which defeats "user-only". The design therefore relies on the agent not knowing the mechanism (`SKILL.md:52`). Treat as a known weakness.
- Flow-manager side: `flow_manager.py:513-` `cmd_approve_step` validates that the step has `approvalRequired` and that `pending-interaction.json` is absent (`:530-535`). `_check_pending_approval` at `flow_manager.py:249` guards other commands. Neither verifies a token.
- Because the hook triggers on the forked subagent's Bash call too, the PreToolUse input for it carries the forked agent's data; whether the hook JSON has `agent_id` there is something to check (hooks reference `docs/claude/claude-code-hooks-reference.md:530,540` lists `agent_id` for subagent events).
- Fails: the Python one-liner errors are silenced (`2>/dev/null`); an empty `COMMAND` means "not an approve command" and is allowed (fail-open for malformed input).
- State: reads `.approve-token`, `flow.json`; deletes `.approve-token`.

## 3. First guess (step 3, not final)
- Verdict: replace
- Why: the whole token dance exists to prove "a human asked for this". A mod can see the **user's slash command or prompt** (`prompt.submit`, `command.run`) and the agent's Bash call (`tool.call`) in the same flow memory, so it can allow `approve-step` only when the user's own command or message authorised it, without a file token the agent could forge. It can also parse `e.command` in JS instead of regex-grepping, and fail closed with `.catch`.
- Mod abilities that might apply: `on('tool.call', { tool: 'Bash' }, ...)` returning `{ deny }`; `$.command.register` (a `/approve` command the user runs, which itself calls `flow_manager.py approve-step` through `$.flow.run`, so the agent never needs Bash access to approve); `on('command.run')`/`prompt.submit` to record a one-time user approval in `$.state`/module memory; `agentId` on `tool.call` to deny when a subagent calls it; `$.flow.run` (30 s limit) to run the CLI; `$.ui.ask` to ask the user for confirmation at deny time (docs: "Hold a tool call until the user decides"); `.catch` fail-closed.

## 4. Research questions
1. Can a mod make approval truly user-only? Concretely: can the agent forge the user's authorisation, via `$.command.run`, `$.prompt.submit({ asUser: true })`, or by writing a state file? What can the model not reach from inside a session?
2. Does `$.ui.ask` in a `tool.call` hook (hold the call until the user picks "Approve") replace the token and the `/flow-approve` skill entirely? What happens in `claude -p` or headless runs where nobody can answer, and in the Desktop app?
3. Does `$.command.register('approve', ...)` give a user-only entry point (a slash command the model cannot invoke), and can that command call `approve-step` through `$.flow.run` so the Bash hook is no longer on the path?
4. Does `tool.call` fire for the forked-skill subagent's Bash calls, with `agentId`, and does the settings hook see the same event? Is a skill with `context: fork` an `$.agent` entry?
5. Which bypasses of today's regex (`flow_manager.py.*\bapprove-step\b`, `--flow-dir=` form, wrapper scripts, multi-line commands) still exist if a mod parses the same string? Would a better rule be "any Bash command that can reach `approve-step`" or "deny every Bash call touching `flow_manager.py approve-step` and offer the user command"?
6. Failure behaviour: today unparsable input is fail-open for non-matching commands and fail-closed for matches without a dir. What does a mod do on throw/timeout without `.catch`, and what should it do?
7. Ordering and coexistence: if the settings hook stays installed (for admin-policy fallback, see X01) and a mod is added, which runs first, and can the mod's `{ deny }` and the script's exit 2 conflict or double-consume the token?
8. If mods are switched off (`allowManagedModsOnly`, `--safe-mode`), is the guard gone while the skill still tells the agent how to approve? Does a settings-hook fallback have to stay?

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call, including "Hold a tool call until the user decides" (`$.ui.ask`) and "Approve or refuse a tool call before the user is asked" (`tool.check`)
   - https://code.claude.com/docs/en/plugins/mods/events#handle-a-hook-that-fails (`.catch`)
   - https://code.claude.com/docs/en/plugins/mods/events#where-settings-hooks-run-in-the-order
   - https://code.claude.com/docs/en/plugins/mods/api#add-a-command and `#reach-files-flows-and-the-network` (`$.command.register`, `$.flow.run`)
   - https://code.claude.com/docs/en/plugins/mods/reference#events (Tools, Commands, Subagents) and `#limits`
   - https://code.claude.com/docs/en/plugins/mods/admin and `.../overview` ("where mods run")
2. Search the type file for: `ToolCallInput`, `agentId`, `ui.ask`, `command.register`, `CommandRunInput`, `flow.run`, `prompt.submit`, `asUser`, `agent.list`, `isTeammate`.
3. Read these repo files: `scripts/block-approve-step.sh`, `scripts/hook_extract_flow_dir.py`, `skills/flow-approve/SKILL.md`, `docs/flow-management.md:100-120`, `scripts/block-tools-on-pending.sh:35-45`, `scripts/flow_manager.py:513-600` and `:249-280`, `../agentic-flows-ui/electron/main.ts` (grep `approve-step` for the UI path).
4. Compare with: exit 2 plus stderr JSON versus `{ deny }`; the one-shot file token versus in-memory authorisation; fork skill subagent versus mod command; fail-open on empty command versus `.catch`; ordering with `block-tools-on-pending.sh` (also PreToolUse).
5. Write the answer under "7. Research result".

## 6. Out of scope
No implementation. No plugin edits. (Only items S01–S03 may build a throwaway mod outside this repo.)

## 7. Research result
Planned and built 2026-10-10 as one feature: items H07, P02 and P03 together (plan page: https://claude.ai/artifact/E6mZkfXRWuKywfs63rU9pQ). Not committed.

### Claude Code version
`2.1.296 (Claude Code)`. Type file from the `plugin-authoring` skill for this build.

### Answers per question
1. Can a mod make approval user-only? Mostly: the agent cannot click, and the only writer of `approved` is the mod. The hand-edit rule is a guess for Bash (see open questions).
2. `$.ui.ask` replaces the token and the skill: the dialog is the approval. In `claude -p` it rejects, so nothing is approved.
3. A mod command was not needed: the tool plus the reopening dialog cover a closed dialog.
4. A forked skill call and `agentId`: moot, the skill is gone. The new hooks pass subagent calls to the same rule.
5. Bypasses of the old regex: moot, the approve command is gone. The new Bash rule reads the whole command text.
6. Failure: the hand-edit guard has a `.catch` that refuses. The gate hooks leave a call alone when they fault (as the other hooks); the dialog never approves on a fault.
7. Coexistence: the settings hook is removed, so no double token use.
8. Mods off: the guard is gone. The settings-hook fallback was dropped (X01).

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
- Repo before: `scripts/block-approve-step.sh`, `skills/flow-approve/SKILL.md:26`, `hooks/infra/pending-checkpoint/pending-checkpoint.ts:19-20` (the Write exception).
- Type file: `tool.register`, `ui.ask`, `tool.call` (`deny`, `.catch`), `store`, `fs.write`.

### Open questions
- Not run in a live session (S01): `$.ui.ask` as the approval dialog (time the user takes, terminal and Desktop), `$.tool.register` with `isDeferred: false`, a tool call held for the answer, `$.store` across a restart, `$.fs.write` of `flow.json`, `$.prompt.submit` after the hook has returned, a refused prompt never needed.
- A test host has no screen, so `$.ui.ask` is dismissed there. The answers are tested through `askGate`, not through the tool.
- Order of the new `tool.call` hooks against `on-pending-checkpoint`, `on-agent-editing` and `on-todo-tool`: not tested.
- If mods are off, nothing guards approval (X01).
- Step views (option `data` for steps with a `view`) were part of `write-pending`; they go with the UI move and are not rebuilt.
- A hand edit through a script file passes. Closed fully only when the mod is the only writer of the flow file (P01).
- `.approve-token` and `pending-interaction.json` may still sit in old flow folders; nothing reads them.

### What a later plan must decide
- Whether the Bash write rule is enough, or the mod becomes the only writer (P01).

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "H07"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
