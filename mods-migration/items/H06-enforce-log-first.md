# H06 · enforce-log-first

> Status and result live in `../progress.html` (entry `H06`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs structured, resumable workflows ("flows") from templates, with steps, approval gates and Q&A. State is JSON under `~/.claude/zeremai/active/<flow>/`. Shell hooks in `hooks/hooks.json` enforce rules. This item, `scripts/enforce-log-first.sh`, is a `PreToolUse` hook that makes Claude "log first": after every user prompt in a bound session a flag file is created (by H10); until Claude records that interaction with `flow_manager.py log-interaction`, file-changing tools are blocked. A mod could replace the flag file with in-memory state. Related: H10 (creates the flag), H09, H08, C01, and the Stop-side script `scripts/enforce-log-on-stop.sh` (not in this group; it reads the same flag, so the flag cannot be removed without handling it).

## 2. What exists today
- Wiring: `hooks/hooks.json:44-53`. Event `PreToolUse`, matcher `Write|StrReplace|Edit|Task`.
- Script `scripts/enforce-log-first.sh` (91 lines):
  - Parses `session_id tool_name file_path command` with `parse_hook_input.py` (`:8`). Empty session: exit 0.
  - Flag path `~/.claude/zeremai/flags/pending-log-<session_id>` (`:15`). No flag: exit 0 (`:18-20`). Note the flag is keyed by session id only; the flow is not consulted for the decision.
  - If the tool is `Bash`/`PowerShell` and the command contains `flow_manager.py` anywhere: allow (`:25-35`). Substring only, so `echo flow_manager.py > file` or `cat x > y # flow_manager.py` is allowed (bypass).
  - Block set (`:38-53`): `Write|Edit|StrReplace|Task` always; `Bash|PowerShell` when the command contains any of `>`, `>>`, `tee`, `write`, `sed -i`, `rm `, `mv `, `cp `. Everything else (Read, Grep, Glob, Bash that does not match, MCP tools, `MultiEdit`, `NotebookEdit`) is allowed. The hooks.json matcher only sends `Write|StrReplace|Edit|Task`, so the Bash/PowerShell branches are **dead code**: no Bash call ever reaches the script (the Bash matcher entry at `hooks.json:54-63` runs only `block-approve-step.sh`). Also `StrReplace` is not a Claude Code tool name that I verified (it looks like a Cursor leftover).
  - On block: finds the flow dir via the `.session` lookup (`:59-68`) and reads `currentState.activeStep.id` with an inline `python3 -c` that interpolates the path into the code (`:64`), then prints on **stdout** `{"decision":"block","reason":"User interaction not yet logged. ... python3 <script_dir>/flow_manager.py log-interaction --flow-dir ... --step-id ..."}` and exits 0 (`:70-88`). The reason text is built by an unquoted heredoc with embedded newlines inside a JSON string, so the output is not always valid JSON (raw newlines in a JSON string are invalid; path characters such as quotes would also break it). Unverified how Claude Code treats that; assume risk.
  - Same open point as H05: top-level `decision: "block"` for `PreToolUse` versus `hookSpecificOutput.permissionDecision` (repo docs `docs/claude/claude-code-hooks-reference.md:300-310`).
- Second enforcement layer inside the CLI: `scripts/flow_manager.py:219-246` `_check_pending_log` refuses state-mutating subcommands (`_LOG_GATED_COMMANDS`, `flow_manager.py` near `:1735`) while the flag exists for the flow's `.session`. `cmd_log_interaction` clears the flag (`flow_manager.py:894-901`). So even without the hook, the CLI enforces part of the rule.
- State: reads `flags/pending-log-<session>`, `active/*/.session`, `flow.json`. Writes nothing.
- Consequence to note: a block applies to every Write/Edit in the session, including edits unrelated to the flow, until the log call is made. And the user prompt is "owed a log" for every prompt, even a trivial one. The flag is never expired; it is removed only by `log-interaction`. `Stop` side: `scripts/enforce-log-on-stop.sh:21-22` also reads the flag.
- Flags are never cleaned on session end or flow completion (stale flags can accumulate in `flags/`); not verified whether anything deletes them.

## 3. First guess (step 3, not final)
- Verdict: replace
- Why: the flag file exists only because separate hook flows cannot share memory. A mod can keep "a log is owed" as `$.state` or a module variable, set it in `prompt.submit` (see H10) and clear it when it sees the `log-interaction` Bash call, and deny with `tool.call { deny }`. But `flow_manager.py log-interaction` also clears the file flag and `_check_pending_log` reads it, so a full replacement must decide who owns the flag (mod, CLI, or both).
- Mod abilities that might apply: `on('tool.call', { tool: ['Write','Edit','MultiEdit','NotebookEdit','Task'] }, ...)` returning `{ deny }`; the Bash tool call `e.command` (to detect `log-interaction`); `await next(e)` then inspect the result to know the log call succeeded (clear the pending state only on success); `$.store` (cross-session, survives restart) vs `$.state` vs module variable; `$.session.id()`; `$.agent.list()`; `prompt.submit` to set the flag (see H10); `classic.Stop` for the stop-side check; `.catch` for fail-closed.

## 4. Research questions
1. Can a mod keep a per-session "log owed" marker and clear it reliably when the `log-interaction` command succeeds (observe `tool.call` for Bash with `await next(e)` and read `result.isError`)? Or does the CLI flag file still need to exist because `_check_pending_log` and `enforce-log-on-stop.sh` read it?
2. Which storage fits: `$.state`, `$.store`, module variable, or the existing flag file? What happens to each after `/clear`, `/resume`, `/branch`, compaction, and after the Claude Code flow restarts?
3. Does `tool.call` fire for Write, Edit, MultiEdit, NotebookEdit and the subagent tool, and for subagent calls (`agentId`)? Does today's script see a subagent's Writes (same `session_id`)? What should be the rule for subagents (the step-executor writes files)?
4. Can a mod matcher distinguish a `Bash` command that is the `log-interaction` call from other Bash calls better than the substring `flow_manager.py` (for example by parsing `e.command`)? Does that close the `echo flow_manager.py > x` bypass?
5. Which settings-hook behaviours must be reproduced: fail-open on any error, 10 s limit, order versus other `PreToolUse` hooks (`block-tools-on-pending.sh`)? Which should be fail-closed with `.catch`?
6. What does Claude see when `deny` is returned (tool result text) compared with the current multi-line `reason`? Does the prompt text survive the cache/transcript?
7. Does the same idea work for the Bash branch that is dead today (should a replacement also guard Bash writes, or keep today's actual behaviour)?
8. Can the "log owed" requirement be restated as a mod behaviour that needs no block at all (for example `prompt.submit` adds `context` telling Claude to log first, or `tool.call` logs automatically with `$.flow.run`), and is that better?

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call (deny, `await next(e)` then check `result.isError`)
   - https://code.claude.com/docs/en/plugins/mods/events#rewrite-or-add-to-a-prompt (`prompt.submit` `context`/`drop`)
   - https://code.claude.com/docs/en/plugins/mods/events#handle-a-hook-that-fails (`.catch`, fail-closed)
   - https://code.claude.com/docs/en/plugins/mods/events#where-settings-hooks-run-in-the-order
   - https://code.claude.com/docs/en/plugins/mods/interface#keep-state and `#save-from-more-than-one-session` (`$.state` vs `$.store` vs module variable, after `/clear` and `/resume`)
   - https://code.claude.com/docs/en/plugins/mods/reference#events and `#limits`
2. Search the type file for: `ToolCallInput`, `ToolCallResult`, `isError`, `agentId`, `PromptSubmitInput`, `session.end`, `$.store`, `StoreApi`, `session.id`.
3. Read these repo files: `scripts/enforce-log-first.sh`, `scripts/enforce-log-on-stop.sh`, `scripts/create-log-flag.sh`, `hooks/hooks.json`, `scripts/flow_manager.py:219-246` and `:858-905` and `:1735-1760`, `skills/flow-state-update/SKILL.md` (how Claude is told to log).
4. Compare with: settings hook JSON `decision: block` / exit codes versus `{ deny }`; matcher differences (hooks.json matcher regex versus `{ tool }` array); dead Bash branches; ordering with `block-tools-on-pending.sh` (both PreToolUse; settings hooks run after the last mod calls `next`); failure behaviour (script fails open; mod default is skip, `.catch` can fail closed); time limits.
5. Write the answer under "7. Research result".

## 6. Out of scope
No implementation. No plugin edits. (Only items S01–S03 may build a throwaway mod outside this repo.)

## 7. Research result

Result of the combined plan H03 + H10 + H06 (2026-10-09). The implementation sits in one PR.

### Claude Code version
`2.1.295 (Claude Code)`. Type file from the `plugin-authoring` skill for this build.

### Answers per question
1. The marker is an in-memory bit; the hook clears it when it sees `log-interaction` succeed (`next(e)` result has no `isError` or `deny`).
2. Storage: a module variable (owner choice). Lost on mod reload, `/clear`, `/resume`, restart.
3. `tool.call` fires for the listed tools. `e.agentId` is set in a subagent; the hook lets those pass (owner choice). The old script refused them (same session id).
4. The `flow_manager.py` substring test is gone: only Write, Edit, MultiEdit, NotebookEdit, Agent and Task are refused. Bash always passes, as in the live script (its Bash branch never ran).
5. Failure: a hook that throws is skipped (fail open). Time limit not a problem (a few small file reads).
6. What Claude sees: the `deny` text arrives as the tool error. Live test: the agent quoted it and ran `log-interaction`.
7. Dead Bash branch: dropped, behaviour unchanged.
8. A no-block design (context, or the mod logging for the agent): not tried.

### Final verdict
**replace**

### Implemented (2026-10-09, branch `feat/h01-stop-guard-mod`, one PR for H03, H10 and H06, not committed)
Plan page: the `visual-plan` artifact "Log-First Rule as a Mod, in One PR" (it still shows the first design with a flag file; the owner then chose an in-memory bit, described here). Owner choices: **"log owed" is one in-memory bit for each session, no file** (`hooks/infra/log-owed/log-owed.ts`); log first when a step rule and the log rule both apply; at most 3 log prompts in a row (shared with the step rule); a subagent's own tool calls pass; the edit block covers Write, Edit, MultiEdit, NotebookEdit, Agent, Task.
- `hooks/on-user-prompt/on-user-prompt.ts`: the one `prompt.submit` hook (a plugin cannot have two without a matcher). A prompt that is not from the plugin restarts the re-prompt count (as before) and, in a session with a flow, marks the log as owed (**H10**). A prompt the plugin sends owes nothing.
- `hooks/on-agent-stopping/on-agent-stopping.ts`: the log rule runs first in `promptToContinue` (**H03**; native `turn.complete` re-prompt, as H01).
- `hooks/on-agent-editing/on-agent-editing.ts`: `tool.call` returns `{ deny: text }` while the log is owed for Write, Edit, MultiEdit, NotebookEdit, Agent, Task, and for a Bash `flow_manager.py` command that changes the flow (**H06**, and the Python check it replaces). A Bash `flow_manager.py log-interaction` that succeeds clears the bit; a failed one, or a command that only mentions it, does not.
- `scripts/flow_manager.py`: `_check_pending_log`, its gated-command set and the flag deletion in `log-interaction` are removed. No flag file exists any more.
- Removed: `scripts/enforce-log-on-stop.sh`, `scripts/create-log-flag.sh`, `scripts/enforce-log-first.sh` and their `hooks.json` entries.
- Tests: 62 pass (`claude plugin test .`). A test cannot send a prompt as the user or share state with the test file, so the bit is driven through the prompt hook.
- Live test (`claude -p --plugin-dir`, fake flow bound to the session id): `Write` was refused with the log text, the agent ran `log-interaction`, the bit cleared, and the second `Write` worked. No flag file was written.
- Not live-tested: the turn-end log prompt; a subagent's calls passing; the `Agent`/`Task` refusal; a plugin prompt owing nothing; the first prompt of a session before `.session` is bound (H08).

### Evidence
- Type file `claude-code.d.ts`: `PromptSubmitInput`, `PromptOrigin`, `ToolCallResult` (`deny`), `ToolCallInput` (`agentId`), `$.fs.write` ("creating it and its directories"), `$.prompt.submit`.
- Repo: the removed scripts (see git history), the removed `_check_pending_log` in `scripts/flow_manager.py`, `hooks/hooks.json`.
- Plan page: https://claude.ai/artifact/5VCyr6pqKKDNSB7cCNbybw

### Risks
- With mods off (`--safe-mode`, an organization policy, a crashed hooks worker) no log rule runs: no reminder, no edit block, no gate on the flow commands. Same choice as H01.
- A subagent's edits pass while a log is owed, so a step can run before the log entry exists (owner choice). The old script refused them.
- The log is still owed after every user prompt, also on "thanks" and slash commands. Skipping those is a later product decision.
- The log text names the skill, not the script path, because a mod does not know the path.
- `tool.call` tool names (`Agent`, `Task`) are not in the type file; the names are taken from the old script and Claude Code's current tool.
- The first prompt in a new session is not covered, because `.session` is bound only after it (H08).

### Open questions
- The bit is lost on a mod reload, `/clear`, `/resume` or restart: the agent then owes nothing until the next prompt. Acceptable?
- Plain-terminal use of `flow_manager.py` no longer has a log gate.
- Does the turn-end log prompt work in a live run, and do two prompts at once (log rule plus step rule) ever occur? (The code sends one.)
- Should the flag skip slash commands and trivial prompts?
- Should a later change move the flag into the mod and drop the Python check? (Needs a plain-terminal story.)

### What a later plan must decide
- The first-prompt gap (H08 and C01).
- Whether to ship a settings-hook fallback for mods-off machines (X01).

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "H06"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
