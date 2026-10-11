# H02 · check-approval-stop

> Status and result live in `../progress.html` (entry `H02`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` (v2.0.28) is a Claude Code plugin that runs structured, resumable workflows ("flows") with steps, approval gates and Q&A. Flow state lives in JSON files under `~/.claude/zeremai/active/<flow>/` (`flow.json`, `log.json`, `pending-interaction.json`, `.session`). The plugin enforces its rules with shell hook scripts wired in `hooks/hooks.json`. Each script receives the hook JSON on stdin and answers with `{"decision":"block","reason":...}` on stdout or exit code 2 on stderr. This item is one of those enforcement pieces. The goal of the whole pack is to find out whether a Claude Code **mod** (JS/TS code running inside Claude Code, see the mods overview) can replace or improve it. The owner's bar: "a mod can do it".

## 2. What exists today
- Files: `scripts/check-approval-stop.sh` (44 lines) and `scripts/build_approval_block_message.py` (67 lines). Wired in `hooks/hooks.json` on **both** `Stop` (first hook of the group) and `SubagentStop` (its only hook). It is the only plugin hook on `SubagentStop`.
- Flow: parse `session_id` via `parse_hook_input.py` (`check-approval-stop.sh:10`, see C01); empty id prints `{}` and exits 0. Find the flow by scanning `active/*/.session` for the session id (`:21-27`). No flow: `{}`, allow. If `pending-interaction.json` already exists: `{}`, allow (`:34-39`). Otherwise call `build_approval_block_message.py <flow.json> <script_dir> <flow_dir>` (`:43`) and exit 0.
- The Python (`build_approval_block_message.py`): load `flow.json`; find the **first** step whose status is `in_progress` or `in-progress` **and** `approvalRequired` is true (`:17-21`). None: print `{}` (allow). Found: build a block reason and print `{"decision":"block","reason":...}` (`:63`).
  - Two reason variants. Plain (`:52-61`): "present deliverables, then create the checkpoint" with a ready-made `flow_manager.py write-pending --flow-dir ... --options '[approve, reject, modify]'` command. View variant (`:33-50`): if the step has a resolved `view` object (set at flow creation by `cmd_create_flow`, per the comment `:26`), the message lists each `view.operationIds` entry with the `mockData` keys the option's `data` must contain, and the example options get `data` filled from `view.mockData`.
  - `json.dumps` is used for the output, so step names are safely escaped (this was the reason for moving it out of bash, docstring `:3-7`).
- Counterpart check in `flow_manager.py` `cmd_write_pending` (`:1193-1250`): refuses to write `pending-interaction.json` when a Q&A session exists (`qa-session.json`), when the active step has no `approvalRequired`, and when the view requires `data` on options that lack it. So the stop hook's message and the CLI validation share one rule set that lives in two places.
- State read: `.session` files, `flow.json` (`steps[].status`, `approvalRequired`, `name`, `view.*`), `pending-interaction.json` (existence). Writes nothing.
- Weaknesses seen:
  - No `stop_hook_active` check and no counter: if the agent cannot create the checkpoint (for example Q&A session blocks `write-pending`, `cmd_write_pending:1208`), every stop is blocked again, forever.
  - On `SubagentStop` the hook input session id is the same as the parent session (verify: hooks reference, SubagentStop fields `agent_id`, `agent_type`, `docs/claude/claude-code-hooks-reference.md:540`). The script does not look at `agent_id`, so a step-executor subagent running an approval step can be blocked from returning, before the main agent can write the checkpoint. Whether this is intended (the subagent must write it) or a bug is **unknown**; the step-executor agent file `agents/step-executor.md` should be read to see who is supposed to create the checkpoint.
  - `.session` lookup is a shell loop, also copied into 7 other scripts (see C01).
  - `$script_dir` is embedded into the message as the cache install path (`${CLAUDE_PLUGIN_ROOT}`-based), so the message text changes per plugin version.
  - A flow in `paused` status still blocks, since only step status is looked at. The status relocation (`flow_manager.py:994-1009`) removes completed/failed flows from `active/`, which ends enforcement.
  - Output on the allow path is `{}` and exit 0; any Python crash (bad JSON in `flow.json`) prints a traceback to stderr and exits 0 from the shell wrapper (`:44`), i.e. **fails open**.

## 3. First guess (step 3, not final)
- Verdict: **replace**.
- Why: this is a pure Stop guard on file state. A mod can do the same in `classic.Stop` (return `block` with a reason) and also in the subagent event, build the message in JS (no Python subflow, no shell JSON), and use `$.session.id()` instead of scanning `.session` files. A mod can additionally give the whole rule one place (the CLI's `write-pending` checks and this message could share logic, though the CLI stays Python, see P-items).
- Mod abilities that might apply: `classic.Stop` and `classic.SubagentStop` `{block, reason}`, `stop_hook_active`, `agent_id` / `agentId` on the input, `$.session.id()`, `$.fs` (read `flow.json`), `$.state` / `$.store` (loop counter), `$.agent.list()`.

## 4. Research questions
1. Which `classic.*` events exist for stopping, and does a mod get a distinct event for a subagent's stop (`classic.SubagentStop`)? What input fields does it carry (`session_id`, `agent_id`, `agent_type`, `stop_hook_active`)?
2. What does returning `block` do for a **subagent's** stop (is the subagent told to continue, or the main agent)? Does `stop_hook_active` apply to subagent stops too?
3. Is the session id given to a subagent-stop hook the parent's or the subagent's? (Decides whether the lookup by `.session` still finds the flow.)
4. Can the mod tell "this stop is the step-executor for the approval step" from "this is the main agent" (via `agent_type` / `agent_id`), so the block applies to the right one? Read `agents/step-executor.md` to see which one is meant to write the checkpoint.
5. Is there a result field to put structured text in front of the model (`reason`, `additionalContext`, `stopReason`) and is there a length limit?
6. What happens when the hook throws or times out (fail open or closed)? What is the time limit? Is `.catch(() => ({block}))` a supported way to fail closed?
7. Can a mod and the existing settings hook run side by side during a transition without producing two competing block messages (order, merge)? (See X01.)
8. Can the mod avoid the endless-block case (checkpoint cannot be written) by counting blocks in `$.state` and releasing after N, or by surfacing an `$.ui` toast?

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/events , the `classic.<Event>` section, "Guard or change a tool call", "Handle a hook that fails", and the ordering paragraph for mods vs settings hooks.
   - https://code.claude.com/docs/en/plugins/mods/reference , events table (Stop and SubagentStop rows: input and result shapes), Limits.
   - https://code.claude.com/docs/en/plugins/mods/api , `$.session`, `$.fs`, `$.agent`.
   - https://code.claude.com/docs/en/plugins/mods/admin , what runs when mods are disabled.
2. Search the type file for: `ClassicResult`, `ClassicResultOf`, `SubagentStop`, `StopInput`, `stop_hook_active`, `agent_id`, `agent_type`, `last_assistant_message`, `stopReason`, `preventContinuation`.
3. Read these repo files: `scripts/check-approval-stop.sh`, `scripts/build_approval_block_message.py`, `hooks/hooks.json` (Stop and SubagentStop blocks), `scripts/flow_manager.py` `cmd_write_pending` (`:1193`), `agents/step-executor.md`, `skills/flow-state-update/SKILL.md` (who writes pending), `docs/claude/claude-code-hooks-reference.md` (Stop/SubagentStop, lines ~530-570). Also look at `../ZeremAI-marketplace/views/` to see what a `view` with `operationIds` / `mockData` looks like.
4. Compare: settings hook (stdout `{"decision":"block"}` + exit 0, no time limit set in `hooks.json`, runs in a shell subflow, fails open on Python error) versus mod (`block` result, hook time limit, `.catch` fail-closed, ordering with other Stop handlers). Check that every branch of the Python (plain message, view message, `in-progress` spelling) can be reproduced in JS.
5. Write the answer under "7. Research result". Related: see H01, H03, C01, X01.

## 6. Out of scope
No implementation. No plugin edits. No building a mod. (Only items S01–S03 may build a throwaway mod outside this repo.) Do not run or change the plugin's scripts.

## 7. Research result
_(empty until the research is done; fill each heading below.)_

### Claude Code version
_(output of `claude --version`)_

### Answers per question
_(one answer per question in section 4, each with evidence: doc page + section, type-file name, or repo file:line)_

### Final verdict
**improve / partial replace.** Implemented 2026-10-09 on `feat/h01-stop-guard-mod`: the rule is one more branch in `hooks/on-agent-stopping/on-agent-stopping.ts` (`approvalPrompt`, placed before the pending-step rule; a live step-executor gets the wait text). Owner answers: rule stays in `auto-advance.ts`; text points to the `flow-state-update` skill instead of printing the script path; the `SubagentStop` guard is dropped (the parent writes the checkpoint); an open Q&A session gets no extra text, only a TODO for a configurable retry count once the mod has a settings UI. Scripts `check-approval-stop.sh`, `build_approval_block_message.py` and both hook entries deleted. 16 tests pass. Same limits as H01: re-prompt, not a stop veto; no guard when mods are off.

### Evidence
### Open questions
### Risks
### What a later plan must decide

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "H02"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
