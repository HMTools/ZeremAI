# S03 · Spike: block a stop

> Status and result live in `../progress.html` (entry `S03`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.
> This is a SPIKE: the only kind of item that may build something, and only outside this repo.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") with steps. Three `Stop` shell scripts keep the main agent from stopping too early: stop only at an approval checkpoint or at the end, log the user's interaction before stopping, and keep advancing through pending steps. One script is also on `SubagentStop`. This spike tests whether a mod's `classic.Stop` hook can do the same, and whether it can use real agent status instead of a 10-minute guess.

## 2. What exists today
- `hooks/hooks.json`: `Stop` runs, in order, `check-approval-stop.sh`, `enforce-log-on-stop.sh`, `block-stop-pending-steps.sh`. `SubagentStop` runs only `check-approval-stop.sh`.
- `scripts/check-approval-stop.sh` (44 lines): finds the flow by the `.session` scan (lines 21-27); if `pending-interaction.json` exists, allow (`{}`); else runs `build_approval_block_message.py`, which prints a block when a single step is `in_progress` with `approvalRequired: true` and no pending file. Used for both Stop and SubagentStop.
- `scripts/enforce-log-on-stop.sh` (47 lines): reads `stop_hook_active`; when `true` allow (loop guard, lines 17-19). Otherwise if `flags/pending-log-<session>` exists, prints `{"decision":"block","reason":"User interaction not yet logged ..."}` with the `log-interaction` command. Stop only.
- `scripts/block-stop-pending-steps.sh` (99 lines): allow if no flow, if `pending-interaction.json` exists, or if `flow.json` status is not `running`. If any step is `pending`, block with the next step id and the instruction to delegate to `step-executor` (lines 43-64). If none pending, but a step is `in_progress` with `startedAt` older than 600 s (lines 66-97), block with "likely crashed or was lost". It does NOT read `stop_hook_active`, so it can block repeatedly; the loop ends because the step state changes. A subagent that is still running for under 10 minutes is not detected.
- All three print `{"decision":"block","reason":...}` and exit 0; the reason reaches Claude as the next instruction.
- State: `flow.json` (steps, status, `startedAt`), `pending-interaction.json`, `flags/pending-log-<session>`, `.session`.
- Weaknesses: the 10-minute timer is a guess; a long step is falsely blocked and a lost step is noticed late; `.session` scan again.

## 3. First guess (step 3, not final)
- Verdict: replace or improve.
- Why: `classic.Stop` can return `block` and has `stop_hook_active`; `$.agent.list()` gives status (running, failed, killed) and can replace the timer.
- Abilities: `classic.Stop`, `classic.SubagentStop`, `$.agent.list()`, `$.fs`, `$.store`.

## 4. Research questions
1. Does `classic.Stop` returning `{ decision: 'block', reason }` (or the field name in `ClassicResult` for Stop: `block`, `preventContinuation`, `stopReason`, `additionalContext`; confirm the exact keys) stop Claude from finishing and re-prompt it, the way the shell Stop scripts do? Does the turn continue automatically with the reason as the next instruction, and does the user see anything in the transcript?
2. Is `stop_hook_active` present in the `classic.Stop` input, and is it `true` on the second Stop after a block (the loop guard that `enforce-log-on-stop.sh` uses)? How many consecutive blocks are possible, and is there a hard cap?
3. Does `classic.SubagentStop` exist and carry what `check-approval-stop.sh` needs (session id, agent id)? Can it block a subagent from finishing? Does the block text reach the subagent or the parent?
4. Does `$.agent.list()` exist in this build? What fields does it return (id, type, status values, start time)? Can it tell whether the `step-executor` subagent for the step in `flow.json` is still running, finished, failed or killed? How is an agent matched to a step (by prompt, by name, by the step id in the task description)? Can it replace the 10-minute `startedAt` rule in `block-stop-pending-steps.sh`?
5. How does the block reason text reach Claude: verbatim, prefixed, truncated? Do `\n` in a long multi-line reason render properly? Is there a size limit?
6. Same-time behaviour: if the plugin ships both settings `Stop` hooks (`hooks/hooks.json`) and a mod with `classic.Stop`, which runs first, do both run, and what happens when both block (one combined reason or two)? Do settings hooks of the same plugin run when the mod returns `block` without calling `next`? (`classic.*` docs: "Pass the event on, so Stop hooks in your settings files still run": a mod that does not call `next` presumably skips them. Confirm.)
7. Time limit: the three scripts call `python3` several times. What is the per-hook time limit for a mod and for a settings hook (docs `reference`, Limits: 10 s per hook)? Does a hook that exceeds it fail open (Stop is allowed), and does `.catch` change that for `classic.Stop`?
8. Does a mod hook run on `claude -p` and Agent SDK runs? (Docs: hooks run, drawing does not.) Does `block` work there?
9. User interrupt (Esc) or `/exit`: does `Stop` fire, and does a block make the session hard to leave? Is there a way for the user to override?
10. Can the mod keep the `flags/pending-log-<session>` logic in `$.state` or `$.store` instead of a flag file (set on `prompt.submit`, cleared when the log call is seen in `tool.call`)? (Only record the observation; the real design is for items `H` and `C01`.)

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`): `events` ("Handle the settings hook events", "Run alongside other mods", "Handle a hook that fails"), `reference` (`classic.*`, Limits, agent methods), `api` (`$.agent`, `$.fs`). Also `../../docs/claude/claude-code-hooks-reference.md` (Stop, SubagentStop, `stop_hook_active`). Note `claude --version`.
2. Search the type file for: `ClassicResult`, `ClassicResultFields`, `ClassicResultOf`, `Stop`, `stop_hook_active`, `SubagentStop`, `agent.list`, `AgentInfo`, `preventContinuation`.
3. Read these repo files: `hooks/hooks.json`, `scripts/check-approval-stop.sh`, `scripts/enforce-log-on-stop.sh`, `scripts/block-stop-pending-steps.sh`, `scripts/build_approval_block_message.py`, `agents/step-executor.md`, `skills/step-executor-delegation/SKILL.md`.
4. Build a throwaway mod OUTSIDE this repo with the `plugin-authoring` skill, folder `~/.claude/dev-mods/<session-id>/stop-spike/`. Design in words:
   - `plugin.json`; `hooks/hooks.json` with `modules: ["./register.ts"]`; `hooks/register.ts`.
   - Events: `classic.Stop` and `classic.SubagentStop`.
   - Logic: on `classic.Stop`, read a fake `flow.json` from a temp folder (`$.fs`) pointed to by an env var. If it has a `pending` step, return a block with a short reason that names the step. Log `stop_hook_active`, the count of blocks, and the output of `$.agent.list()` (as JSON) to a temp log. If a fake step is `in_progress` and `$.agent.list()` shows no running agent, block with a different reason ("agent gone"); if an agent is running, allow the stop. A flag file switches the hook to a "never block" mode so you can exit.
   - A second variant (or flag) returns the block without calling `next`, and a third calls `next` first and combines results, to answer question 6.
   - Do not write the full implementation.
5. Fixture: fake flow dir `$TMPDIR/s03/proc/flow.json` with three steps: `completed`, `pending`, `pending`. Never use the real `~/.claude/zeremai`.
6. Validate with `claude plugin validate <mod>`; run `claude --plugin-dir <mod> --debug-file <tmp>/s03.log`.

### Test procedure
| # | Do | Pass | Fail |
|---|---|---|---|
| T1 | Ask Claude a trivial question while the fake flow has a pending step | Claude is re-prompted with the block reason after its first answer and acts on it (for example says it will do the next step) | Claude stops normally |
| T2 | Watch the log during T1 | `stop_hook_active` false on first Stop, true on the second | Field missing or always false |
| T3 | Keep blocking on every Stop for 5 turns (ignore the loop guard) | Observe cap or endless loop; record; then set the never-block flag | n/a (record) |
| T4 | Start a subagent via Task (a slow one, for example "wait 20 s with sleep") and stop while it is running; log `$.agent.list()` during the wait | List shows status `running` with an id; after it finishes shows finished; for a killed one shows killed | List missing or empty |
| T5 | Make a fake step `in_progress` with an old `startedAt`, no agent running | Mod blocks with "agent gone" immediately (no 10-minute wait); with an agent running it allows | Cannot tell the two |
| T6 | Add a settings `Stop` hook in the spike plugin that appends to a marker file; run with the mod blocking, then allowing | Observe which run, order, combined reason | Record |
| T7 | Make the mod throw (flag), with and without `.catch` | Record fail open or closed | n/a |
| T8 | Put a multi-line reason with `\n` and a 3 KB text | Record how Claude sees it | n/a |
| T9 | Run `claude -p "hi" --plugin-dir <mod>` | Record whether block works | n/a |
| T10 | Press Esc during a turn and `/exit` | Record whether Stop fires | n/a |

## 6. Out of scope
No changes to this repo. No real flow state. The spike must be easy to disable (never-block flag) so it cannot trap the session. Do not install it permanently.

## 7. Research result

Closed from the built mod and its tests, at the owner's request after the plan page "Spikes and Policy: Last Mod Items" (decisions kept as proposed). No throwaway mod was run.

### Claude Code version
2.1.296

### What the built mod proves
- A turn end with work left starts a new turn with a prompt: pending step, lost step, approval, log owed (`on-agent-stopping.ts`, 20 tests).
- At most 3 re-prompts in a row, and a user prompt resets the count. A user interrupt and a subagent turn are never re-prompted.
- A running step waits for its agent, found by `$.agent.list()` (P06), not a 10-minute timer.
- `classic.Stop` is skipped for a user-tier mod by the built-in guard (`on-agent-stopping.ts:14-18`). The re-prompt through `turn.complete` is the workaround.

### Not proven live
Questions 7 to 9: behaviour in `claude -p`, and an Esc or `/exit` with a re-prompt pending (the mod ignores an interrupt).

### Final verdict
**improve** (re-prompt now; a real stop veto only for an organization's mod).

### Risks
A re-prompt is an extra turn, not a veto. The model can stop after 3.

### What a later plan must decide
Move to `classic.Stop` `{ block }` if the plugin is installed as the organization's mod (X01).

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "S03"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
