# P07 · Memory, log and findings files

> Status and result live in `../progress.html` (entry `P07`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` (v2.0.28) is a Claude Code plugin that runs structured, resumable workflows called "flows". Each flow lives in a folder under `~/.claude/zeremai/active/<flow>/` and is described only by JSON files. Three groups of those files hold what the flow *learned and did*: `memory/<topic>.json` (what each step produced), `log.json` (what happened, user interactions, observations) and `improvement-findings/<templateId>/<flowId>.json` (improvement ideas saved for later). Agents never edit these files by hand. They call `python3 scripts/flow_manager.py <subcommand>` (documented in `skills/flow-state-update/SKILL.md`). The Electron UI app (`../agentic-flows-ui`) watches the same files and shows them, so the file shapes are a contract the owner has decided to keep.

## 2. What exists today
**Files and code**
- Memory write: `scripts/flow_manager.py:700` `cmd_add_memory_entry`. It merges one step's entry into `memory/<topic>.json` and appends new decisions and files to `memory/_cross-references.json` (`flow_manager.py:750-762`).
- Memory read: `flow_manager.py:767` `cmd_read_memory_topic`. Returns `data: null` when the topic file does not exist.
- Topic access rule: `flow_manager.py:664-697` (`_get_step_memory_usage`, `_validate_topic_access`). A step may only write/read topics listed in its `stepDefinition.memoryFileUsage.writeTo` / `readFrom`. An empty list or an old string format means "no restriction". `_cross-references` is always allowed.
- Log write: `flow_manager.py:791` `cmd_add_log_entry` (actions, reasoning, files, problems, decisions, performance notes per step), `:858` `cmd_log_interaction` (user interactions; also deletes the "log owed" flag file `flags/pending-log-<session>`, `:890-903`), `:1091` `cmd_update_log_observations` (flow-wide patterns, feedback, metrics, recommendations).
- Findings: `flow_manager.py:1121` `cmd_write_finding` (appends to `improvement-findings/<templateId>/<flowId>.json`, falls back to the template name when `templateId` is missing, `:1125-1128`), `:1157` `cmd_list_findings` (glob + filter by status), `:1170` `cmd_update_finding_status` (sets status and a `resolution` block; picks the first matching file, `:1173-1176`).
- Data classes: `scripts/models.py:480` `MemoryTopicEntry`, `:515` `MemoryTopicFile`, `:553` `MemoryCrossReferences`, `:595` `FINDINGS_DIR`, `:599` `ImprovementFinding` (status `open | applied | rejected | deferred`), `:658` `UserInteraction`, `:692` `LogStepEntry`, `:740` `LogFile`.
- TypeScript shapes: `types/memory-file.ts` (70 lines), `types/log-file.ts` (128 lines), `types/schema.json`. There is no `types/*.ts` file for improvement findings: only the Python class `ImprovementFinding` defines that shape (grep of `types/` for "ImprovementFinding" finds nothing).
- Atomic write helper: `scripts/models.py:986-992` `write_json` writes `<file>.tmp` and then `os.replace`, so a reader never sees a half-written file.
- Command gating: `flow_manager.py:1730-1755`. `add-memory-entry` is in `_LOG_GATED_COMMANDS` (blocked while an unlogged user interaction is pending, `_check_pending_log` `:219-246`). `add-log-entry`, `log-interaction`, `update-log-observations` and the three findings commands are not gated.

**Behaviour in plain words**
- Every call is read-modify-write of one whole JSON file. There is no lock.
- `add-memory-entry` on an existing step entry extends `decisionsMade` and `filesModifiedCreated` (`:733-734`) and `_cross-references` (`:758-761`) without removing duplicates, so a retried call can add the same decision twice.
- When a flow changes status, its whole folder moves (`flow_manager.py:994-1015`, `STATUS_DIRS`: `active`, `completed`, `failed`), so memory/log paths change with it.

**State read/written** (all under `~/.claude/zeremai/`): `active|completed|failed/<flow>/memory/*.json`, `.../log.json`, `flags/pending-log-<session>`, `improvement-findings/<templateId>/<flowId>.json`.

**Known weaknesses (step 3)**: no schema validation on read of the findings file; duplicate entries on retry; no lock between concurrent writers (main session and subagent); the UI watcher polls (`../agentic-flows-ui/electron/fileWatcher.ts:53-63`, `usePolling`, 1 s interval, 300 ms write-stability wait).

## 3. First guess (step 3, not final)
- Verdict: **keep**.
- Why: these are data files and a CLI that is the only writer. The owner decided the files stay the contract for the UI. A mod adds nothing to the file shapes, and the mods `$.fs.write` is documented as not atomic (reference, "Mods API methods", `$.fs` row), which is worse than the current `tmp + os.replace`.
- Mod abilities that might apply (only as callers of the existing CLI, not as replacements): `$.flow.run([...])` (30 s default timeout), `$.tool.register` + a `tool.call` hook on `mcp__zeremai__<name>` (a typed tool "add_memory" instead of a Bash call to the script), `$.command.register`, `$.fs.read` / `$.fs.list` (read-only views), `$.store` (key-value, shared by sessions, 4 MiB total: not suitable for these files), `session.start`, `turn.complete`.

## 4. Research questions
1. Is `$.fs.write` the only way for a mod to write a file, and is it still non-atomic in the current Claude Code build? (If yes, a mod must keep calling the Python CLI for any write the UI reads.)
2. Can a mod register a typed tool (`$.tool.register` with an `inputSchema`) that wraps `flow_manager.py add-memory-entry` / `add-log-entry`, so Claude passes arguments as JSON instead of quoted shell text? Does a tool result come back to Claude as normal text? What is the 10 s hook limit effect on a `$.flow.run` call inside `tool.call`?
3. Does a mod's `tool.call` for a registered tool count against the hook's 10 s limit while waiting inside `$.flow.run`? (The docs say time inside a mods API call does not count; confirm in the types.)
4. Could a mod deduplicate or validate memory/log input before the CLI runs (a `tool.call` hook on Bash that sees `flow_manager.py add-memory-entry` text)? Is that worth it compared with fixing the Python script?
5. Which of these files could be read by a mod to show status (see `P11`) without writing anything? Is `$.fs.read` of `~/.claude/...` allowed from a mod, and how does the mod resolve `~`?
6. Does anything in the mods docs change the rule "only the CLI writes state"? (For example a mod-owned state in `$.store` instead of `memory/*.json`.) Answer with evidence for why the UI contract forbids it.
7. Should a TypeScript type for improvement findings exist (gap noted above)? This is a repo fix, not a mod question; record it as a finding for the final plan.

## 5. How to research
1. Re-read these mods docs pages (full URLs under `https://code.claude.com/docs/en/plugins/mods/`):
   - `reference`, sections "Mods API methods" (the `$.fs`, `$.store`, `$.flow`, `$.tool` rows) and "Limits" (4 MiB `$.fs`, 30 s `$.flow.run`, 10 s hook).
   - `api`, sections "Add a tool" and "Reach files, flows, and the network".
2. Search the type file (`claude-code.d.ts`, see the reading list for how to get your build's copy) for: `'fs.write'`, `FsWrite`, `interface ToolRegistration`, `inputSchema`, `flow.run`, and the doc comment on `$.fs.write` about atomicity.
3. Read these repo files: `scripts/flow_manager.py` lines 664-870, 1091-1190, 1725-1755; `scripts/models.py` lines 480-600, 595-660, 692-815, 981-992; `types/memory-file.ts`; `types/log-file.ts`; `skills/flow-state-update/SKILL.md` (sections on `add-memory-entry`, `add-log-entry`, `write-finding`); `../agentic-flows-ui/electron/fileWatcher.ts` (what the UI reads).
4. Compare: each current CLI command against what a mod tool wrapper would add (typed arguments, no shell quoting) and cost (a new moving part, plugin must still ship Python, mods may be switched off, see `X01`).
5. Write the answer under "7. Research result": one paragraph per question, a verdict, and a note on which findings go to the final plan.

## 6. Out of scope
Research only. No repo edits and no building a mod. Do not change the JSON file shapes (the UI contract). Related items: `P11` (reads the same files to show status), `P08` (findings workflow), `X01` (what runs when mods are off).

## 7. Research result

Built at the owner's request after the plan page "Mod Migration P06 to P12" (all 5 decisions kept as proposed).

### Claude Code version
2.1.296

### Answers (short)
1. `$.fs.write` is the only mod write; the tools write whole files with it. The old rule "only the CLI writes" is now "only the mod tools write", and the agent cannot edit a state file with Write, Edit or Bash (P01).
2. Typed tools exist: `add_memory_entry`, `read_memory_topic`, `add_log_entry`, `log_interaction`, `update_log_observations`, `write_finding`, `list_findings`, `update_finding_status` (`hooks/infra/flow-manager/tools.ts`, `findings-tools.ts`).
3. No Python is called, so the hook time limit does not apply.
4. Done in the tool, not in a hook: `addMemoryEntry` and `addLogEntry` now skip a decision or file they already hold (`memory.ts`, `log.ts`; test "a repeated call adds no decision or file twice"). Actions and notes can repeat on purpose, so they are not deduplicated.
5. A mod reads `~/.claude/...` through `$.fs` with `$.env.get('HOME')` (`on-flow-tools.ts`).
6. Mod state in `$.store` is not used for these files: they are large and per flow. The UI-app reason is gone (the app is obsolete); the size reason stays.
7. No TypeScript type for findings exists. Left as a finding; nothing reads it as a type now.

### Final verdict
**replace** (done in P01); this item adds repeat-safety.

### Evidence
Repo: `memory.ts:35-55`, `log.ts:27-33`, `memory.test.ts`, `findings.ts`.

### Risks
The log keeps repeated actions on purpose. A repeated decision that was meant (same text twice) is now stored once.

### What a later plan must decide
Whether to add a findings type file.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P07"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
