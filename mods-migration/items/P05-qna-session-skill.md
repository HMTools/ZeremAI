# P05 · Q&A session skill

> Status and result live in `../progress.html` (entry `P05`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. While a step runs, the model may need several answers from the user. The `flow-QnA-session` skill lets it open a structured "Q&A session": a file `qa-session.json` in the flow folder holding questions, answers (with history) and a status. While the session is open, the plugin tries to stop the model from continuing and from creating an approval checkpoint. The UI app shows the questions as a form and writes answers back. Related: P02 (approval wait file; Q&A takes priority over it), P01 (CLI), the `UserPromptSubmit` hook for Q&A (see H-series, script `check-qa-session.sh`), P07 (memory and log files).

## 2. What exists today
Files:
- `skills/flow-QnA-session/SKILL.md` (694 lines, `user-invocable: false`). Operations 40-224, workflow 226-252, status tables 256-277, blocking 310-334, CLI vs UI 336-381, best practices 385-420, file structure 611-637.
- `scripts/flow_manager.py`: `derive_session_status` 71-96, `validate_qa_session` 99-128, `map_to_qa_session_log` 131-174, `create_qa_session_memory` 177-205; handlers `cmd_create_qa_session` 1264, `cmd_update_qa_answer` 1323, `cmd_complete_qa_question` 1376, `cmd_complete_qa_session` 1419, `cmd_get_qa_session` 1507; parsers 1702-1728.
- `scripts/check-qa-session.sh` (UserPromptSubmit, wired in `hooks/hooks.json` after `create-log-flag.sh`).
- `scripts/flow_manager.py:1204-1216`: `write-pending` refuses while `qa-session.json` exists.
- UI: `../agentic-flows-ui/electron/fileWatcher.ts:77` (classifies `qa-session.json`), `electron/main.ts:234-238` (broadcast `qa-session-update`), `main.ts:474-650` (IPC `read-qa-session`, `answer-question`, `complete-question`, `get-qa-session-status`), `electron/preload.ts:169-176, 219-223`.

Behaviour in plain words:
- Flow: model creates the session (`create-qa-session --step-id --step-name --questions '[...]'`), the user answers in chat or UI, the model records each answer (`update-qa-answer`), marks questions complete (`complete-qa-question`), and finally archives (`complete-qa-session`). Status is derived: `pending` (a required question unanswered), `partial`, `completed`. Answers keep a history (iteration, text, timestamp). Archiving writes a `qaSession` entry into `log.json` for the step and a `qaSession` summary into `memory/qa-sessions.json`, then deletes `qa-session.json` (1419-1505).
- Enforcement today: `check-qa-session.sh` runs on every user prompt, finds the bound flow by `.session`, and if `qa-session.json` is not completed prints a long instruction. It exits with code 1 (last line) and writes to stdout. By reading the hooks reference, exit code 1 is a non-blocking error for Claude Code hooks (only exit 2 blocks), so the "block" may do nothing and its stdout may never reach the model. Unsure; verify in `../docs/claude/claude-code-hooks-reference.md` and with the hooks docs. Also `write-pending` blocks approval creation while a session exists.
- Contradictions found in the skill text (do not trust it without checking the code):
  - SKILL.md uses subcommand names `create-session`, `answer-question`, `complete-question`, `complete-session`, `get-session` (lines 51-224, 648). The real CLI names are `create-qa-session`, `update-qa-answer`, `complete-qa-question`, `complete-qa-session`, `get-qa-session`. Also `create-qa-session` requires `--step-id` and `--step-name`, which SKILL.md examples never pass.
  - SKILL.md says a hook `block-pending-on-qa.sh` in `hooks/` enforces "no approval while Q&A is active" (lines 324, 596, 659). No such file exists; the rule is inside `cmd_write_pending`. `check-qa-session.sh` is in `scripts/`, not `hooks/`.
  - SKILL.md says archiving writes `memory.json`; the code writes `memory/qa-sessions.json` (topic file).
  - The UI calls `update-qa-answer` and `complete-qa-question` with POSITIONAL arguments (`main.ts:524-530`, `585-590`); the CLI requires `--flow-dir`, `--question-id`, `--answer` flags. By reading argparse, these calls would fail. The UI never calls `create-qa-session` or `complete-qa-session` (not found in `electron/`). Not run; verify.
- The UI "form" path: the UI writes answers into `qa-session.json` (via the CLI), the model is supposed to notice and continue; how the model is woken up when the user answers in the UI is not defined in the files read (the SKILL.md says "Agent receives notification" at line 372, but no mechanism was found).
- Files: reads/writes `<flow>/qa-session.json`, `<flow>/log.json`, `<flow>/memory/qa-sessions.json`.

## 3. First guess (step 3, not final)
- Verdict: improve.
- Why: the JSON shape of `qa-session.json` is the UI's contract and stays. But asking the user a question, waiting, and getting the answer back is exactly what a mod can do natively, so the model's multi-command ceremony and the unreliable hook can shrink.
- Mod abilities that might apply:
  - `$.ui.ask`: ask all questions in the Claude Code session with options and free text, get answers as data. Check supported shapes (single, multi, free text) in the type file.
  - `$.tool.register` + `tool.call`: a tool `ask_user(questions)` that creates `qa-session.json` (via `$.fs` or the CLI through `$.flow.run`), asks via `$.ui.ask`, records answers (so the file stays in sync for the UI), archives, and returns the answers as the tool result. This replaces create/answer/complete/archive as four model-driven calls.
  - `render site AskUserQuestion` (`ui.render`): Claude Code's own AskUserQuestion tool can be re-drawn by a mod (reference "Render sites"); check whether answers can also be mirrored to `qa-session.json`.
  - `prompt.submit` with `{ drop: reason }` or `next({ ...e, context })`: replace `check-qa-session.sh` (add context about open questions, or drop the prompt with a clear reason).
  - `$.clock.every` + `$.fs.read`: watch for answers entered in the UI.
  - `$.state` / `ui.render` AbovePrompt band: show "2 questions open".

## 4. Research questions
1. Does Claude Code already ship a native ask-the-user tool (`AskUserQuestion`) and can a mod intercept it (`tool.call`, `ui.render` site `AskUserQuestion`) to mirror question and answer into `qa-session.json`? Compare it with `$.ui.ask`.
2. What does `$.ui.ask` accept and return (options, multiple questions, default, free text, cancel)? Can it cover the `QASessionQuestion` shape (topic, question, priority required/optional, context, options)?
3. If the user answers in the UI app instead of the session, how does a mod find out and wake the model: poll `qa-session.json` with `$.clock.every`, then `$.prompt.submit`? Or is there a native way to receive file changes?
4. Is a `tool.call`-based `ask_user` tool better than keeping the five CLI subcommands and replacing only the hook? List what the model must still do in each design.
5. Is `check-qa-session.sh` actually effective today (exit code 1 on `UserPromptSubmit`)? Check the settings-hooks reference and the mods `classic.UserPromptSubmit` result type. If it is ineffective, a mod fixes a latent bug: say so with evidence.
6. Must archiving still write the `log.json` and `memory/qa-sessions.json` entries (the UI shows them)? Which side does it, the CLI or the mod?
7. The UI calls the CLI with arguments the CLI rejects. Is this a stale call path? The owner says the UI keeps using the same files and CLI, so decide whether to flag it as a fix needed before any plan (answerable by reading; do not fix).
8. What happens when mods are off (admin policy, `--safe-mode`)? Is the CLI plus skill enough as fallback? (See X01.)

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/interface (`$.ui.ask`, "Change what Claude Code already draws" for AskUserQuestion, `ui.select`/`ui.input`)
   - https://code.claude.com/docs/en/plugins/mods/events#rewrite-or-add-to-a-prompt (`prompt.submit` drop and context)
   - https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call
   - https://code.claude.com/docs/en/plugins/mods/api#add-a-command-or-a-tool and `#run-work-in-the-background`
   - https://code.claude.com/docs/en/plugins/mods/reference#render-sites, `#events`, `#limits`
   - https://code.claude.com/docs/en/hooks (UserPromptSubmit exit codes) for question 5
2. Search the type file for: `ask(`, `AskUserQuestion`, `UserPromptSubmit`, `ClassicResult`, `prompt.submit`, `PromptSubmitResult`, `drop`.
3. Read these repo files: `skills/flow-QnA-session/SKILL.md` (full), `scripts/flow_manager.py` lines listed above, `scripts/check-qa-session.sh`, `hooks/hooks.json`, `types/schema.json` (search `QASession`), `../agentic-flows-ui/electron/main.ts:474-650`, `../agentic-flows-ui/electron/fileWatcher.ts`.
4. Compare: current five-command flow plus hook against (a) a single tool, (b) `$.ui.ask` driven by the mod. Mark which steps disappear. Keep a list of every contradiction between SKILL.md and code (section 2) and report them.
5. Write the answer under "7. Research result".

## 6. Out of scope
No implementation. No plugin edits (do not fix SKILL.md or the UI call). No building a mod. (Only items S01-S03 may build a throwaway mod outside this repo.)

## 7. Research result
_(filled 2026-10-10)_
- Claude Code version (`claude --version`): 2.1.296. Type file read from the public repo copy (`mods/types/claude-code.d.ts`, main).
- Answers to questions 1-8:
  1. Claude Code ships `AskUserQuestion` (1-4 questions, 2-4 options, free text under "Other"). A mod can draw it (`ui.render` site `AskUserQuestion`) and `$.ui.ask` opens the same dialog. Nothing needs to mirror into `qa-session.json`: the file is gone.
  2. `$.ui.ask(question, options | { options, header, multiSelect })` takes ONE question and returns the label, comma-joined labels, or free text. It rejects on dismiss and in `-p`. It has no field for priority or context.
  3. Moot: the UI app is obsolete, and a native dialog is answered in the session.
  4. Single tool vs five commands: the built-in dialog needs no tool. Model work left: ask, then call `log_interaction`.
  5. Moot. `check-qa-session.sh` exited with 1, and the hooks reference says only exit 2 blocks (`docs/claude/claude-code-hooks-reference.md:265`), so it was most likely a no-op. Deleted anyway.
  6. The `log.json` and `memory/qa-sessions.json` archive entries are gone with the feature. The answer is logged with `log_interaction` (one line added to `skills/flow-run/SKILL.md`).
  7. Moot: the UI calls and the CLI commands are both gone.
  8. With mods off, the built-in dialog still works. Only the flow tools need the mod (see P04).
- Final verdict: **remove.** The feature was deleted in commit 6bc5784 (with H11). Questions use the built-in dialog.
- Evidence (doc page + section, type-file name, repo `file:line`): type file `$.ui.ask`, `AskOptions`; `git show 6bc5784 --stat` (skill, `check-qa-session.sh`, 498 lines of `flow_manager.py`, `types/qa-session.ts`); `skills/flow-run/SKILL.md:35`; `hooks/infra/flow-manager/tools.ts:57` (`log_interaction`); `agents/step-executor.md:31` (re-run with "User Corrections").
- Changed by this item: one line in `flow-run`, a "Questions" section in `agents/step-executor.md`, the Q&A lines in `mods-migration/README.md`, and the P05 entry in `progress.html`.
- Open questions: Can a mod hook see the answer of `AskUserQuestion`, to log it without the model? Can a subagent open the dialog itself (not checked; the plan hands questions to the parent)?
- Risks: Claude can forget `log_interaction` after a question, as it can for approvals. The installed copy of the plugin can still list `flow-QnA-session` until a new release.
- What a later plan must decide: Whether to add a mod hook that logs answers (needs the first open question answered).

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P05"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1-3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
