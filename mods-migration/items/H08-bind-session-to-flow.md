# H08 · bind-session-to-flow

> Status and result live in `../progress.html` (entry `H08`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") from templates, storing state as JSON under `~/.claude/zeremai/active/<flow>/`. Every enforcement hook has to know which flow the current Claude Code session belongs to. The link is a plain-text file `.session` in the flow folder holding the session id. This item, `scripts/bind-session-to-flow.sh`, is the `PostToolUse` hook that writes that file. Without it all other enforcement hooks are "silently disabled" (`skills/flow-continue/SKILL.md:44`). It is the root of the session-lookup design that C01 covers. A mod can know the session id directly (`$.session.id()`), so this item is the key test of whether the `.session` file is still needed.

## 2. What exists today
- Wiring: `hooks/hooks.json:65-81`. Event `PostToolUse`, matcher `Write|StrReplace|Edit`, first of two hooks (the second is `track-file-change.sh`, see H09). The two run in the listed order; whether they run in parallel or serially is not verified (they both read `.session`, so order could matter).
- Script `scripts/bind-session-to-flow.sh` (34 lines):
  - Parses `session_id file_path` (`:10`). Empty either: print `{}`, exit 0.
  - Normalises the path: `tr '\\' '/'` and collapse repeated `/` (`:18`).
  - Acts only if the path matches the glob `*/.claude/zeremai/active/*/*` (`:21`). Extracts the flow dir with sed `\(.*/.claude/zeremai/active/[^/]*\)/.*` (`:23`).
  - If the directory exists and `.session` is missing **or its trimmed content is empty**, it writes `$SESSION_ID` (`:24-30`). It never overwrites a non-empty value.
  - Always prints `{}` and exit 0.
- How it is triggered: `skills/flow-continue/SKILL.md:36-41` tells Claude to `Write(.session, "")` (empty content) in the flow directory as its first action, and the hook fills it; then verify it is non-empty. The same is repeated for child flows at `skills/flow-continue/SKILL.md:144` (also check `skills/flow-new/SKILL.md` and `agents/flow-spawner.md` for how new flows get bound, not read here). So the file is created by Claude via the Write tool, with the hook completing the job: a hook-dependent handshake.
- Any Write/Edit to any file under `active/<p>/` by the session (for example `flow.json`) also binds an unbound flow, which means a session that merely edits a flow file for any reason claims it. A flow directory already bound to another session id stays bound; there is no unbind. Resumed sessions get a new session id, so the file is stale until it is cleared and rebound (that is why `flow-continue` writes the empty file). The deprecated field in `types/flow-instance.ts:102-104` documents that session binding moved from `flow.json` to this file.
- Readers: eight hook scripts compare `.session` content to the hook's `session_id` (see C01): `block-todo-tools.sh:27-33`, `enforce-log-first.sh:59`, `create-log-flag.sh:19`, `check-qa-session.sh:19`, `track-file-change.sh:19`, `block-tools-on-pending.sh:17`, `check-approval-stop.sh:21`, `block-stop-pending-steps.sh:20`. Also `scripts/flow_manager.py:219-228` (`_check_pending_log`) and `:894-901` (`cmd_log_interaction`) read `.session` to find the flag name. The UI app reads it too: `../agentic-flows-ui/electron/agentSessionManager.ts:482-530` (detects "unmanaged" sessions by `.session` file; PIDs are not used) and `skills/flow-approve/SKILL.md:41-45` (auto-detect via `${CLAUDE_SESSION_ID}`). So the file is also a **contract with the UI**; the owner decided UI keeps the same files (`../README.md`, "Decisions already made").
- Comparison inconsistencies: some scripts trim whitespace (`track-file-change.sh:21`, `bind-session-to-flow.sh:27`), others compare the raw content (`$(cat ...)`, which strips only trailing newlines). A `.session` written by a tool with an extra space would match in one and not in another. `echo "$SESSION_ID" > file` adds a newline, which `$(cat)` strips.
- Weakness: relies on PostToolUse of Write/Edit only. A `.session` written by Bash (`echo > .session`) does not trigger it. `StrReplace` is not a verified Claude Code tool name; `MultiEdit` and `NotebookEdit` are not matched.
- Also a PostToolUse hook cannot see the **tool result**; if the Write failed the hook still runs? Not verified (`PostToolUse` is after success per the hooks reference; failures use `PostToolUseFailure`).

## 3. First guess (step 3, not final)
- Verdict: replace (for the hook); the `.session` file may still have to be written because the UI and the CLI read it.
- Why: a mod knows the session id (`$.session.id()`) at `session.start` and in every event. It can write `.session` itself (`$.fs.write`) at the right moment, for example when the flow is chosen or on `/zeremai continue`, with no Write-tool handshake and no `PostToolUse` race. It can also keep the binding in `$.store` or `$.state`, so the 8 other scripts' directory scan becomes a map lookup (this is C01).
- Mod abilities that might apply: `$.session.id()`; `session.start` (once per loaded mod, **not** after `/clear`, `/resume`, `/branch`); `session.end` (`e.reason`: `clear`, `resume`, `logout`, ...); `$.fs.read/write/list/exists` (non-atomic write, 4 MiB); `$.store.get/set/keys` (shared across sessions on the machine, 4 MiB); `$.state` (reactive, per session); `$.command.register` (a `/zeremai continue` equivalent that binds explicitly); `classic.PostToolUse` or `tool.call` with `await next(e)` to bind on a file write like today; `$.flow.run` to run `flow_manager.py`.

## 4. Research questions
1. Does `$.session.id()` return the same string as the `session_id` field that settings hooks get and that `${CLAUDE_SESSION_ID}` expands to in skills? Does it change on `/clear`, `/resume`, `/branch`, or compaction, and does `session.start` fire again then (docs say not after `/clear`/`/resume`/`/branch`)?
2. If a mod writes `.session` itself, which event and moment is right (`session.start`, a `$.command.register` command, `prompt.submit`, a `tool.call`/`classic.PostToolUse` on a write to `active/*/`)? Is any of them reliable for a resumed session whose id is new?
3. Can a mod keep the whole session-to-flow map in `$.store` or `$.state` and drop the file for plugin-internal use, while still writing `.session` for the UI and `flow_manager.py`? Which readers (UI `agentSessionManager.ts`, `flow-approve` auto-detect, `flow_manager.py` flag lookup) would break without the file?
4. If both the settings hook and a mod bind, is there a race or double write? (Today: write only if empty; check the mod follows the same rule.)
5. What is the id inside a subagent's `tool.call`? Is it the parent session id (so the lookup works for step-executor)? Does `agentId` matter for binding?
6. How should unbinding work (flow completed, session ended, flow moved out of `active/`)? Does `session.end` give a reliable hook, and is stale `.session` today actually a problem (a bound id of a dead session)?
7. If mods are off (X01), a settings-hook fallback must keep binding. Can the script and the mod coexist without conflict?
8. Since `$.fs.write` is not atomic and several sessions may write, is the "write only if empty" rule safe, or should `$.store` be the source of truth?

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/reference#session (session events: `session.start`, `session.end` reasons) and the `$.session` row of "Mods API methods"
   - https://code.claude.com/docs/en/plugins/mods/interface#keep-state, `#keep-a-value-in-$-state`, `#save-from-more-than-one-session` (what survives `/clear`, `/resume`)
   - https://code.claude.com/docs/en/plugins/mods/api#reach-files-flows-and-the-network (`$.fs`, `$.flow.run`) and `#send-and-receive-messages-between-sessions` (`$.session.*`)
   - https://code.claude.com/docs/en/plugins/mods/events#handle-the-settings-hook-events (`classic.PostToolUse` carries `session_id`)
   - https://code.claude.com/docs/en/plugins/mods/admin (policy off-switch, see X01)
2. Search the type file for: `id(`, `SessionApi`, `session.start`, `SessionStartInput`, `session.end`, `SessionEndInput`, `StoreApi`, `FsApi`, `PostToolUse`, `ClassicInputOf`.
3. Read these repo files: `scripts/bind-session-to-flow.sh`, `skills/flow-continue/SKILL.md:30-45,140-150`, `skills/flow-new/SKILL.md` (search `.session`), `agents/flow-spawner.md`, `types/flow-instance.ts:95-110`, `../agentic-flows-ui/electron/agentSessionManager.ts:475-540`, the eight reader scripts named above (look only at the lookup loop), `scripts/flow_manager.py:219-228`.
4. Compare with: `PostToolUse` settings hook (after tool success, shell, JSON on stdout) versus a mod reading `$.session.id()` directly; file-based contract versus in-memory map; session id semantics across resume; the order of the two PostToolUse hooks in `hooks.json:68-79`.
5. Write the answer under "7. Research result". Coordinate with C01 (the shared lookup) and X01 (fallback).

## 6. Out of scope
No implementation. No plugin edits. (Only items S01–S03 may build a throwaway mod outside this repo.)

## 7. Research result

Built instead of only researched, at the owner's request (plan page "Session Binding in the Mod", 4 decisions kept as proposed).

### Claude Code version
2.1.296 (Claude Code)

### Answers per question (1-8, each with evidence)
1. **Not verified live.** The mod uses `$.session.id()` for every check; tests fake it. Same string as the hook `session_id` and `${CLAUDE_SESSION_ID}` is assumed, not run (S02). A resumed session has a new id (item section 2), so the binding must be redone on resume.
2. **Done: a tool the skill calls.** `bind_flow` (`hooks/infra/flow-manager/bind-session.ts`) is the first action of `skills/flow-continue/SKILL.md` step 2. `create_flow` binds through the same function (`hooks/on-flow-tools/on-flow-tools.ts`). A command-run guess was rejected: the flow is chosen inside the skill, after the command starts.
3. **Kept the file at first, then moved to the store (C01).** H08 first kept `.session` as the link. C01 then moved the link to `$.store`, key `session:<id>`. `bindSession` no longer writes the file, and `findFlowDir` reads the store. The UI app is obsolete, so no file is kept for it.
4. **No double write.** The settings hook is deleted, so only the mod binds. Binding the same folder again moves it last on the list (C01).
5. **Not verified.** Subagent calls carry `agentId` (README finding). `bind_flow` is called by the main agent. Not run in a subagent.
6. **Not done.** Nothing unbinds on `session.end`. A flow that leaves `active/` drops out by itself, because the lookup checks `flow.json` (C01). A stale `session:<id>` entry stays.
7. **Decided: no fallback.** Every flow tool is a mod tool, so with mods off the plugin cannot change a flow. A binding fallback has no job. The script is deleted.
8. **Replace, with the store as source (C01).** A resumed session has a new id, so it starts a new list. Two live sessions that bind the same folder both answer for it. The store write is not atomic.

### Final verdict
**replace.** The tool `bind_flow` and `create_flow` link the session through `bindSession`. The shell script and its `hooks.json` entry are deleted. The `.session` file is gone too (C01).

### Evidence (doc page + section, type-file names, repo file:line)
- Added: `hooks/infra/flow-manager/bind-session.ts`, tool in `hooks/infra/flow-manager/tools.ts`, `sessionId()` in `hooks/infra/ports/ports.ts`.
- Changed: `hooks/on-flow-tools/on-flow-tools.ts`, `skills/flow-continue/SKILL.md`, `hooks/hooks.json`, `types/flow-instance.ts`.
- Deleted: `scripts/bind-session-to-flow.sh`.
- Tests: `bind-session.test.ts`, `on-flow-tools.test.ts`; `claude plugin test .` gave 206 pass, 0 fail at the time. After C01: 205 pass, 0 fail.

### Open questions
- Does `$.session.id()` equal the hook `session_id` and `${CLAUDE_SESSION_ID}`? (S02)
- Does the id change on `/clear`, `/resume`, `/branch`, compaction? (S02)
- Does the tool work from a subagent call?
- Live run not done: skill calls `bind_flow` in a real resume.

### Risks
- The first prompt after `/zeremai continue` runs before the link (H10).
- A resumed session is unlinked until the agent calls the tool. If the agent skips it, the rules stay off.
- No unbind on session end: a stale `session:<id>` entry stays, but a gone folder never answers.

### What a later plan must decide
- Remove old `session:<id>` keys (C01 did the move to `$.store`).
- Unbind on flow completion or `session.end`.
- Link at `/zeremai continue` start if a flow name can be known there.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "H08"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
