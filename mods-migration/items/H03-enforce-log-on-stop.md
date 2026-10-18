# H03 · enforce-log-on-stop

> Status and result live in `../progress.html` (entry `H03`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` (v2.0.28) is a Claude Code plugin that runs structured, resumable workflows ("flows") with steps, approval gates and Q&A. Flow state lives in JSON files under `~/.claude/zeremai/active/<flow>/` (`flow.json`, `log.json`, `pending-interaction.json`, `.session`). The plugin enforces its rules with shell hook scripts wired in `hooks/hooks.json`. Each script receives the hook JSON on stdin and answers with `{"decision":"block","reason":...}` on stdout or exit code 2 on stderr. This item is one of those enforcement pieces. The goal of the whole pack is to find out whether a Claude Code **mod** (JS/TS code running inside Claude Code, see the mods overview) can replace or improve it. The owner's bar: "a mod can do it".

## 2. What exists today
- Script: `scripts/enforce-log-on-stop.sh` (47 lines). Wired in `hooks/hooks.json` on `Stop` only (second hook of the group). Not on `SubagentStop` (header `:3-4`).
- It is the **second half of a pair**. The first half is `scripts/create-log-flag.sh` (35 lines), wired on `UserPromptSubmit` (first hook). That script finds a flow whose `.session` equals the session id (`create-log-flag.sh:19-24`) and, if found, runs `mkdir -p flags` and `touch ~/.claude/zeremai/flags/pending-log-<session_id>` (`:26-32`). Output `{"continue": true}`. So **every user prompt** in a session bound to a flow creates the flag.
- The flag is cleared only by `flow_manager.py log-interaction` (`cmd_log_interaction:858-904`; the clearing part `:894-901` reads `.session` and unlinks the flag). Nothing else deletes it (no SessionEnd cleanup; stale flags for dead sessions stay on disk).
- Stop behaviour (`enforce-log-on-stop.sh`): parse `session_id` and `stop_hook_active` (`:9`, see C01; `parse_hook_input.py:38-40` returns `"true"` only for a JSON `true`). Empty session id: allow. `stop_hook_active == true`: allow (`:16-19`, the loop guard, so the agent is blocked at most once per turn). No flag file: allow. Flag exists: scan `.session` files to find the flow dir and read `currentState.activeStep.id` (`:31-39`) only to put them into the message, then print `{"decision":"block","reason":...}` with a ready `flow_manager.py log-interaction ... --request ... --reason ... --response ...` command (`:41-46`). The block message is a bash heredoc; the flow dir and step id are spliced in without JSON escaping.
- Related enforcement of the same flag (same rule, three places):
  - `scripts/enforce-log-first.sh` (PreToolUse on `Write|StrReplace|Edit|Task`, see its own item) blocks write tools while the flag exists unless the Bash command contains `flow_manager.py` (`enforce-log-first.sh:14-30`).
  - `flow_manager.py` `_check_pending_log` (`:219-245`) refuses state-mutating CLI commands while the flag exists (`_LOG_GATED_COMMANDS`, call at `:1750-1752`; `write-pending --delete` is exempt).
  - So the flag is a cross-script protocol: UserPromptSubmit writes, three readers, one clearer (CLI).
- State: reads `flags/pending-log-<session>`, `active/*/.session`, `flow.json`. Writes nothing.
- Weaknesses seen:
  - Flag is per session and set on **every** prompt, including prompts that need no log (a "thanks", a slash command, an approval click). The agent is forced to write a log entry for each.
  - Cross-script file protocol: flag path is hard-coded in 4 places (`create-log-flag.sh:30`, `enforce-log-on-stop.sh:22`, `enforce-log-first.sh:14`, `flow_manager.py:227` and `:899`).
  - If the CLI crashes after writing `log.json` but before unlinking the flag, or the `.session` file is empty/changed, the flag cannot be cleared by the intended path (the agent is stuck unless it deletes the flag by hand, which hooks do not allow outside `flow_manager.py`).
  - Stale flags are never garbage-collected.
  - Block reason text built by heredoc (quotes in a path would break JSON).
  - No time or turn-count awareness: the "turn" is implied by prompt-then-stop.

## 3. First guess (step 3, not final)
- Verdict: **replace**.
- Why: the flag file exists only to carry "a prompt arrived and no log yet" from a `UserPromptSubmit` hook to the next `Stop` hook and to two other readers. In a mod this is one in-memory value: set it in `prompt.submit` (or `classic.UserPromptSubmit`) with `$.state`/`$.store`, check it in `classic.Stop` and `tool.call`, clear it when the log-interaction command is seen (`tool.result`/`tool.call` of a Bash command, or a mod command). No file, no cleanup issue, per-session by construction. The prompt text is available to the mod, so it could also skip trivial prompts.
- Mod abilities that might apply: `prompt.submit` (or `classic.UserPromptSubmit`), `classic.Stop` `{block}` + `stop_hook_active`, `tool.call` `{deny}` (for the PreToolUse sibling), `$.session.id()`, `$.state` / `$.store`, `$.fs`, `$.flow.run` (only if the mod still shells out to `log-interaction`), `$.command.register`.

## 4. Research questions
1. Does a mod get the **prompt text** and session id on `prompt.submit` (and is it before the model sees it)? Does it fire for slash commands and for UI-driven resumes, as `UserPromptSubmit` does today?
2. Where should the "log owed" bit live: `$.state` (per session, in memory, what happens on `/clear`, `/resume`, restart?), `$.store` (persisted, scope?), or a module variable? Which survives a `/resume` of the same session id?
3. Can a mod see that a `flow_manager.py log-interaction` command ran successfully (the `tool.result` / `tool.call` event for Bash, with the command text and exit status), so it can clear the bit itself instead of relying on the CLI unlinking a file? Or must the CLI still clear a file the mod reads (then the file protocol stays)?
4. Does `classic.Stop` input carry `stop_hook_active`, and is it set on the second stop after a block, exactly as the shell script assumes? Is it true for a subagent's stop too?
5. Is `block` from a Stop mod hook sent back to the model as a user-visible reason? Can the mod return structured guidance (`additionalContext`) rather than a heredoc string?
6. Can a mod decide that a prompt does not need a log (for example by checking the prompt against a rule) and avoid forcing a log entry on every prompt? Is that desired (product decision for a later plan)?
7. Time limit and failure mode for a `classic.Stop` hook; can a thrown error leave the user stuck (fail closed) or release them?
8. If the CLI `_check_pending_log` (`flow_manager.py:219`) must keep working for plain-terminal use outside a mod, what is the contract between mod and CLI (shared flag file kept, or CLI check dropped)? This decides whether the flag file can really disappear.

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/events , sections on `prompt.submit`, `classic.<Event>` (Stop, UserPromptSubmit), "Guard or change a tool call", "Handle a hook that fails".
   - https://code.claude.com/docs/en/plugins/mods/interface , section on `$.state` vs `$.store` vs module variables, and state after `/clear` and `/resume`.
   - https://code.claude.com/docs/en/plugins/mods/api , `$.session`, `$.store`, `$.fs`, `$.flow.run`.
   - https://code.claude.com/docs/en/plugins/mods/reference , events table (prompt.submit, tool.result, Stop rows) and Limits.
2. Search the type file for: `PromptSubmitInput`, `prompt.submit`, `UserPromptSubmit`, `StopInput`, `stop_hook_active`, `ClassicResult`, `ToolResultInput`, `tool.result`, `StateApi`, `StoreApi`, `session.id`.
3. Read these repo files: `scripts/enforce-log-on-stop.sh`, `scripts/create-log-flag.sh`, `scripts/enforce-log-first.sh`, `scripts/flow_manager.py` (`_check_pending_log` `:219`, `cmd_log_interaction` `:858`, gating sets near `:1735-1754`), `scripts/parse_hook_input.py`, `hooks/hooks.json`, `skills/flow-state-update/SKILL.md` (how the agent is told to log).
4. Compare: file-flag protocol (UserPromptSubmit creates, Stop/PreToolUse/CLI read, CLI clears) versus a mod-held bit (set on `prompt.submit`, read in `classic.Stop` and `tool.call`). Check exit-code/JSON behaviour versus `{block}`/`{deny}` and the loop guard (`stop_hook_active`).
5. Write the answer under "7. Research result". Related: see H01, H02, H04, C01, and the item for `enforce-log-first.sh`.

## 6. Out of scope
No implementation. No plugin edits. No building a mod. (Only items S01–S03 may build a throwaway mod outside this repo.) Do not run or change the plugin's scripts.

## 7. Research result

Result of the combined plan H03 + H10 + H06 (2026-10-09). The implementation sits in one PR.

### Claude Code version
`2.1.295 (Claude Code)`. Type file from the `plugin-authoring` skill for this build.

### Answers per question
1. Prompt text and session id: `prompt.submit` gives `e.text` and `e.origin`; `$.session.id()` gives the id. Origin kinds `composer | bridge | sdk` are what a person typed (type file `PromptOrigin`). Slash commands and UI resumes were not tested.
2. Where the bit lives: **one in-memory bit for each session** (owner choice, a module variable). Lost on reload, `/clear`, `/resume` and restart.
3. Seeing the log run: yes. The `tool.call` hook sees a Bash `flow_manager.py log-interaction` and clears the bit when `next(e)` returns no error and no deny.
4. `stop_hook_active`: not used. `classic.Stop` is skipped for a user-tier mod where `sec-default` loads (H01 live test). The hook uses `turn.complete` and a re-prompt count (3 in a row, reset by a user prompt).
5. The re-prompt is a new user-role prompt the model reads, built by a template (no heredoc, no JSON by hand).
6. Skipping trivial prompts: possible with `e.text`, but a product decision. Not done.
7. Failure mode: a hook that throws is skipped (fail open).
8. CLI contract: none. The CLI check and the flag file are removed.

### Final verdict
**improve**

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
Edit `../progress.html`: find the object with `"id": "H03"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
