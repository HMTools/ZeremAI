# P09 · Template marketplaces

> Status and result live in `../progress.html` (entry `P09`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` (v2.0.28) creates flows from **templates**. Templates are not shipped inside the plugin. They come from "marketplaces": git repositories (the default is `https://github.com/HMTools/ZeremAI-marketplace.git`, a sibling repo of this one is a local copy). A script, `scripts/template_manager.py`, keeps a git cache of each marketplace, lists the templates, and copies chosen ones into `~/.claude/zeremai/templates/flows/` where `flow-new` finds them. The Electron UI app calls this script for its Marketplace screen. In practice the UI is the main caller; the `flow-new` skill only tells the user to open the Marketplace when no template exists (`skills/flow-new/SKILL.md:35`).

## 2. What exists today
**Files and code**
- `scripts/template_manager.py` (796 lines, 11 subcommands, listed in its docstring `:4-16` and registered `:725-783`): `init` (`:301`), `add-marketplace` (`:323`), `remove-marketplace` (`:348`), `toggle-marketplace` (`:374`), `update-marketplace` (`:397`), `list-marketplaces` (`:443`), `refresh` (`:461`), `catalog` (`:526`), `install` (`:571`), `uninstall` (`:627`), `status` (`:663`).
- Constants and paths: `template_manager.py:42-67`: runtime base `~/.claude/zeremai`, config `config/marketplaces.json`, manifest `config/installed-templates.json`, git caches `cache/sources/<marketplace>/`, installed templates `templates/flows/<category>/<template>/`.
- Git helpers: `_git_clone` `:108` (`git clone --depth 1 --branch`, 120 s timeout), `_git_pull` `:125` (120 s), `_git_commit_hash` `:143` (`git rev-parse HEAD`, used as the template "version"). Needs `git` on the machine (`_git_available` `:94`).
- Default config: `config/marketplaces.default.json` (15 lines): one marketplace `official`, branch `main`, priority 100, plus settings `autoRefreshOnStale: false`, `staleDurationMinutes: 1440`. Copied on first use by `_ensure_default_config` `:184`. Legacy `template-sources.json` is migrated by `_migrate_legacy_config` `:160`.
- Data classes: `scripts/models.py:819` `Marketplace`, `:869` `InstalledTemplate`, `:918` `InstalledTemplatesManifest`, `:944` `MarketplaceConfig`.
- Template discovery: `_get_template_metadata` `:240` scans `<cache>/templates/flows/<category>/<template>/<template>.json` for `metadata.title` and `metadata.purposeAndUsage` (folders starting with `_` are skipped).
- Callers in the UI app: `../agentic-flows-ui/electron/main.ts:1198-1215` `runMarketplaceCommand` spawns `python3 scripts/template_manager.py <args>` with `cwd` = a sibling `zeremai` folder (`main.ts:26`) and parses stdout JSON; IPC handlers `marketplace:*` at `main.ts:1232-1290`.

**Behaviour in plain words**: `refresh` clones or pulls every enabled marketplace (falls back to the old cache if a pull fails, `:497-506`). `catalog` lists what is available and whether it is installed / has an update (installed `version` differs from the cache HEAD hash, `:551-556`). `install` replaces the installed folder with a copy from the cache and updates the manifest (`:595-619`). `uninstall` deletes the folder and the manifest entry.

**State read/written**: `~/.claude/zeremai/config/*.json`, `cache/sources/**`, `templates/flows/**`.

**Known weaknesses (step 3)**:
- `autoRefreshOnStale` and `staleDurationMinutes` are stored and migrated but no code reads them (grep of `scripts/` finds them only in `models.py:959-974` and `template_manager.py:170-177`). Auto-refresh is therefore not implemented.
- `uninstall` matches by name and type only, not category (`template_manager.py:634`, `:652`), so two templates with the same name in different categories would collide.
- Install overwrites the folder with `shutil.rmtree` (`:596-597`), so local edits to an installed template are lost on update.
- Marketplaces are plain git repos and are unrelated to Claude Code's own plugin marketplaces.

## 3. First guess (step 3, not final)
- Verdict: **keep**.
- Why: it is a git cache plus a file copy, called by the UI app as a CLI. Claude Code's built-in plugin marketplaces already distribute plugins, but templates are data files, not plugins, and the UI depends on this CLI and on the installed-templates files. A mod could only add convenience (a slash command, a stale-cache nudge).
- Mod abilities that might apply: `$.command.register` + `command.run` (a `/templates` command printing `catalog`), `$.flow.run(['python3', 'scripts/template_manager.py', ...])` (30 s default, 10 min max; clone has a 120 s limit inside the script), `$.flow.spawn` (streamed output), `$.http.fetch`, `$.clock.every` / `$.clock.after` (background refresh), `$.store` (remember last check), `session.start`, `$.ui.toast` ("2 template updates available").

## 4. Research questions
1. Do templates need to stay outside the plugin? Check the Claude Code plugin docs (`https://code.claude.com/docs/en/plugins/overview`, "marketplaces") for whether a plugin can carry templates as plain files that a plugin update refreshes, and whether that would replace the git-cache design. (Decision belongs to the owner; record facts.)
2. Can a mod run `template_manager.py refresh` in the background at `session.start` using `$.clock.after` and `$.flow.run` without blocking the first prompt (the 10 s hook limit)? What does it cost the user (network, git)?
3. Can a mod show "template updates available" using `catalog` / `status` output and `$.ui.toast` or `$.ui.status`, so the unused `autoRefreshOnStale` setting becomes real? Which `$` method reads the plugin's own settings (`userConfig` via `register(on, options)`, or `$.settings.read`)?
4. Does a mod add anything the UI cannot already do? State the answer in one line, so the final plan can drop this item if the answer is no.
5. What happens to this feature when mods are switched off (`allowManagedModsOnly`, `--safe-mode`, `disableAllHooks`)? (Because the CLI stays, nothing breaks: confirm in the admin page.)
6. Is a `$.command` the right way to expose `install` (needs arguments: marketplace, category, template, type)? Check `argumentHint` and `e.args` parsing in the `api` page, "Add a command".

## 5. How to research
1. Re-read these mods docs pages (full URLs under `https://code.claude.com/docs/en/plugins/mods/`):
   - `api`: "Add a command", "Run work in the background", "Show something without starting a turn", "Reach files, flows, and the network".
   - `reference`: "Limits" and "Settings and environment variables" (`allowManagedModsOnly`, `disableAllHooks`).
   - `admin`: "Choose how much to allow" (what survives when mods are limited).
   - Also `https://code.claude.com/docs/en/plugins/overview` and `https://code.claude.com/docs/en/plugins/publish` for plugin marketplaces (question 1).
2. Search the type file for: `interface FlowRunOptions` / `flow.run`, `timeoutMs`, `command.register`, `argumentHint`, `settings.read`, `userConfig`.
3. Read these repo files: `scripts/template_manager.py` (all of it, especially `:94-160`, `:461-712`), `config/marketplaces.default.json`, `scripts/models.py:819-975`, `skills/flow-new/SKILL.md` (template lookup sections), `../agentic-flows-ui/electron/main.ts:1195-1295`.
4. Compare: the 11 subcommands against the plugin-marketplace features Claude Code already has, and against what a mod can add (nudge, command). Mark each subcommand "keep as is" or "mod could add on top".
5. Write the answer under "7. Research result".

## 6. Out of scope
Research only. No repo edits (including fixing the weaknesses above, which should only be listed) and no building a mod. The UI Marketplace screen stays as it is. Related items: `P12` (UI app), `X01` (mods off).

## 7. Research result

Built at the owner's request after the plan page "Mod Migration P06 to P12" (all 5 decisions kept as proposed).

### Claude Code version
2.1.296

### Answers (short)
1. Templates stay outside the plugin (owner's decision): git marketplaces keep third-party sources possible.
2. Refresh runs in the pane on a button press, with `$.flow.run(argv, { timeoutMs: 120000 })`. No background refresh: `autoRefreshOnStale` was never read and is not added.
3. The unused auto-refresh setting stays in the file and does nothing.
4. The UI app is obsolete, so the mod is the only front end. The module adds a way to install templates without it.
5. With mods off the tab does not exist; templates already installed still sit in the folder.
6. A pane with buttons per row is used instead of a command with arguments.

### What changed
- New `hooks/infra/templates/templates.ts`: `refreshMarketplaces`, `catalog`, `installTemplate`, `removeTemplate`. Same files and shapes as before (`config/marketplaces.json`, `installed-templates.json`, `cache/sources/<name>`).
- Fixed on the way: remove and install match on category and name, so two templates with one name in two categories no longer clash. A name must be plain (`[A-Za-z0-9_.-]+`) before any folder is deleted.
- Windows uses one PowerShell command for copy and for remove.
- Pane: third tab "Templates" (`on-flow-pane.ts`).
- Deleted: `scripts/template_manager.py`, `scripts/models.py`.
- Added in a second step (plan "Marketplace Management in the Flow Pane"): Add, Edit, On/Off and Remove of a marketplace on the Templates tab (`addMarketplace`, `updateMarketplace`, `toggleMarketplace`, `removeMarketplace`). Remove asks twice. A new address or branch drops the cache, because a pull would read the old remote. An address starting with "-" is refused, and `git clone` gets `--` before the address.
- Not ported: `status`, `list-marketplaces` (the tab shows the same facts) and the legacy config migration.

### Final verdict
**replace.**

### Evidence
Repo: `templates.ts`, `templates.test.ts` (7 tests), `on-flow-pane.test.ts` ("the Templates tab ...").

### Risks
`git` must be on the machine, as before. The test suite fakes git.

### What a later plan must decide
Nothing.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P09"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
