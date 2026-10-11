# Mods migration: research pack

Goal: find out which parts of the `zeremai` plugin can be replaced or improved by a **Claude Code mod**, so that a later plan can migrate the plugin system. This folder started as **research tasks only**. All items are now `done` and the plugin is migrated (v3.20.0): the section "Research result" (7) of each item is the record. The `U` items (UI) were planned with a visual plan page and then built in the mod, so the "No implementation" line in the section "Out of scope" (6) of those items is history.

Each task is one file in `items/`. Each file is written so that a person (or a Claude session) with **no earlier context** can pick it up, research it, and record the result. Progress is tracked in `progress.html`.

## Start here
1. Read this file.
2. Read `shared/mods-docs-reading-list.md` (which mods doc page answers which question).
3. Open `progress.html` in a browser, pick an item with status `todo`.
4. Do the item. Write the result into section 7 of the item file.
5. Update the item's entry in `progress.html` (section 8 of the item file says how).

## What is a mod
A Claude Code plugin whose JS/TS code runs **inside** Claude Code and handles events (a tool call, a submitted prompt, a stop, a session start). It can observe, rewrite or answer the event, add slash commands and tools, keep state, call a model, run flows, and draw panes. Docs: https://code.claude.com/docs/en/plugins/mods/overview. Settings hooks (shell commands in `hooks/hooks.json`) are a different thing: they run outside Claude Code.

## What is this plugin
`zeremai` (v3.4.0, `.claude-plugin/plugin.json`) runs structured, resumable workflows ("flows") created from templates, with steps, approval gates. Questions use the built-in dialog (P05). It is a Claude Code plugin made of:

| Piece | Where | Role |
|---|---|---|
| Hook wiring | `hooks/hooks.json` | Runs 11 distinct shell scripts (12 entries: `check-approval-stop.sh` is on both `Stop` and `SubagentStop`) on `Stop`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit` |
| Hook scripts | `scripts/*.sh` | Enforce rules: block tools while an approval waits, force logging, force auto-advance, bind a session to a flow |
| Hook helpers | `scripts/parse_hook_input.py`, `scripts/hook_extract_flow_dir.py` | Parse the hook JSON; extract `--flow-dir` from a shell command |
| Flow manager | `scripts/flow_manager.py` (23 subcommands; the module docstring lists 22) | The only supported writer of flow state files |
| Template manager | `scripts/template_manager.py` (11 subcommands) | Template marketplaces (git caches), install/uninstall |
| Skills | `skills/*/SKILL.md` | `flow-new`, `flow-continue`, `flow-approve`, `flow-state-update`, `step-executor-delegation`, `apply-improvements` |
| Agents | `agents/step-executor.md`, `agents/flow-spawner.md` | Run one step with isolated context; spawn child flows |
| Framework steps | `framework-steps/` | Steps injected into every flow: continuous improvement, end-flow validation |
| Types | `types/*.ts`, `types/schema.json` | Shape of flow state files |
| Docs | `docs/` | Architecture, flow management, examples, copies of Claude Code docs on hooks, plugins, sub-agents |

Sibling repos (read-only for this research; same parent folder `migrate-to-mod/`):
- `../ZeremAI-marketplace`: flow templates (including `views/` widgets).
- `../agentic-flows-ui`: Electron app that shows flows. It talks to the plugin **only through files and CLI calls**: it watches `~/.claude/zeremai` with chokidar (`electron/fileWatcher.ts`) and runs `python3 scripts/flow_manager.py` / `template_manager.py` (`electron/main.ts`). It also launches `claude` itself and resumes sessions (`electron/agentSessionManager.ts`).

## Runtime state (outside the repo)
All under `~/.claude/zeremai/`:
- `active/<flow>/` (moves to a status folder when status changes, `flow_manager.py` `STATUS_DIRS`) holding `flow.json`, `log.json`, `memory/<topic>.json`, `.session` (session id). The approval gate is a record in the mod's store (H07, P02, P03).
- `flags/pending-log-<session>`: "a log entry is owed" flag.
- `improvement-findings/<templateId>/<flowId>.json`.
- `templates/`, `config/`, `installed-templates.json`.

Every enforcement hook finds "its" flow the same way: loop over `active/*/.session` and compare the content to the hook's `session_id`. This lookup is copied into 9 scripts (`bind-session-to-flow.sh` writes the file instead of scanning).

## Verdicts (the owner's bar: "a mod can do it")
- `replace`: a mod does the job instead.
- `improve`: the part stays; a mod adds to it.
- `keep`: no mod change.
- `later`: not now. Used for a screen that a later round may build (in the UI phase `U`, for example the flows overview).

## Decisions already made by the owner
- Phase 1 (done): the **plugin system** (groups H, C, P, S, X).
- Phase 2 (now, group `U`): the **UI app moves into the mod**, and the mod UI gets a more GUI-like look. Start with `U01`.
- The UI app is obsolete (decision of 2026-10-10): the JSON files are no longer a contract for it, and a later plan may change them.
- The research report lives as a page (these files + `progress.html`), not in the repo `docs/`.
- Up to three throwaway spikes (`S1`–`S3`) test what reading cannot settle. Spikes live outside this repo and are deleted after the report.

## Findings so far (from reading the type file, not yet run)
- A mod can block a stop: `classic.Stop` can return `block`; the Stop input has `stop_hook_active`.
- A subagent's `tool.call` carries `agentId`.
- `$.agent.list()` gives agent status (running, failed, killed): can replace the 10-minute crash timer.
- One plugin can hold settings hooks and a mod together.
- Risk: an admin setting (`allowManagedModsOnly`, `--safe-mode`) switches mods off while settings hooks keep running. See `X1`.

## Items

| Group | IDs | Meaning |
|---|---|---|
| `H` | H01–H08, H10 | The 9 hook scripts left, one each (H09 and H11 were removed with their features) |
| `C` | C01 | Shared hook plumbing (JSON parsing, session lookup) |
| `P` | P01–P12 | Other plugin parts (CLI, skills, agents, files, UI) |
| `S` | S01–S03 | Spikes: small throwaway mods that test open questions |
| `X` | X01 | Cross-cutting: admin policy and fallback |
| `U` | U01–U11 | The UI app moves into the mod: `U01` look and feel first, then one item for each app screen (shell, dashboard, diagram, memory/logs/files, overview, templates, agent sessions, lazy prompts, settings, small parts) |

The full list with titles, files and first guesses is in `progress.html`.

## Output of the whole research
When all items are `done`, a final plan can order the migration. Not part of this folder.

## Facts found while writing the item files (read from code and docs, mostly not run)
- `block-stop-pending-steps.sh` and `check-approval-stop.sh` have no `stop_hook_active` guard; `check-approval-stop.sh` also runs on `SubagentStop` and ignores `agent_id` (H01, H02).
- `block-tools-on-pending.sh` allows any Bash command that contains the text of the flow manager script name, and allows writing `.approve-token`: the user-only approval can be forged (H04, H07). The same text match blocked a harmless command while this folder was written.
- Some matchers or tool names may be stale: `StrReplace`, `Task` (now maybe `Agent`), dead Bash branches in `enforce-log-first.sh` (H05, H06).
- PreToolUse blocks print top-level `{"decision":"block"}`; the hooks reference says PreToolUse uses `hookSpecificOutput.permissionDecision` (H05, H06).
- `.session` is also read by the UI app (`agentSessionManager.ts`) and by `flow-approve`: it is a contract, not only a hook detail (H08, C01).
- `flow-approve` runs the step approval before deleting `pending-interaction.json`, but the CLI refuses while that file exists (P03).
- The UI's Q&A calls to the flow manager pass positional arguments where the CLI needs flags; the Q&A commands are gone, and no UI call to the step approval was found (P01, P12, P05).
- `config/marketplaces.default.json` `autoRefreshOnStale` is never read (P09).
- Three hooks-worker crashes unload every non-built-in mod until `/reload-plugins` (X01).
