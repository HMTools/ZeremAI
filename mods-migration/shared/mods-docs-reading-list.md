# Claude Code mods: reading list

Every item in `../items/` tells you to "re-read the mods docs". This file says **which page answers which question**, so you read only what the item needs. Mods are an early-access API: the docs and the type file move between Claude Code releases. Note the Claude Code version (`claude --version`) in every research result.

## Pages (all under https://code.claude.com/docs/en/plugins/mods/)

| Page | URL | Read it to learn |
|---|---|---|
| Overview | `.../mods/overview` | What a mod is; mods vs settings hooks vs skills vs MCP; where mods run (terminal, Desktop, not VS Code panels / `claude -p` drawing); trust and on/off switches |
| Create a mod | `.../mods/create` | The 3 files (`plugin.json`, `hooks/hooks.json` with `modules`, `hooks/register.ts`); `claude --plugin-dir`; `claude plugin validate`; where Claude Code writes the type files |
| React to events | `.../mods/events` | `on(event, matcher, ($, e, next) => ...)`; observe / rewrite / answer; `tool.call`, `tool.check`, `prompt.submit`, `turn.*`, `classic.<Event>` (e.g. `classic.Stop`); `.catch` fail-closed guards; order of mods and settings hooks |
| Use the mods API | `.../mods/api` | `$.command`, `$.tool`, `$.model`, `$.clock`, `$.session.send`, `$.fs`, `$.flow.run`, `$.http`, `$.store`, `$.env`; hook time limits |
| Draw in the interface | `.../mods/interface` | Panes, band, `$.ui.*`, `$.state` vs `$.store` vs module variables; state after `/clear` and `/resume` |
| Interface gallery | `.../mods/gallery` | Element samples (only for UI items; all `U` items read it with `interface` and `reference#elements`) |
| Test a mod | `.../mods/test` | `claude plugin test`, stubs, mock clock/store |
| Troubleshoot | `.../mods/troubleshoot` | Why a mod does nothing; refusal messages; debug log |
| Admin | `.../mods/admin` | `allowManagedModsOnly`, `allowManagedHooksOnly`, `disableAllHooks`, `--safe-mode`; policy mods |
| Reference | `.../mods/reference` | Full event table with input/result shapes, `$` method list, limits, settings |

Also useful: the settings hooks reference in this repo, `../../docs/claude/claude-code-hooks-reference.md`, to compare a script's hook event with its mod equivalent.

## The type file is the authority

The exact input and result shape of every event is in the type declaration file, not in the pages.

- Online copy (can be older than your build): https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts
- Local copy for your build: invoke the `plugin-authoring` skill in a Claude Code session. It writes `claude-code.d.ts` and tells you the path. A mod loaded from a folder also gets it under `<mod>/.claude-plugin/types/claude-code/index.d.ts`.
- Search it with `grep -n "'tool.call'\|ClassicResult\|TurnCompleteResult" claude-code.d.ts`. It is about 20,000 lines: never read it whole.

Useful anchors found in step 3 (line numbers are from one build, search by name):
- `ClassicResult`, `ClassicResultFields`, `ClassicResultOf`: what a `classic.<Event>` hook can return. `Stop` can return `block`, `preventContinuation`, `stopReason`, `additionalContext`.
- `ToolCallInput`: `tool.call` input; carries `agentId` inside a subagent.
- `TurnCompleteResult`, `SessionStartResult`, `PreToolUseResult`.
- `stop_hook_active` on the Stop hook input: the loop guard the Stop scripts already use.

## How to answer "can a mod do X?"

1. Find the event or `$` method in the Reference page.
2. Open its declaration in the type file and read the doc comment and example.
3. Check Limits (Reference page): 10 s per hook, 30 s `$.flow.run`, 4 MiB `$.fs` file, etc.
4. Check Overview "Where mods run" and Admin page: can the mod be switched off, and what runs then?
5. If the page and the types do not settle it, write the question as an **open question** in the item. A later spike (items `S01`–`S03`) tests it. Do not write a mod for an item that is not a spike.

## Rules for all research items

- Research only. Do not change plugin code, scripts, hooks, skills or the UI app.
- A "verdict" is one of: `replace` (a mod does the job instead), `improve` (the part stays, a mod adds to it), `keep` (no mod change), `later` (needs the UI round). Bar set by the owner: a mod can do it.
- Cite evidence: doc page + section, or type-file name, or file:line in this repo.
- Write plain words. The owner reads results without the code open.
