# P10 · Settings hooks in hooks.json (transition)

> Status and result live in `../progress.html` (entry `P10`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` (v2.0.28) enforces its rules today with **settings hooks**: shell scripts that Claude Code runs on events, wired in `hooks/hooks.json` at the plugin root. The migration project asks whether each script can become a **mod** (JavaScript that runs inside Claude Code). Items `H01`-`H11` study the scripts one by one. This item studies the *transition*: what happens while the plugin ships both the old `hooks` block and a new `modules` entry in the same `hooks/hooks.json`, and when the old block can be deleted. The first guess is "keep, then remove".

## 2. What exists today
**Files**
- `hooks/hooks.json` (110 lines). No `modules` key. It has a `hooks` object with these entries (each runs `bash` with `args: ["${CLAUDE_PLUGIN_ROOT}/scripts/<name>.sh"]`):
  - `Stop` (`:3-23`): `check-approval-stop.sh`, `enforce-log-on-stop.sh`, `block-stop-pending-steps.sh`
  - `PreToolUse` (`:24-64`): no-matcher `block-tools-on-pending.sh`; matcher `Task|TaskCreate|TaskUpdate` -> `block-todo-tools.sh`; matcher `Write|StrReplace|Edit|Task` -> `enforce-log-first.sh`; matcher `Bash` -> `block-approve-step.sh`
  - `PostToolUse` (`:65-81`): matcher `Write|StrReplace|Edit` -> `bind-session-to-flow.sh`, `track-file-change.sh`
  - `SubagentStop` (`:82-92`): `check-approval-stop.sh` (the same script as in `Stop`)
  - `UserPromptSubmit` (`:93-108`): `create-log-flag.sh`, `check-qa-session.sh`
  - That is 12 hook entries and 11 distinct scripts.
- `.claude-plugin/plugin.json` (version `2.0.28`). It has no `hooks` field, so Claude Code loads `hooks/hooks.json` by default location.
- Reference copies of the Claude Code docs: `docs/claude/claude-code-hooks-reference.md` (hook locations table `:127-136`; "All matching hooks run in parallel; identical handlers are deduplicated" `:187`; `${CLAUDE_PLUGIN_ROOT}` `:192`; `disableAllHooks` `:240`) and `docs/claude/claude-code-plugins-reference.md` (hooks location and format `:104-140`; plugin directory layout `:429-467`). These copies may be older than the current docs. The local hooks reference does not mention the `args` array form that `hooks.json` uses (grep for `args` finds nothing): treat that as unverified against the current docs.

**What the docs say about both together** (read on 2026-10-09 from the live mods docs, Claude Code docs for v2.1.290):
- `mods/reference#files`: `hooks/hooks.json` holds `modules` (an array with one path) and "can also hold settings hooks under `hooks`".
- `mods/events#where-settings-hooks-run-in-the-order`: `PreToolUse` settings hooks from managed settings run before the first mod's `tool.call`; `PreToolUse` hooks from every other settings file **and from plugins' `hooks/hooks.json`** run after the last mod calls `next`. A mod that answers `tool.call` without calling `next` keeps them from running.
- `mods/reference#settings-and-environment-variables`: `allowManagedModsOnly` stops mods that are not the organization's, "Users' settings hooks keep running"; `disableAllHooks` in managed settings stops every mod and hook from an installed plugin, in the user's own settings it stops their hooks and mods but not what the organization manages; `allowManagedHooksOnly` blocks hooks and installed mods that are not the organization's.
- `mods/overview#turn-mods-on-or-off`: `--safe-mode` disables installed mods and other customizations; `disableAllHooks` also stops settings hooks and the custom status line.
- `mods/events#hook-the-settings-hook-events`: every settings hook event is also a mod event named `classic.<Event>` (for example `classic.Stop`, `classic.PostToolUse`), whose `e` is the hook's stdin JSON.

**Behaviour today**: Claude Code runs all matching hooks in parallel, so for `PreToolUse` the six checks run at once; each script prints JSON that can block.

**Known weaknesses (step 3)**: the same session-lookup code is copied into 8 scripts (see `C01`); `bash` + `python3` must exist on the machine; each hook costs a flow start.

## 3. First guess (step 3, not final)
- Verdict: **keep, then remove**: keep the `hooks` block while mods are unproven and may be switched off, remove each script once its mod equivalent is proven and a policy decision (item `X01`) says mods are always on.
- Why: a plugin may carry both (reference#files). A mod that denies a call in `tool.call` runs first and can stop the shell hook; but if both stay, the same rule runs twice, and the docs only deduplicate **identical** handlers (hooks reference `:187`), not a mod and a script. Admin settings can switch mods off while settings hooks keep running, so the old block is the fallback.
- Mod abilities that might apply: `tool.call` (`{ deny }`), `tool.check`, `prompt.submit`, `classic.Stop` (can return `block`), `classic.SubagentStop`, `classic.PostToolUse`, `classic.UserPromptSubmit`, `plugin.register`, `.catch` fail-closed handlers.

## 4. Research questions
1. Can one `hooks/hooks.json` hold both `modules` and `hooks`, and does Claude Code load both when the plugin is enabled? Quote the reference.
2. If both a mod and a shell hook enforce the same rule, in what order do they run for `PreToolUse` and for `Stop` (use `mods/events#where-settings-hooks-run-in-the-order` and the `classic.Stop` entry in the type file)? Does a deny from the mod prevent the shell hook, and does `classic.Stop` run before or after the settings `Stop` hooks?
3. Are mod hooks and settings hooks ever deduplicated against each other? (Docs say only identical handlers are deduplicated; confirm in the types and the troubleshooting page.)
4. Which switches turn off mods but leave settings hooks running, and which turn off both? Build a table for: `disableAllHooks` (user vs managed), `allowManagedModsOnly`, `allowManagedHooksOnly`, `--safe-mode`, `--bare`, Desktop WSL sessions, `claude -p`, VS Code. (Read `https://code.claude.com/docs/en/settings-reference#disableallhooks` and `#what-runs-under-allowmanagedhooksonly`: the first fetch of that page was truncated before those sections.)
5. What is the safest cut-over for each of the 11 scripts: (a) both run, mod set to observe only; (b) mod enforces, script removed; (c) script stays as fallback? Which scripts are "safety critical" (block approvals, block stop) and which are advisory?
6. After removing `hooks` from `hooks/hooks.json`, what must change in `plugin.json` (a `version` bump is needed so installed copies update: `mods/create#share-your-mod`), and does the plugin still load in Claude Code builds older than v2.1.287 (mods ignored, so rules are not enforced)?
7. Does Claude Code warn when a plugin has both a mod and settings hooks for the same event (check `mods/troubleshoot` and `claude plugin validate` output)?

## 5. How to research
1. Re-read these mods docs pages (full URLs under `https://code.claude.com/docs/en/plugins/mods/`):
   - `reference`: sections "Files", "Events" > "Settings hook events", "Settings and environment variables".
   - `events`: "Hook the settings hook events", "The order mods run in", "Where settings hooks run in the order", "Handle a hook that fails".
   - `admin`: "Choose how much to allow", "Know what happens by default", "Stop user-installed mods from loading".
   - `overview`: "Turn mods on or off", "Where mods run", "Compare mods, settings hooks, skills, and MCP servers".
   - `troubleshoot`: "Check whether mods can load".
   - Also `https://code.claude.com/docs/en/settings-reference` (`disableAllHooks`, `allowManagedHooksOnly`) and `https://code.claude.com/docs/en/hooks` (parallel execution, deduplication, `args` form).
2. Search the type file for: `ClassicResult`, `ClassicResultOf`, `'classic.Stop'`, `stop_hook_active`, `PreToolUseResult`, `PluginRegisterResult`.
3. Read these repo files: `hooks/hooks.json`, `.claude-plugin/plugin.json`, `docs/claude/claude-code-hooks-reference.md` (`:127-195`, `:225-245`), `docs/claude/claude-code-plugins-reference.md` (`:104-140`, `:429-470`, `:690-705`), and the item files `H01`-`H11` (one per script) for the mod equivalent chosen.
4. Compare: the 12 hook entries with their `classic.<Event>` / `tool.call` equivalents, one row each (event, matcher, script, mod event, can the mod fail closed?), then add the switch table from question 4.
5. Write the answer under "7. Research result": the table, a recommended cut-over order, and the conditions that must hold before `hooks` is removed.

## 6. Out of scope
Research only. Do not edit `hooks/hooks.json` or any script, and do not build a mod. Whether to rely on mods being always on is item `X01`; the behavior of each script is items `H01`-`H11`.

## 7. Research result

Built at the owner's request after the plan page "Mod Migration P06 to P12" (all 5 decisions kept as proposed).

### Claude Code version
2.1.296

### Answers (short)
1. `hooks/hooks.json` now holds only `modules` (`./register.ts`). The shell hooks were replaced one by one in the H items.
2-3. Not relevant any more: no shell hook runs beside a mod rule, so nothing runs twice.
4. Switches: `--safe-mode` and the admin settings turn mods off, and then no flow tool exists. Recorded in the README.
5. Cut-over: done, each script was removed when its mod rule had tests.
6. `plugin.json` version raised to **3.0.0**. A Claude Code build without mods ignores the plugin's rules.
7. Not checked: whether `claude plugin validate` warns about anything here (it passed with warnings in P04).

### What changed
Deleted `scripts/models.py`, `scripts/template_manager.py` (P09), and the two one-time scripts `strip_files_changed.py` and `migrate_embedded_steps.py`. The `scripts/` folder is gone. README updated.

### Final verdict
**replace.**

### Risks
A user on an old Claude Code build gets a plugin with no rules and no tools.

### What a later plan must decide
X01: what organisations that limit mods should do.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P10"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
