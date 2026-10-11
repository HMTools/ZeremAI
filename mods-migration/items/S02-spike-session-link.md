# S02 · Spike: session to flow link

> Status and result live in `../progress.html` (entry `S02`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.
> This is a SPIKE: the only kind of item that may build something, and only outside this repo.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows"). Every enforcement hook has to know which flow the current Claude session works on. Today that link is a file: `~/.claude/zeremai/active/<flow>/.session` holds the session id. Every hook scans `active/*/.session` and compares the content with the hook's `session_id`. The file is filled by a `PostToolUse` hook after Claude writes an empty `.session` into the flow folder. This spike tests whether a mod can own that link (and drop the scan), and whether the link survives resume, clear and branch, and programmatic launch.

## 2. What exists today
- `scripts/bind-session-to-flow.sh` (`PostToolUse`, matcher `Write|StrReplace|Edit`, registered in `hooks/hooks.json`): reads `session_id` and `file_path`; if the path is inside `.../.claude/zeremai/active/<name>/...` and `.session` is missing or empty, writes `session_id` into it (lines 21-30). Never overwrites a non-empty `.session`.
- The scan loop `for SESSION_FILE in "$AGENTIC_DIR"/active/*/.session` is copied in `block-tools-on-pending.sh` (lines 17-23), `check-approval-stop.sh` (21-27), `enforce-log-on-stop.sh` (31-39), `block-stop-pending-steps.sh` (20-26) and other scripts (see item `C01`).
- `skills/flow-new/SKILL.md` lines 80-83 and `skills/flow-continue/SKILL.md` lines 37-43: "Session Binding", a mandatory first action: write an empty `.session`, let the hook fill it, verify. Without it "all enforcement hooks will be silently disabled for the entire session" (flow-continue line 43). Child flows are bound the same way.
- `agentic-flows-ui/electron/agentSessionManager.ts` (read-only): launches `claude` in a Herdr pane (`argv = ['claude', ...]`, adds `--dangerously-skip-permissions` for allow-all, `--resume <id>` to resume lines 214-227), then sends `/zeremai continue <path>` as the first message (`flowAttachCommand`, line 75). It does not pass `--plugin-dir`, `--bare`, `-p`, or `--safe-mode` in the code read.
- A resumed or continued flow gets a NEW session id, so `flow-continue` rebinds; the `.session` file only holds one id (a rebind needs it empty).
- Weaknesses: binding is a convention Claude may forget; the scan is repeated in every script; `/clear` and `--resume` produce new or reused ids with no explicit event handled.

## 3. First guess (step 3, not final)
- Verdict: improve or replace: the mod binds at a defined moment and exposes the flow dir to the other mod hooks, while `.session` stays on disk for the UI.
- Why: `$.session.id()` plus `session.start` / `tool.call` / `classic.SessionStart` (has `source`) give a reliable id. `$.store` can map session id to flow dir across sessions.
- Abilities: `session.start`, `classic.SessionStart` with `e.source` (`startup`, `resume`, `clear`, `compact`, `fork`), `tool.call` (detect a write into the flow folder, like the PostToolUse script), `$.session.id()`, `$.state` / `$.store`, `$.fs`.

## 4. Research questions
1. Does a mod have `$.session.id()` (or equivalent)? What does it return, and is it the same value the settings hooks receive as `session_id`? Compare the debug-log line from the mod with a test settings hook's stdin.
2. Can a mod replace the scan: at `tool.call` for a Write/Edit whose path is inside `active/<name>/`, resolve the flow dir from the path and keep it in a module variable and `$.store` keyed by session id? Is a module variable enough inside one session (note docs: module variables reset on module reload, which happens on `/reload-plugins` and the worker-replacement case)?
3. Docs `interface#keep-state`, `$.state` resets on `/clear`, `/resume`, `/branch` and `session.start` does not fire again (`troubleshoot`, "A value resets after /clear, /resume, or /branch"). Does `$.store` survive? Does `$.session.id()` change after each of: `claude --resume <id>`, `claude --continue`, `/resume` in a session, `/clear`, `/branch`, compaction?
4. `classic.SessionStart` with `source: ['clear','resume','fork']` fires after each reset (docs `interface#load-a-saved-value-again-after-clear`). Confirm the `source` values observed and that the hook runs for `startup` too. In which of these is the id the same as before, and in which new?
5. Resume and the `.session` file: after `claude --resume <old-id>`, the id is (docs unknown) either equal to the old id or new. If equal, the `.session` file keeps matching; if new, what must the mod do (rewrite `.session`, since `bind-session-to-flow.sh` only writes an empty file)? What does the UI expect (it resumes with `--resume`)?
6. Can the mod write the `.session` file itself (`$.fs.write`) so the skills no longer need to say "write an empty .session"? Does `$.fs` allow a path outside the project (limits in `api`/`reference`, 4 MiB file limit)?
7. Does the mod load when a program starts `claude` (the UI app: `agentic-flows-ui/electron/agentSessionManager.ts`)? Check each launch condition:
   a. interactive `claude` inside a pane the first time in a directory: no mod loads until the user answers the trust prompt (docs `admin`, "Trust prompts come first"; `troubleshoot` "No mod loads in a directory you opened for the first time"). Will the UI's launches hit that prompt? What does the user see?
   b. `claude --resume <id>`: do installed (marketplace) mods load, and does `session.start` or `classic.SessionStart` with `source: 'resume'` fire?
   c. `claude --bare`: docs say installed plugins that are not managed load no hooks module (`troubleshoot` refusal message). Confirm, and confirm whether settings hooks of the plugin run under `--bare`.
   d. `claude -p` (Agent SDK style): hooks run, drawing does not; `hooks module not loaded` goes to stderr; no `$.ui.ask`. Is anything in the plugin's flow headless?
   e. `claude --safe-mode`: expected no installed mods (and "other customizations" disabled).
8. If the plugin is installed from a marketplace, is the mod loaded the same way as with `--plugin-dir` for these launches (`troubleshoot` "Your edits don't take effect")? Does `/reload-plugins` matter for a flow the UI started earlier?
9. Race: `session.start` fires "before your first prompt". The UI sends `/zeremai continue <path>` as a first message. Can the mod bind from the command text (`prompt.submit`, `command.run`) before the model starts, instead of Claude writing the empty file? Is `e.text` for a slash command visible in `prompt.submit` or only in `command.run`?

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`): `interface` (sections "Keep state", "Load a saved value again after /clear", "Save from more than one session"), `events` ("Handle the settings hook events", `classic.SessionStart`), `api` (`$.session`, `$.fs`, `$.store`), `reference` (`session.start`, `classic.*`, Limits), `overview` ("Where mods run", "Turn mods on or off"), `admin` ("Know which controls still apply"), `troubleshoot` (refusal messages, trust prompt). Note `claude --version`.
2. Search the type file for: `session.start`, `SessionStartResult`, `SessionStart`, `source`, `session.id`, `PluginState`, `store`.
3. Read these repo files: `scripts/bind-session-to-flow.sh`, `scripts/block-tools-on-pending.sh`, `skills/flow-new/SKILL.md`, `skills/flow-continue/SKILL.md`, `../agentic-flows-ui/electron/agentSessionManager.ts`.
4. Build a throwaway mod OUTSIDE this repo with the `plugin-authoring` skill, folder `~/.claude/dev-mods/<session-id>/session-link-spike/`. Design in words:
   - `plugin.json` (name, version, description); `hooks/hooks.json` with `modules: ["./register.ts"]`; `hooks/register.ts`.
   - Events: `session.start`; `classic.SessionStart` (no filter, to log every `source`); `tool.call` with `{ tool: ['Write','Edit'] }`; optionally `prompt.submit`.
   - Behaviour: each hook appends one JSON line to a log file in a temp folder via `$.fs` (event name, `e.source` if any, `$.session.id()` value, module-variable value, `$.store` value, timestamp). On `tool.call` for a Write whose path contains `/active/<name>/`, store `{ [sessionId]: flowDir }` in `$.store` and write `.session` into the FAKE flow dir if empty. No enforcement.
   - Do not write the full implementation.
5. Fixture: fake root `$TMPDIR/s02/agentic/active/spike-proc/` (never the real `~/.claude/zeremai`). Because the mod looks for `/active/<name>/` in the path, make the fake root path contain `.claude/zeremai/active/` under the temp folder, for example `$TMPDIR/s02/home/.claude/zeremai/active/spike-proc/`.
6. Validate with `claude plugin validate <mod>`; run `claude --plugin-dir <mod> --debug-file <tmp>/s02.log` in a scratch project folder.

### Test procedure
| # | Do | Observe | Pass |
|---|---|---|---|
| T1 | Start fresh; ask Claude to write a file into the fake flow dir | Log has `session.start`, `classic.SessionStart source=startup`, `tool.call`; `.session` written once | `$.session.id()` equals the hook `session_id` (compare with a test settings hook that dumps stdin) |
| T2 | `/clear`, then write again | `classic.SessionStart source=clear`; `$.state` reset; `$.store` kept; id same or new? | Record result; store lookup still works |
| T3 | Exit, `claude --resume <id>` | `source=resume`; id | Record whether id equals the old id |
| T4 | `claude --continue` | Same | Record |
| T5 | `/branch` in session | `source=fork`; id | Record |
| T6 | Send `/compact` | `source=compact`? module variables intact | Record |
| T7 | Start `claude` from a script in a NEW directory (as the UI does) | Trust prompt appears; no mod before answer | Mod loads only after trust |
| T8 | `claude --bare`, `claude -p "hi"`, `claude --safe-mode` | Debug line `hooks module ... not loaded:` or the mod loads | Record exact line for each |
| T9 | Edit nothing; install the mod as a plugin from a local marketplace folder and repeat T1, T3 | Same behaviour as `--plugin-dir` | Same |
| T10 | Send `/zeremai continue <fake path>` as the first message | Does `prompt.submit` or `command.run` see the path before the model? | Record |

Fail signals: id differs between mod and hook; module variable lost after resume; mod absent in T7-T8 conditions that the UI uses.

## 6. Out of scope
No changes to this repo or the UI app. No real flow state. The spike must not write into `~/.claude/zeremai`.

## 7. Research result

Closed from the built mod and its tests, at the owner's request after the plan page "Spikes and Policy: Last Mod Items" (decisions kept as proposed). No throwaway mod was run.

### Claude Code version
2.1.296

### What the built mod proves
- The link is `session:<id>` in `$.store` with the folders in order, a child after its parent (`flow-repository.ts`, `bind-session.ts`). No `.session` file and no scan.
- The pane and `bind_flow` bind with `$.session.id()`; `create_flow` binds too (`on-flow-tools.test.ts`).
- A new session after `/clear` has a new link: the user opens `/zeremai` again (P04).
- The mod needs no hook `session_id`, because it has no settings hook. Question 1 (same id as the hook) is moot.

### From the docs (troubleshoot page)
- `$.state` resets after `/clear`, `/resume`, `/branch`, and `session.start` does not fire again. The link is in `$.store`, which is kept.
- No mod loads in a folder the user has not trusted yet (question 7a).
- `--bare`: installed plugins that are not managed load no hooks module. `claude -p` draws nothing.

### Not proven live
Questions 3 to 5: the id after each resume path. The mod handles a changed id the same way for all: the user opens `/zeremai` and binds again.

### Final verdict
**replace.**

### Risks
A resumed session with a new id has no link until the user binds again. The guards then do nothing for that session.

### What a later plan must decide
A live check of the id after `--resume`, if the first prompt after a resume must be guarded.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "S02"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
