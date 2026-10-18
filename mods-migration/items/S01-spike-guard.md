# S01 · Spike: tool guard as a mod

> Status and result live in `../progress.html` (entry `S01`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.
> This is a SPIKE: the only kind of item that may build something, and only outside this repo.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") with steps and approval gates. When a step needs the user's decision, the plugin writes `pending-interaction.json` into the flow folder under `~/.claude/zeremai/active/<flow>/`. While that file exists, a `PreToolUse` shell script (`scripts/block-tools-on-pending.sh`) blocks almost every tool, so Claude must stop and resolve the approval first. This spike tests whether a small mod can do the same job as that script, and what is different when it does. The hook scripts are registered in `hooks/hooks.json`. Related read-only items: the H item for `block-tools-on-pending.sh` and `C01` (session lookup).

## 2. What exists today
- `hooks/hooks.json`: first `PreToolUse` entry has no matcher and runs `block-tools-on-pending.sh` on every tool. Other `PreToolUse` entries: `block-todo-tools.sh` (`Task|TaskCreate|TaskUpdate`), `enforce-log-first.sh` (`Write|StrReplace|Edit|Task`), `block-approve-step.sh` (`Bash`).
- `scripts/block-tools-on-pending.sh` (66 lines):
  - lines 8-13: parses `session_id`, `tool_name`, `file_path`, `command` from the hook JSON; no session id means allow.
  - lines 17-23: finds the flow by scanning `active/*/.session` for the session id (copy of the C01 lookup).
  - lines 25-27: no `pending-interaction.json` means allow.
  - lines 32-36: read-only tools always allowed: `Read|Glob|Grep|ReadLints|SemanticSearch|View|LS`.
  - lines 39-45: `Write|StrReplace|Edit` allowed only when the file path matches `*flow.json`, `*log.json`, `*memory.json`, `*/memory/*.json`, `*pending-interaction.json`, `*.approve-token`.
  - lines 48-54: `Shell|Bash|PowerShell` allowed when the command text contains `flow_manager.py` anywhere (loose: `echo flow_manager.py; rm -rf x` also passes).
  - lines 57-65: otherwise prints `{"decision":"block","reason":...}` with step-by-step instructions (read the pending file, delete it via `flow_manager.py write-pending --delete`, then `update-step-status`), and exits 0.
- State read: `.session`, `pending-interaction.json`, `flow.json` (for the active step id).
- Known weaknesses: the `flow_manager.py` allowance is a substring match; the session scan runs on every tool call; blocking applies to subagent calls only if Claude Code sends them to `PreToolUse` (unverified here); a crash of the script fails open.

## 3. First guess (step 3, not final)
- Verdict: replace (a mod `tool.call` hook can deny with the same text) or improve (mod adds a stricter check on top of the script).
- Why: `tool.call` fires for every tool call, including subagents, and `{ deny: 'reason' }` is read by Claude as the tool result. `.catch` can make it fail closed.
- Abilities: `on('tool.call', ...)`, `$.fs.exists` / `$.fs.read`, `$.store` or a module variable for caching the flow dir, `$.session.id()`.

## 4. Research questions
These are the exact questions the spike must answer. Each has a pass and a fail outcome (section 5, test procedure).

1. Parity: while a fake `pending-interaction.json` exists, does a `tool.call` hook returning `{ deny }` stop a tool (for example Bash `echo hi`, Write of a file outside the flow dir) and does Claude read the deny text and act on it?
2. Read-only tools (`Read`, `Glob`, `Grep`, `LS`, plus the new-style names in this build) pass through with `next(e)`. Are the tool names in this build the same as the script's list? (Print `e.tool` for each.)
3. Writes: a Write/Edit to a flow file (`flow.json`, `log.json`, `memory/x.json`, `pending-interaction.json`, `.approve-token`) is allowed; a Write elsewhere is denied. Which field carries the path in `e` (`e.file_path`)?
4. Bash with `flow_manager.py`: can the mod be stricter than the substring match, for example allow only when the command starts with `python3 <scripts dir>/flow_manager.py` and has no `;`, `&&`, `|`, or newline? Does `e.command` hold the full command text?
5. Order: in which order do the mod's `tool.call` and the settings `PreToolUse` scripts of the same plugin (`hooks/hooks.json`) run? Docs, `events#where-settings-hooks-run-in-the-order`: managed-settings hooks run before the first mod; all other settings and plugin `hooks/hooks.json` `PreToolUse` hooks run after the last mod calls `next`, and a mod that answers without `next` keeps them from running. Confirm by experiment, with a marker file written by a test `PreToolUse` script. Consequence to check: if the mod denies, do `enforce-log-first.sh`, `block-todo-tools.sh`, `block-approve-step.sh` no longer run (fine, since the call is denied anyway), and if the mod allows, do they still run?
6. Subagents: when Claude delegates to a subagent (Task tool) while the pending file exists, does the subagent's tool call reach the mod's `tool.call` hook, and is `e.agentId` set? What does the main agent's call have (absent or empty)? Does the script today block subagent calls (the shell hook JSON may carry `agent_id`)? Decide whether the guard should apply to subagents too.
7. Fail closed: with `.catch` on the guard, when the guard throws (simulate with a deliberate `throw` behind a flag file) or times out (simulate with a long await), is the tool denied with the catch text? Without `.catch`, is the tool allowed (fail open, as docs state)? What is the per-hook time limit (docs reference, Limits)?
8. Cost: how long does the guard take per call when it reads the fake `.session` files with `$.fs` versus using a module variable? (Rough, one number is enough.)
9. Is the deny text shown to Claude verbatim, including the multi-line instructions and `\n`?

## 5. How to research
Test procedure for the spike. Do research from the docs first (step 1), then build, then run.

1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`): `events` (sections "Guard or change a tool call", "The order mods run in", "Where settings hooks run in the order", "Handle a hook that fails"), `api` (`$.fs`, hook time limits), `create` (files, `claude plugin validate`), `test` (`claude plugin test`, stubs), `reference` (the `tool.call` row, Limits). Note `claude --version`.
2. Search the type file for: `ToolCallInput`, `agentId`, `deny`, `tool.call`.
3. Read these repo files: `scripts/block-tools-on-pending.sh`, `hooks/hooks.json`, `scripts/parse_hook_input.py`, `scripts/hook_extract_flow_dir.py`.
4. Build the throwaway mod OUTSIDE this repo. Use the `plugin-authoring` skill. It writes mods under `~/.claude/dev-mods/<session-id>/<mod-name>/`. Call the mod `guard-spike`. Do not copy it into the repo.
   - Files: `.claude-plugin/plugin.json` (name, version, description); `hooks/hooks.json` with `{ "modules": ["./register.ts"] }`; `hooks/register.ts`.
   - Events: `tool.call` (no matcher, so the hook decides by tool name) with a `.catch` handler; optionally `session.start` to read the flow dir once.
   - `$` calls: `$.fs.exists` and `$.fs.read` (for the fake flow dir and the fake `.session`), `$.session.id()` if the type file has it, `$.ui.log(..., { to: 'debug' })` to log what the hook saw (tool name, `agentId`, decision, elapsed ms).
   - Logic in words: find the flow dir for the current session (fake dir pointed to by an env var or a fixed temp path, never the real `~/.claude/zeremai`); if `pending-interaction.json` is absent, `next(e)`; if present, apply the same allow rules as the script (read-only list, flow-file writes, flow_manager.py Bash) and otherwise return `{ deny: <the script's reason text> }`. A debug-only flag file makes the guard throw, to test `.catch`.
   - Do not write the full production guard. Keep it under about 60 lines.
5. Prepare the test fixture in a temp folder, for example `$TMPDIR/s01/agentic/active/spike-proc/` with `flow.json`, `.session` (set after you learn the session id), and `pending-interaction.json`. Point the mod at it with an env var. Never touch the real `~/.claude/zeremai`. If the mod needs a different HOME-like root, start claude with `HOME` set to a temp folder only if login still works; otherwise use the env-var approach.
6. Validate: `claude plugin validate <mod>` (expect a `hooks:` line with `tool.call` and a `calls:` line with `$.fs.*`). Then `claude plugin test <mod>` if you wrote stub tests (the `test` page shows how to fire `tool.call` with a fake event).
7. Run: `claude --plugin-dir <mod> --debug-file <tmp>/s01.log` in a scratch project folder. Run each test below.
8. Compare with the script by running the same fixture with the real plugin loaded (`claude --plugin-dir <repo>` is read-only use; do not edit the repo) only if you need the baseline for the order test (question 5).

### Tests with pass and fail observations
| # | Do | Pass | Fail |
|---|---|---|---|
| T1 | With pending file present ask Claude to `run echo hi` | Command not run; Claude quotes or follows the deny text | Command runs, or Claude ignores the text |
| T2 | Ask Claude to read a file and run Grep | Both work, debug log shows `allow` | Denied |
| T3 | Ask Claude to edit `<fake dir>/flow.json`, then a file outside | First works, second denied | Either reversed |
| T4 | Ask Claude to run `python3 <scripts>/flow_manager.py --help` then `echo x; python3 flow_manager.py` | First runs, second denied by the stricter rule | Both run (the substring hole stays) |
| T5 | Add a test `PreToolUse` script in a scratch plugin that appends a line to a marker file; compare marker with and without the mod denying | Marker shows script ran after the mod's allow, not after a deny | Script runs before the mod, or runs after a deny |
| T6 | Ask Claude to use a subagent (Task) to run `echo hi` while the pending file exists | Debug log shows the hook got the subagent call with `agentId` set | Hook never sees it, or `agentId` is missing |
| T7 | Set the throw flag, then ask for `echo hi` | Denied with the catch text; with `.catch` removed the command runs | Allowed with `.catch` present |
| T8 | Add `await new Promise(r => setTimeout(r, 15000))` behind a flag | Hook skipped after the time limit; `.catch` text if kind is `timeout` | Call hangs |

## 6. Out of scope
No changes to this repo. No real flow state. The spike mod is not a production guard. Do not publish or install it into the user's real plugin set.

## 7. Research result

Closed from the built mod and its tests, at the owner's request after the plan page "Spikes and Policy: Last Mod Items" (decisions kept as proposed). No throwaway mod was run.

### Claude Code version
2.1.296

### What the built mod proves (tests in the repo)
- Parity: while a gate is open, Bash and Write are refused and a subagent write is refused too; the flow tools and every MCP tool pass (`hooks/on-pending-checkpoint/on-pending-checkpoint.test.ts`).
- A log owed refuses Write, Edit, MultiEdit, NotebookEdit, Agent and Task; reads and Bash pass; a call from a subagent passes; the log tool clears it (`on-agent-editing.test.ts`).
- The agent cannot hand-edit a state file with Write, Edit or a Bash write: the gate hook refuses it (`on-approval-gate.ts`, with `.catch`, so a crash refuses too).
- A subagent call carries `agentId`, and the guards use it (`on-todo-tool.ts:23`, `on-agent-editing.ts:31`).
- Order against settings hooks (question 5) no longer matters: no settings hook is left (P10).

### Not proven live
- Q9: the refusal text reaches the model verbatim, with line breaks.
- Q7: only `on-approval-gate.ts` has `.catch`. The other guards fail open on a throw or a time out (10 s per hook).
- Q8: cost per call. Not measured. The mod reads the store and one file, no scan.

### Final verdict
**replace** (all guards are mod hooks).

### Risks
A guard that throws lets the call through. The gate guard is the one that matters most and has a handler.

### What a later plan must decide
Whether the log-first and todo guards also need `.catch`.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "S01"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
