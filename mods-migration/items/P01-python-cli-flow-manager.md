# P01 · Python CLI flow_manager.py

> Status and result live in `../progress.html` (entry `P01`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs structured, resumable workflows ("flows") from templates. Each flow is a folder under `~/.claude/zeremai/active/<flow>/` holding JSON state files (`flow.json`, `log.json`, `memory/<topic>.json`, `pending-interaction.json`, `qa-session.json`). `scripts/flow_manager.py` is the only supported writer of those files: the model, the skills, and the UI app all go through it. It is a Python argparse CLI with 22 subcommands, run by the model through the Bash tool (`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/flow_manager.py <subcommand> --flow-dir <dir> ...`). Callers: skills (`flow-new`, `flow-continue`, `flow-state-update`, `flow-approve`, `flow-QnA-session`, `apply-improvements`), agents (`step-executor`, `flow-spawner`), hook scripts (which only check for its filename in a Bash command), and the Electron UI (`../agentic-flows-ui/electron/main.ts`, Q&A commands only, see below).

## 2. What exists today
Files:
- `scripts/flow_manager.py` (1764 lines). Docstring with the subcommand list at lines 1-26. `main()` at line 1525; argparse subparsers 1532-1728; gating sets at 1732-1755.
- `scripts/models.py`: dataclasses and `read_json` / `write_json` used by every subcommand.
- `skills/flow-state-update/SKILL.md` (422 lines): the model-facing manual for the subcommands (operation headings at lines 36-373, "Important Rules" at 374, "Common Mistakes" at 383).
- Hook scripts that match on the filename or subcommand: `scripts/block-approve-step.sh:19` (regex `flow_manager\.py.*\bapprove-step\b`), `scripts/block-tools-on-pending.sh:50`, `scripts/enforce-log-first.sh:29` (both allow any Bash command containing `flow_manager.py`).

Subcommands (handler function, line): create-flow (268), update-step-status (455), approve-step (513), update-current-state (557), update-active-substep (596), track-file-change (618), add-memory-entry (700), read-memory-topic (767), add-log-entry (791), log-interaction (858), update-flow-status (906), register-child-flow (1023), update-child-status (1062), update-log-observations (1091), write-finding (1121), list-findings (1157), update-finding-status (1170), write-pending (1193), create-qa-session (1264), update-qa-answer (1323), complete-qa-question (1376), complete-qa-session (1419), get-qa-session (1507).

Behaviour in plain words:
- Output contract: success prints `{"status":"ok","files_written":[...]}`, failure prints `{"status":"error","message":...}` and exits 1 (`_ok`/`_error`, lines 208-216). The error messages are long, written to tell the model exactly what to run next (for example lines 232-246, 253-265).
- Built-in guards that live in the script, not in hooks:
  - `_check_pending_log` (219): refuses state-changing commands while the flag file `~/.claude/zeremai/flags/pending-log-<session>` exists. The session id is read from `<flow-dir>/.session`. Applied to `update-step-status`, `approve-step`, `update-current-state`, `update-active-substep`, `add-memory-entry`, `update-flow-status`, and `write-pending` (except `--delete`) (set at line 1732, applied 1750-1752).
  - `_check_pending_approval` (249): refuses `update-step-status`, `update-current-state`, `update-active-substep`, `update-flow-status` while `pending-interaction.json` exists (set at 1742).
  - `update-step-status` refuses `--status completed` on a step with `approvalRequired` and `approved != true` (inside 455-505).
  - `approve-step` refuses if the step has no `approvalRequired` or `pending-interaction.json` still exists (513-554).
  - `write-pending` refuses if `qa-session.json` exists, if the active step is not `approvalRequired`, or if the step has a `view` and an option lacks its `data` (1193-1261).
  - `update-flow-status --status completed` on a child flow requires `--summary`, then writes the summary into the parent's `memory/sub-flows.json` and updates the parent's child status (906-985). It also MOVES the flow folder between `active/`, `completed/`, `failed/` (STATUS_DIRS, about 990-1020) and rewrites `metadata.flowPath`.
- Atomic writes: `write_json` in `models.py` (not read for this item; check whether it is write-then-rename).
- State touched: everything under `~/.claude/zeremai/` (see README "Runtime state").

Who calls it from the UI: `../agentic-flows-ui/electron/main.ts:499-620` spawns `python3 scripts/flow_manager.py update-qa-answer|complete-qa-question` with cwd `AGENTIC_FLOWS_REPO` (main.ts:26). The arguments are passed POSITIONALLY (`flowPath, questionId, answer`), but the CLI defines `--flow-dir`, `--question-id`, `--answer` as flags (flow_manager.py:1710-1721). By reading, argparse would reject these calls. Not run; see P05 and question 6.

Known weaknesses seen in step 3:
- Every guard depends on the model remembering to call the CLI and on hooks that find the flow by scanning `.session` files (see C01).
- The CLI is a second source of truth for "what the next legal command is": error texts are hand-written strings.
- Flow startup cost: a Python interpreter per call (the hooks also start Python several times per event).
- The model can bypass the CLI by editing JSON with Write/Edit; only the `flow-state-update` skill text and the log-first hook discourage it.

## 3. First guess (step 3, not final)
- Verdict: improve.
- Why: the owner decided the JSON files stay the contract and the UI keeps calling the same CLI. So the CLI stays as the writer. A mod can improve how it is used, not replace it.
- Mod abilities that might apply:
  - `$.tool.register` + `tool.call` (matcher `{ tool: 'mcp__zeremai__<name>' }`): give the model typed tools (for example `flow_step_status`) whose handler runs the Python CLI through `$.flow.run(['python3', script, ...])` (30 s default timeout). The model then no longer builds shell strings, and the shell-string hooks (`block-approve-step.sh` regex, `hook_extract_flow_dir.py`) become unnecessary for those calls.
  - `$.command.register` + `command.run`: user-facing slash commands that call the CLI directly (no model in the loop).
  - `tool.call` / `tool.check` on `Bash` and `Write|Edit`: deny direct edits of flow state files, redirect to the CLI or tools.
  - `$.fs` (4 MiB per file) as a reader for `flow.json` without Python; writes should stay in the CLI because `$.fs.write` is not atomic (reference, `$.fs` row).
  - `$.store` / `$.state`: cache "which flow is bound to this session" so scripts need not scan `.session` files.
  - `skill.prompt`: inject the current valid commands into skill text.

## 4. Research questions
1. Can a mod register a tool (`$.tool.register`) whose handler runs `python3 flow_manager.py ...` through `$.flow.run` and returns the JSON output to the model as the tool result? What are the limits (30 s default, 10 min max timeout, output size)?
2. Does `$.flow.run` run with the user's environment and working directory so `~/.claude/zeremai` and `${CLAUDE_PLUGIN_ROOT}` equivalents resolve? How does a mod learn the plugin root (`$.plugin.root`)?
3. Can a mod mark Bash commands that match `flow_manager.py` and rewrite or deny them (`tool.call` with `{ tool: 'Bash' }`), so the model is steered to the typed tools?
4. Could a mod deny `Write`/`Edit` on `flow.json`, `log.json`, `memory/*.json`, `pending-interaction.json`, `qa-session.json` (path match in `tool.call`) and say why? Is this stricter than the current skill text?
5. Which of the 22 subcommands would be worth exposing as tools (candidate: the few the model calls every step) versus leaving behind Bash? Is there a cost to having many tools registered (tool search deferral, `isDeferred`)?
6. The UI calls `update-qa-answer` and `complete-qa-question` with positional args that the CLI does not accept. Is this a real bug or a stale code path? (Answerable by reading the UI code and the argparse definitions; does not need a mod.) The owner has said the UI keeps using the same files and CLI, so any CLI change must keep what the UI really calls working.
7. What happens to the plugin when mods are switched off (`allowManagedModsOnly`, `--safe-mode`)? Does the CLI-through-Bash path still work as the fallback? (See X01.)

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/api#add-a-command-or-a-tool (tool registration, naming `mcp__<plugin>__<name>`, `isDeferred`)
   - https://code.claude.com/docs/en/plugins/mods/api#reach-files-flows-and-the-network (`$.flow.run`, `$.fs` rules)
   - https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call (`tool.call` deny and result)
   - https://code.claude.com/docs/en/plugins/mods/reference#mods-api-methods and `#limits`
   - https://code.claude.com/docs/en/plugins/mods/admin (what disables mods)
2. Search the type file (`claude-code.d.ts`) for: `register(`, `ToolCallInput`, `flow.run`, `FlowRunResult`, `$.plugin`, `root`, `isDeferred`.
3. Read these repo files: `scripts/flow_manager.py` (at least `main()` 1525-1764, the guard functions 208-265, and the handlers for the commands you consider exposing), `skills/flow-state-update/SKILL.md`, `scripts/block-approve-step.sh`, `../agentic-flows-ui/electron/main.ts:474-650`.
4. Compare: the model-facing manual in `flow-state-update/SKILL.md` versus what a typed tool schema could express (inputSchema replaces prose). List each subcommand as expose-as-tool, keep-via-Bash, or user-only (command).
5. Write the answer under "7. Research result": a table subcommand -> best surface, plus answers to questions 1-7.

## 6. Out of scope
No implementation. No plugin edits. No building a mod. Do not run the CLI against real flow state. (Only items S01-S03 may build a throwaway mod outside this repo.)

## 7. Research result
Planned and built 2026-10-10 (plan page: https://claude.ai/artifact/RbosiCyrHxicovi2etmevW). The first guess was `improve` (the UI app needed the CLI). The owner then said the UI app is obsolete, so the verdict is `replace`. Not committed.

### Claude Code version
`2.1.296 (Claude Code)`. Type file from the `plugin-authoring` skill for this build.

### Answers to questions 1-7
1. A mod can register a tool (`$.tool.register`, named `mcp__<plugin>__<name>`), served by a `tool.call` hook that returns `{ result }`. The tools do not run Python: the rules were ported, so the 30 s limit of `$.flow.run` does not apply (it applies to the folder move only).
2. Not needed: the tools use `$.fs`, `$.plugin.root` and `$.session.cwd()`. `$.flow.run` is used for the folder move only.
3. Moot: nothing in the plugin runs the script any more. A Bash command that writes a flow file is refused by a text rule (see H07).
4. Yes. A `tool.call` hook refuses Write, Edit and MultiEdit on `flow.json`, `log.json`, `memory/*.json` and `improvement-findings/**` (path match, with `/` or `\`), and a Bash command that names one and looks like a write. A script file that edits one still passes.
5. All 15 became tools (one for each command), behind tool search (`isDeferred: true`). They are listed only when the user runs `/flow-new` or `/flow-continue`, or the session already has a flow, so a session with no flow pays nothing. Cost of many tools: only names and short descriptions until the agent asks for a schema.
6. Stale: the UI app is obsolete, so its Q&A calls are not kept. The Q&A commands were already removed from the CLI.
7. If mods are off, the agent cannot change flow state (no fallback, the script is gone). Item X01 decides whether a fallback is needed.

### Final verdict
**replace**

### Implemented
- New `hooks/on-flow-tools/on-flow-tools.ts`: lists the tools (`session.start` for a bound session, `command.run` for the two skills, and `on-user-prompt` for a session bound later), serves them, and binds a new flow to the session (the shell hook only fired after an agent Write).
- New `hooks/infra/flow-manager/`: `create-flow.ts`, `step-status.ts`, `memory.ts`, `log.ts`, `flow-status.ts` (parent notice, folder move with `mkdir` and `mv`), `findings.ts`, `tools.ts` (names, input schemas, a check of required fields and enums), `flow-files.ts` (a lock for each flow folder, JSON read and write). The files are plain JSON, so a field the tools do not know survives a write (the Python classes dropped them).
- Rules kept: approval check on completion, memory topic access, sub-flow summary, parent notice, folder move, steps count in the log. Same answer shape `{status, files_written}`.
- Hooks now match tool names, not command text: `log-owed.ts` (`LOG_TOOL`, `LOG_GATED_TOOLS`), `on-agent-editing.ts`, `pending-checkpoint.ts` (the log tool is an MCP tool, so it passes an open gate). The approval write takes the same lock.
- Guard widened from `flow.json` to every state file (`approval-gate.ts` `isHandEdit`).
- Removed: `scripts/flow_manager.py`, `scripts/test_view_resolution.py`. `scripts/models.py` keeps only the marketplace classes and the JSON helpers, because `template_manager.py` (P09) and `strip_files_changed.py` import them.
- Texts rewritten: `skills/flow-state-update` (the manual, now one page of tools), `flow-new`, `flow-continue`, `apply-improvements`, `agents/flow-spawner.md`, `agents/step-executor.md`, `docs/`, `README.md`, the continuous-improvement framework step.
- Tests: `claude plugin test .` 190 pass; `claude plugin validate .` passes (one `logo` warning). One test file for each module, run on a fake disk.

### Evidence
- Type file `claude-code.d.ts`: `tool.register` / `ToolSpec` (`isDeferred`), `tool.call` (`deny`, MCP input on `e`), `fs` (write creates folders; no move, no delete), `flow.run`, `session.cwd`, `plugin.root`, `command.run`, global `crypto.randomUUID`.
- Repo before: `scripts/flow_manager.py` (1071 lines), `scripts/models.py`, `hooks/infra/log-owed/log-owed.ts` (text patterns).

### Open questions
- Not run in a live session (S01): `command.run` for a skill run (if the mod cannot see it, `create_flow` is never listed); a tool listed in the middle of a session is callable at the next prompt; `$.fs.exists` on a folder; the folder move on each platform (`mv` through `$.flow.run` on macOS and Linux, PowerShell on Windows).
- Windows is covered by code and tests, but not run on Windows: the folder move uses one PowerShell command (`powershell -NoProfile -Command New-Item ...; Move-Item ...`) where macOS and Linux use `mkdir -p` and `mv`. Windows is detected with `OS=Windows_NT`. Paths with backslashes are turned into `/` at the tool entry, and a missing `HOME` falls back to `USERPROFILE`.
- A crash in the middle of a write can leave a cut file (the script wrote a temp file and renamed it). The lock covers one mod, not two sessions.
- The Bash write rule is a guess; a script file that edits a state file passes.
- Resuming a flow in a new session (`/flow-continue`) still binds with the shell hook after an agent Write (item H08).
- Where mods do not run, nothing changes flow state (X01).

### What a later plan must decide
- Whether to keep a fallback for sessions without mods.
- Whether the mod becomes the only writer even for the `.session` binding (H08).

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P01"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1-3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
