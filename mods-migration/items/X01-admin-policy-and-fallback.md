# X01 · Admin policy and fallback

> Status and result live in `../progress.html` (entry `X01`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.
> This is a RISK / cross-cutting item, not a spike. Research only: produce questions and facts, no code.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin whose rules (block tools at an approval checkpoint, force logging, force auto-advance) are enforced today by shell scripts registered as settings hooks in `hooks/hooks.json`. If the rules move into a mod, an administrator or a user setting can switch the mod off while the plugin stays installed. The workflow would then run with no enforcement, silently. This item lists every way a mod can be off, what keeps running in each case, and what the plugin should do about it. The owner works at Payoneer, which probably has managed settings on developer machines.

## 2. What exists today
- Enforcement is 11 shell scripts in `hooks/hooks.json` (events `Stop`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`). They are settings hooks of a plugin. Settings hooks "keep working" next to mods (docs `admin`, "Know which controls still apply").
- Skills (`flow-new`, `flow-continue`) already warn that without session binding "all enforcement hooks will be silently disabled" (`skills/flow-continue/SKILL.md` line 43). There is no check that a hook ran. A disabled hook is invisible to Claude.
- The UI app (`../agentic-flows-ui`) launches `claude` itself in a pane (`electron/agentSessionManager.ts`): argv is `claude`, plus `--dangerously-skip-permissions` for allow-all and `--resume <id>`. It sends `/zeremai continue <path>` first. It does not pass `--bare`, `--safe-mode` or `-p`.
- The README of this pack already lists the risk (`allowManagedModsOnly`, `--safe-mode`).

## 3. First guess (step 3, not final)
- Verdict: improve (the migration needs a fallback and a detection path; keep or keep-in-parallel the scripts until the policy question is answered).
- Why: a mod can be off by policy, flag, crash or rollout, and the plugin cannot rely on it. The scripts as settings hooks run in more cases.
- Abilities: a mod can report that it is loaded (for example write a heartbeat file at `session.start`); a skill can check it; both settings hooks and mod can coexist in one plugin.

## 4. Research questions
Facts to verify from the docs are listed first, with where the owner's search starts. Each is a question, not an answer.

### A. Ways a mod is off (verify each in `admin`, `overview` "Turn mods on or off", `troubleshoot`)
1. `allowManagedModsOnly`: is it set as an option of the built-in guard (`pluginConfigs` > `cc-plugin-sec-default@builtin` > `options`, managed settings only), not as a top-level setting? Which mods does it refuse (user-installed, `--plugin-dir`, Claude-written, GitHub or remote marketplace plugins)? What does the user see (debug log, transcript line `refused by cc-plugin-sec-default: mods are limited to your organization's by policy (allowManagedModsOnly)`)? What is not affected (settings hooks in files and in plugins' `hooks/hooks.json`, status lines, `/goal`)?
2. `allowManagedHooksOnly`: which hooks still run? Docs `admin` say only the org's mods and built-in mods load, and the setting "also blocks hooks in users' own settings files". Open the linked `settings-reference#what-runs-under-allowmanagedhooksonly`: do the settings hooks inside a non-managed plugin's `hooks/hooks.json` run or not? (This decides whether the 11 scripts survive under this policy. It is the key fact; the docs page read for this item only points to the settings reference.)
3. `disableAllHooks`: in managed settings it stops all installed-plugin mods and all settings hooks, including managed ones. In a user settings file, what exactly happens to plugin `hooks/hooks.json` hooks (`troubleshoot` says `only managed plugins and built-in plugins run` appears when `disableAllHooks` is set in a settings file other than managed settings)? Does it also disable the scripts, so the plugin has nothing left?
4. `--safe-mode`: docs say it turns installed mods off and "also disables your other customizations". Do the plugin's settings hooks run in safe mode? (README currently says "settings hooks keep running"; the docs read for this item only say safe-mode disables other customizations.) What does the user see?
5. `--bare`: refusal `installed plugins that are not managed load no hooks module in this mode (--bare)`. Do the plugin's settings hooks run under `--bare`? Does the UI or any automation use `--bare` or `-p`?
6. Trust prompt: in a new directory no mod loads until the user answers it (`admin` "Trust prompts come first"; `troubleshoot` "No mod loads in a directory you opened for the first time"). Do settings hooks of a plugin also wait for trust? In which UI launch (a fresh pane in a new directory) can this bite?
7. Rollout switch off: Anthropic can turn installed mods off remotely (`troubleshoot` messages `hooks modules are turned off ... rollout switch served off`, and `saved off by an earlier session`). How often might this happen, and does it also apply to settings hooks? Is the switch also applied to the built-in guard or only installed mods? Is there a status page or release note for it?
8. Worker crash: three crashes of the hooks worker unload every non-built-in mod until `/reload-plugins` or a new session (`troubleshoot`, "mods that run in the hooks worker are off for this session"; the line reaches the transcript in interactive sessions). Is it visible in `claude -p`? Can a mod detect that it was unloaded? What would then protect a pending approval checkpoint?
9. Version: mods are on by default from v2.1.286/2.1.287. Which Claude Code version does the owner's org run? What happens on older versions: does the `hooks/hooks.json` with `modules` key break the plugin, or is the key ignored?
10. Platform: Desktop app WSL sessions do not load plugins (`overview`, "Where mods run"). VS Code chat panel runs hooks but cannot draw. Does the owner's team use these?

### B. What keeps running when the mod is off
11. Build a table (policy or flag by what still runs: mods of other plugins, built-in mods, settings hooks in settings files, settings hooks in plugins, managed hooks, status line, skills, agents, MCP servers). Fill from docs; mark each cell `confirmed in docs` or `needs test`.
12. Docs `admin`: "`disableAllHooks` and `allowManagedModsOnly` stop a mod and leave the rest of its plugin in place: skills, commands, agents, MCP servers still load." Confirm that the plugin's skills and agents (`flow-new`, `step-executor`) still load when the mod is off, so the workflow runs without enforcement rather than not at all.

### C. Does a marketplace plugin count as the org's mod?
13. Docs: a mod counts as the org's only if (a) managed `enabledPlugins` sets it true, (b) managed settings name the plugin's marketplace as a local directory by absolute path, (c) the marketplace lists the plugin by a relative path so it is loaded in place. A plugin copied from GitHub, git, URL or npm counts as a user's, even if enabled by managed settings. Is `zeremai` installed that way at Payoneer (a git marketplace)? If yes, `allowManagedModsOnly` would refuse its mod while its scripts keep running. What is the install path of the plugin on the owner's machine (`~/.claude/plugins/...`)?
14. Could Payoneer's device management copy a marketplace directory with the plugin onto every machine so it counts as the org's mod, with `prependPlugins`/`appendPlugins` ordering? Who owns that (IT, security)? Is the plugin allowed by `strictKnownMarketplaces` or the marketplace allowlist?
15. Does the built-in guard `sec-default` load for the owner (managed settings on the machine, or Team/Enterprise sign-in)? What does `claude --debug` show for `cc-plugin-sec-default`?

### D. Fallback design questions (for the later plan)
16. Detect a missing mod: can a skill or script tell that the mod is not loaded? Options to evaluate: (a) the mod writes a heartbeat at `session.start` and the scripts or skills check it; (b) `/plugin` shows the `mods active` line (visible to the user, not to Claude); (c) `claude plugin test` message `hooks modules are turned off here`.
17. Keep the scripts as the fallback? Ways to run mod and scripts without double enforcement (both blocking the same thing, double messages): the scripts check the heartbeat and exit 0 when the mod is alive; or the mod claims events first and scripts only run when the mod is off. Is a duplicated-but-idempotent guard acceptable?
18. Where could enforcement live that policy cannot turn off? (Scripts as settings hooks vs mods; note `allowManagedHooksOnly` and `disableAllHooks` can turn off both.) What should happen when nothing enforces: warn the user in the flow UI, refuse to start a flow, or allow with a banner?
19. Fail direction: for a guard that blocks tools at an approval checkpoint, what should happen when the mod crashes or times out: fail closed (`.catch` with deny) or open? Docs: a hook without `.catch` fails open. What is the risk for the owner's users either way?
20. Should the plugin publish two flavours (mod plus scripts, scripts only) or one plugin with both?

### E. Questions for the owner's org setup (Payoneer)
21. Are Claude Code managed settings deployed on developer machines (file, MDM, claude.ai admin console)? Which keys: `allowManagedModsOnly` (as `pluginConfigs` option), `allowManagedHooksOnly`, `disableAllHooks`, `disableSideloadFlags`, `strictKnownMarketplaces`, `enabledPlugins`, `prependPlugins`, `extraKnownMarketplaces`?
22. Are users on a Team or Enterprise plan, an API key, or Bedrock/Vertex/Foundry? (This decides whether the guard loads.)
23. How is `zeremai` installed today and updated (marketplace source, version pin, auto-update policy)?
24. Does Payoneer already run a policy mod (`prependPlugins`), and does it block mods that call `$.flow.run`, `$.fs.write`, `$.http.fetch`? (The migration mod would call `$.fs`, probably `$.flow.run` for `flow_manager.py`.) Who reviews mods for approval (`claude plugin validate` output with `hooks:` and `calls:` lines)?
25. Which Claude Code version is the baseline, and who updates it?
26. Is the UI's launch path (Herdr panes, `--dangerously-skip-permissions`, `--resume`) acceptable under their policy?

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`): `admin` (all sections: "Stop user-installed mods from loading", "Know what happens by default", "Know which controls still apply", "Choose how much to allow", "Install your organization's mods", "Enforce a policy with a mod of your own"), `troubleshoot` ("Check whether mods can load", "Refusal messages", "Messages from the built-in guard", "A hook is skipped or a mod is unloaded", "No mod loads in a directory you opened for the first time"), `overview` ("Turn mods on or off", "Where mods run", "Mods built into Claude Code"). Also fetch the linked non-mods pages: https://code.claude.com/docs/en/settings-reference (sections `disableAllHooks` and "What runs under `allowManagedHooksOnly`"), https://code.claude.com/docs/en/plugins/org (marketplace restrictions, "When each surface applies the plugin keys"), https://code.claude.com/docs/en/cli-reference (`--safe-mode`, `--bare`). Note `claude --version`.
2. Search the type file (see reading list) for: `plugin.register`, `tier`, `refuse`. Only for context on what an org mod could do.
3. Read these repo files: `hooks/hooks.json`, `skills/flow-continue/SKILL.md` (lines 37-43), `../agentic-flows-ui/electron/agentSessionManager.ts` (argv construction).
4. Compare with: `../../docs/claude/claude-code-hooks-reference.md` and the plugins docs copy in this repo's `docs/`, for settings-hook behaviour under these policies.
5. Fill the matrix in question 11 from docs; mark `needs test` where the docs are silent. A needs-test cell can become an S02 sub-test (trust, `--bare`, `-p`, `--safe-mode`); do not build anything in this item.
6. Check read-only on the owner's machine: `claude --version`, `claude plugin test` from a directory with no mod (prints whether mods can load), `claude --debug` and search the log for `cc-plugin-sec-default`, and look for a managed-settings file (macOS `/Library/Application Support/ClaudeCode/managed-settings.json`). Only read; change nothing.
7. Write the answers under "7. Research result".

## 6. Out of scope
No implementation, no plugin edits, no changes to settings. Do not change the machine's managed settings. This item produces facts and questions for the owner and for a later plan.

## 7. Research result

Closed from the built mod and its tests, at the owner's request after the plan page "Spikes and Policy: Last Mod Items" (decisions kept as proposed). No throwaway mod was run.

### Claude Code version
2.1.296. Read on 2026-10-10: `plugins/mods/admin` and `plugins/mods/troubleshoot`. No setting was changed and no test was run.

### What still runs when mods are off (from the docs)

| Switch | Our mod | Skills and agents of the plugin | Settings hooks |
|---|---|---|---|
| `allowManagedModsOnly` (guard option) | Off if the plugin counts as a user's | Load ("stop a mod and leave the rest of its plugin working") | Keep running |
| `allowManagedHooksOnly` | Off unless managed | Test | Blocked, including users' own |
| `disableAllHooks` in managed settings | Off | Load | All off |
| `disableAllHooks` in a user file | Off ("only managed plugins and built-in plugins run") | Test | Off for the user |
| `--safe-mode` | Off | **No installed plugin loads at all** | Test |
| `--bare` | Off for installed plugins | Test | Test |
| New folder, trust not answered | Off until answered | Test | Test |
| Rollout switch off | Off | Load | Not stated |
| 3 worker crashes | Off until `/reload-plugins` | Load | Not stated |

### Answers (short)
- Detect a missing mod: the flow skill looks for the tool `create_flow` and stops with a message (`skills/flow-run/SKILL.md`, "Mods off"). It works where the skills still load. Under `--safe-mode` the skill is not loaded either, so the user sees nothing from the plugin.
- Fallback scripts: not kept (P10). No heartbeat file is needed.
- The guard loads on a machine with managed settings, or for a Team or Enterprise sign-in. This machine has no managed settings file at `/Library/Application Support/ClaudeCode`.
- A plugin installed from a git or GitHub marketplace is copied into the cache and counts as a **user's** mod: `allowManagedModsOnly` refuses it, and `appendPlugins` skips it. To count as the organization's, the marketplace must be a directory on each machine, named in managed settings by absolute path, the plugin listed by a relative path, and the plugin enabled in managed `enabledPlugins`.
- Fail direction: a hook with no `.catch` fails open. Only the approval gate guard has one (S01).
- Not covered by the docs read: Windows WSL Desktop sessions (no plugins), VS Code (hooks run, nothing draws).

### Final verdict
**improve** (the plugin stays; one check and one README line cover the off cases that can be covered).

### Risks
A policy that refuses the mod leaves the skills in place with no tools. The skill check handles that. `--safe-mode` shows the user nothing.

### Questions only the organization can answer (Q21 to Q26)
1. Are managed settings deployed on developer machines (file, MDM, admin console), and with which keys?
2. Team or Enterprise plan, an API key, or a cloud provider? (This decides whether the guard loads.)
3. How is `zeremai` installed and updated today (git marketplace, version pin)?
4. Is there a policy mod (`prependPlugins`) that refuses mods that call `$.flow.run` or `$.fs.write`? This mod calls both.
5. What is the Claude Code baseline version, and who updates it?
6. Is a copy of the marketplace directory on every machine acceptable, so the plugin counts as the organization's?

### What a later plan must decide
Whether to ask IT for the directory install, which also allows a real stop veto (S03).

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "X01"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
