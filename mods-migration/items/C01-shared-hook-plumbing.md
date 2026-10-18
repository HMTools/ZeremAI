# C01 · Shared hook plumbing and session lookup

> Status and result live in `../progress.html` (entry `C01`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` (v2.0.28) is a Claude Code plugin that runs structured, resumable workflows ("flows") with steps, approval gates and Q&A. Flow state lives in JSON files under `~/.claude/zeremai/active/<flow>/` (`flow.json`, `log.json`, `pending-interaction.json`, `.session`). The plugin enforces its rules with shell hook scripts wired in `hooks/hooks.json`. Each script receives the hook JSON on stdin and answers with `{"decision":"block","reason":...}` on stdout or exit code 2 on stderr. This item is the shared plumbing under those scripts: a JSON parser helper, a command-argument extractor, and the "which flow belongs to this session" lookup that is copied into most scripts. The goal of the whole pack is to find out whether a Claude Code **mod** (JS/TS code running inside Claude Code, see the mods overview) can replace or improve it. The owner's bar: "a mod can do it".

## 2. What exists today
Two helper scripts plus a pattern copied into many hook scripts.
- `scripts/parse_hook_input.py` (49 lines). Usage: `echo "$INPUT" | python3 parse_hook_input.py session_id tool_name command file_path`. Reads hook JSON from stdin (any parse error yields an empty dict, `:25-28`), then prints one `NAME='value'` line per requested field, quoted with `shlex.quote`, for the caller to `eval` (`:34-45`). Rules: `command` and `file_path` are read from `tool_input` first, then from the top level (`:36-37`); `stop_hook_active` becomes `"true"` only for JSON `true`, else empty (`:38-40`); every other field is read from the top level (`session_id`, `tool_name`); falsy values become empty strings (`:44`). Callers (10 scripts, each pays one Python flow start per hook run): `block-stop-pending-steps.sh:10`, `check-approval-stop.sh:10`, `enforce-log-on-stop.sh:9`, `block-tools-on-pending.sh:8`, `enforce-log-first.sh:8`, `check-qa-session.sh:10`, `block-todo-tools.sh:9`, `track-file-change.sh:8`, `bind-session-to-flow.sh:10`, `create-log-flag.sh:9`. (`block-approve-step.sh` does not use it; it has its own inline Python at `:9-14`.)
- `scripts/hook_extract_flow_dir.py` (10 lines). Reads a shell command from stdin and extracts the value of `--flow-dir` with two regexes: first a quoted form `--flow-dir\s+["\']([^"\']*)["\']`, then an unquoted `--flow-dir\s+(\S+)` (`:4-10`). Prints nothing if absent. Only caller: `scripts/block-approve-step.sh:26`, the guard (PreToolUse, matcher `Bash`) that blocks the `approve-step` subcommand of `flow_manager.py` unless `<flow-dir>/.approve-token` exists (`block-approve-step.sh:19-54`; it deletes the token when it allows, blocks with exit 2 + stderr otherwise, and also blocks when no flow dir can be extracted, `:28-32`). That guard first tests the command with `grep -qE 'flow_manager\.py.*\bapprove-step\b'` (`:19`).
- The **session lookup** pattern (not a separate file, copied): loop `~/.claude/zeremai/active/*/.session`, compare `$(cat $SESSION_FILE)` to the hook's `session_id`, take the first match as the flow dir. Copies: `block-stop-pending-steps.sh:20-26`, `check-approval-stop.sh:21-27`, `enforce-log-on-stop.sh:31-39`, `block-tools-on-pending.sh:17-23`, `create-log-flag.sh:19-24`, `enforce-log-first.sh:59`, `block-todo-tools.sh:27`, `check-qa-session.sh:19`, `track-file-change.sh:19`. That is **9 scripts** (README says 8). `bind-session-to-flow.sh` does not scan; it **writes** `.session`. The CLI has the same session-to-flag step in `flow_manager.py` `_check_pending_log` (`:219`) and `cmd_log_interaction` (`:895`).
- How `.session` gets its value: the agent writes an empty `.session` (`skills/flow-new/SKILL.md:81`, `skills/flow-continue/SKILL.md:39`; children at `flow-new:164`, `flow-continue:144`); the PostToolUse hook `bind-session-to-flow.sh` (matcher `Write|StrReplace|Edit`) then fills it with the session id **only if it is empty** (`:26-29`), after normalizing the written path and checking it lies under `.claude/zeremai/active/<name>/` (`:18-24`). So binding needs a Write tool call plus a hook that sees it. `skills/flow-approve/SKILL.md:45` compares `.session` to `${CLAUDE_SESSION_ID}`. The UI app also resumes sessions (`agentic-flows-ui/electron/agentSessionManager.ts`); whether it reads `.session` is unknown, check `fileWatcher.ts`.
- State: reads `~/.claude/zeremai/active/*/.session`; the two helpers write nothing.
- Known weaknesses:
  - `eval` of helper output; safe only because of `shlex.quote`, but fragile and slow (one Python start per hook, plus a second `python3 -c` in most scripts to read `flow.json`).
  - Linear scan of all active flows on every hook call, including every tool call (`block-tools-on-pending.sh`, `enforce-log-first.sh`).
  - First match wins; two flows with the same session id are indistinguishable.
  - Flow directories leave `active/` when completed or failed (`flow_manager.py:994-1009`), so enforcement silently stops for them; `paused` stays in `active/`.
  - `hook_extract_flow_dir.py` regex weaknesses: `--flow-dir=/path` (equals form) is not matched; an unquoted path with spaces is cut at the first space; only the first `--flow-dir` is used; it works on raw command text, so a `--flow-dir` inside a quoted argument of another flag can be picked up by mistake; `$VAR` or `$(...)` values are returned literally.
  - Windows path hacks in two places (`block-approve-step.sh:35`, `bind-session-to-flow.sh:18`).
  - Everything fails open: a missing `python3` makes `eval` receive nothing and each script exits 0.

## 3. First guess (step 3, not final)
- Verdict: **replace**.
- Why: in a mod all of this disappears. The event input is already typed (session id, tool name, tool input with `command` and `file_path`, `stop_hook_active`), so `parse_hook_input.py` has no job. The session lookup becomes one function or one cached value inside the mod, and with `$.session.id()` plus `$.store` / `$.state` the mod could remember "this session belongs to flow X" itself, instead of relying on an agent `Write` plus a PostToolUse hook. For `hook_extract_flow_dir.py` the Bash `command` is still a string, so the regex problem may remain unless the mod gets a parsed command, or the guarded action moves to a user-only mod command (`$.command.register`) that the model cannot call.
- Mod abilities that might apply: typed event inputs (`ToolCallInput`, `ClassicResult` inputs), `$.session.id()`, `$.state`, `$.store`, `$.fs` (reading `.session` if the file contract stays), `$.command.register`, `tool.call` `{deny}`, `$.flow.run`.

## 4. Research questions
1. Do the typed event inputs in the type file carry everything `parse_hook_input.py` extracts: session id, tool name, `tool_input.command`, `tool_input.file_path`, `stop_hook_active`? Any field missing or renamed (for example `toolName`, `input`)?
2. Does `$.session.id()` return the same id Claude Code puts into settings-hook `session_id` and into `${CLAUDE_SESSION_ID}` (used by `skills/flow-approve/SKILL.md:45`)? Does it change on `/clear`, `/resume`, compaction?
3. Can the session-to-flow mapping live in `$.store` (persisted) or `$.state`? What scope does each have (per session, per project, global), what survives restart and `/resume`? The README decision is that the JSON files stay the contract with the UI app, so does `.session` have to stay on disk for the UI and for the CLI check `_check_pending_log`?
4. If `.session` stays on disk, can a mod write it directly (on flow creation or at session start) so the agent-writes-empty-file-then-PostToolUse trick (`bind-session-to-flow.sh`) is no longer needed? Which event gives the flow dir (a `$.command` handler, `tool.result` of a Write, a session-start event)?
5. For `hook_extract_flow_dir.py`: does a mod get the Bash command as a plain string only, or a parsed form? Is a better design to deny the approval subcommand in Bash unconditionally and offer approval only through a mod command the model cannot invoke (`$.command.register`)? Do mod commands run with user-only authority?
6. How expensive is a per-call lookup in a mod (scan of `active/*/.session` with `$.fs` on every `tool.call` versus a cached map)? What are the `$.fs` limits (Limits on the Reference page)?
7. When mods are off (admin policy, `--safe-mode`), the shell scripts and helpers must keep working if they stay as fallback. Can the plugin keep both without double enforcement? (Link to X01.)

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/events , basics of `on(event, matcher, ($, e, next) => ...)`, "Guard or change a tool call", `classic.<Event>`.
   - https://code.claude.com/docs/en/plugins/mods/api , `$.session`, `$.store`, `$.fs`, `$.command`, `$.flow.run`.
   - https://code.claude.com/docs/en/plugins/mods/interface , `$.state` vs `$.store` vs module variables; state after `/clear` and `/resume`.
   - https://code.claude.com/docs/en/plugins/mods/reference , input and result shapes in the events table; Limits.
   - https://code.claude.com/docs/en/plugins/mods/admin , policy switches.
2. Search the type file for: `session_id`, `SessionApi`, `session.id`, `ToolCallInput`, `stop_hook_active`, `StoreApi`, `StateApi`, `CommandApi`, `command.register`, `FsApi`, `ClassicResult`.
3. Read these repo files: `scripts/parse_hook_input.py`, `scripts/hook_extract_flow_dir.py`, `scripts/block-approve-step.sh`, `scripts/bind-session-to-flow.sh`, the nine scripts listed in section 2, `hooks/hooks.json`, `skills/flow-new/SKILL.md` and `skills/flow-continue/SKILL.md` (steps that write `.session`), `skills/flow-approve/SKILL.md`, `scripts/flow_manager.py` (`:219`, `:858`, `:994`), and in the sibling repo `../agentic-flows-ui/electron/agentSessionManager.ts` and `fileWatcher.ts` (does the UI read or write `.session`?).
4. Compare: shell plumbing (stdin JSON, `eval`, per-hook Python start, directory scan, regex over command text) versus mod (typed input, one shared function, `$.session.id()`, optional cache), and list which parts of the `.session` file are a **contract with other readers** (CLI, UI) and must stay.
5. Write the answer under "7. Research result". Related: see H01, H02, H03, H04, and X01.

## 6. Out of scope
No implementation. No plugin edits. No building a mod. (Only items S01–S03 may build a throwaway mod outside this repo.) Do not run or change the plugin's scripts.

## 7. Research result

Built as well as researched, at the owner's request (plan page "Session Lookup in the Store", 2 decisions kept, 1 changed: the link lives in the mod store).

### Claude Code version
2.1.296 (Claude Code)

### Answers per question
1. **Yes for the fields the mod uses.** The hooks read `e.tool`, `e.command`, `e.file_path`, `e.agentId` and `$.session.id()`. Typed input replaced `parse_hook_input.py`; its callers are gone and the file is deleted. `stop_hook_active` not checked (H01).
2. **Not verified live.** Same id as the hook `session_id` and `${CLAUDE_SESSION_ID}` is assumed (S02). A resumed session has a new id, so `bind_flow` links it again.
3. **Yes, `$.store`.** Key `session:<id>` holds the folders the session bound, oldest first (`hooks/infra/flow-repository/flow-repository.ts`). The store survives a restart. The `.session` file is no longer written or read. The UI app is obsolete (owner, 2026-10-10), so no file stays for it.
4. **Yes.** `bindSession` (`hooks/infra/flow-manager/bind-session.ts`), called by `bind_flow` and `create_flow`, adds the folder. Nothing in the plugin needs the file.
5. **Done differently.** `hook_extract_flow_dir.py` went with H07 (approval is a mod dialog, no command to guard).
6. **Cheap.** A lookup is one store read plus one `flow.json` exists-check for each folder on the list, newest first. No folder scan.
7. **No fallback.** Every flow tool is a mod tool, so with mods off the plugin cannot change a flow (X01).

New behaviour: a child flow is bound after its parent, so it answers first. When the child leaves `active/`, the parent answers again. Before, the first folder listed won.

### Final verdict
**replace.** The shell helpers are gone. The lookup is one function over the mod store.

### Evidence
- Changed: `hooks/infra/flow-repository/flow-repository.ts`, `hooks/infra/ports/ports.ts` (`SessionLinks`), `hooks/infra/flow-manager/bind-session.ts`, `hooks/on-flow-tools/on-flow-tools.ts`, and a `linksOf($)` in 6 hook files; `types/flow-instance.ts` comment.
- Deleted: `scripts/parse_hook_input.py`.
- Tests: `claude plugin test .` gave 205 pass, 0 fail. New cases: child before parent, folder gone, rebind order.

### Open questions
- Does `$.session.id()` equal the hook `session_id`, and does it change on `/clear`, `/resume`? (S02)
- Does `$.store` keep the list over a real restart? (not run)
- A flow that runs during the upgrade is unlinked until the agent calls `bind_flow`.

### Risks
- Entries in `session:<id>` are never removed. Each is small and a gone folder never answers.
- `$.store` is shared across sessions on the machine; two sessions that bind the same folder both answer for it (as before).
- Read and write of the list is not atomic. Two binds at the same moment in one session could lose one.

### What a later plan must decide
- Remove old `session:<id>` keys (on `session.end` or by age).
- Whether the six `linksOf($)` copies can go once a mod can share `$` across files.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "C01"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
