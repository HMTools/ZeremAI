# H01 · block-stop-pending-steps (auto-advance)

> Status and result live in `../progress.html` (entry `H01`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` (v2.0.28) is a Claude Code plugin that runs structured, resumable workflows ("flows") with steps, approval gates and Q&A. Flow state lives in JSON files under `~/.claude/zeremai/active/<flow>/` (`flow.json`, `log.json`, `pending-interaction.json`, `.session`). The plugin enforces its rules with shell hook scripts wired in `hooks/hooks.json`. Each script receives the hook JSON on stdin and answers with `{"decision":"block","reason":...}` on stdout or exit code 2 on stderr. This item is one of those enforcement pieces. The goal of the whole pack is to find out whether a Claude Code **mod** (JS/TS code running inside Claude Code, see the mods overview) can replace or improve it. The owner's bar: "a mod can do it".

## 2. What exists today
- Script: `scripts/block-stop-pending-steps.sh` (99 lines). Wired in `hooks/hooks.json` under `Stop`, third hook in the single matcher-less group (after `check-approval-stop.sh` and `enforce-log-on-stop.sh`). It is **not** on `SubagentStop` (header comment lines 1-4, so that step-executor subagents can return).
- Input parsing: line 10 calls `scripts/parse_hook_input.py session_id` (see C01). Empty session id: exit 0, allow (`:13-15`).
- Flow lookup (`:17-26`): loops `~/.claude/zeremai/active/*/.session` and compares the file content to the hook's session id. No match or no `flow.json`: allow.
- Allow conditions, in order: `pending-interaction.json` exists in the flow dir (`:33-35`, the agent is at an approval checkpoint); flow is not running, tested with `grep -qE '"status"\s*:\s*"running"'` on the whole `flow.json` (`:38-40`).
- Block 1 (`:43-64`): if `grep` finds any `"status": "pending"` anywhere in `flow.json`, a small inline Python finds the first step with status `pending` and the script prints `{"decision":"block","reason":...}` telling the main agent the next step number/name/id and to "delegate the next step to the step-executor subagent". Exit 0. The reason text is hand-spliced into a bash heredoc (step names with quotes or `\` would produce broken JSON).
- Block 2 (`:66-97`): no pending step, but a step with status `in_progress` and `startedAt` older than 600 s (hard-coded `:80`) is treated as an orphan from a crashed step-executor; blocks with a "re-delegate or mark failed" message. `startedAt` is set once by `flow_manager.py` `cmd_update_step_status` (`:485-486`).
- Final fallback: exit 0 (allow).
- State read: `active/*/.session`, `flow.json` (`status`, `steps[].status`, `steps[].startedAt`, `number`, `id`, `name`), `pending-interaction.json` (existence only). Writes nothing.
- Weaknesses seen:
  - Does **not** check `stop_hook_active` (compare H03, which does). If the agent cannot or will not continue, it is blocked forever; the only exits are completing steps or writing `pending-interaction.json`.
  - Whole-file `grep` for `"status": "running"` / `"pending"` matches any nested object (a step, a substep, a log text), not just the flow or step status. The regex tolerates whitespace around the colon, but a status-like text inside any string value would false-match.
  - The 10-minute timer is a wall-clock guess. A legitimately long step-executor run (over 10 min) causes a false block; a crash within the first 10 min is not detected until the main agent tries to stop after that.
  - Flow folder moves out of `active/` when status becomes `completed` or `failed` (`flow_manager.py:994-1009`), after which the lookup fails and the hook allows stop. `paused` stays in `active/` but status is not `running`, so stop is allowed.
  - Fails open on any parse error (python errors are swallowed with `2>/dev/null`, `:52`, `:83`), which leaves an empty message in the block reason.
  - Session binding relies on `.session` being written by `bind-session-to-flow.sh` (PostToolUse hook, see H-group) after the agent does `Write(.session, "")` (`skills/flow-new/SKILL.md:81`, `skills/flow-continue/SKILL.md:39`). A flow that was never bound is never enforced.
- Related: H02 (`check-approval-stop`) and H03 (`enforce-log-on-stop`) run in the same Stop group; all three can block, and the model sees the combined reasons (verify how Claude Code merges them, see question 6).

## 3. First guess (step 3, not final)
- Verdict: **replace**.
- Why: a mod's `classic.Stop` hook can return `block` and its input carries `stop_hook_active` (README "Findings so far"). Inside a mod the session id, flow lookup and state read are normal JS (no `eval`, no `grep` on JSON, no JSON-by-heredoc). `$.agent.list()` returns agent status (running, failed, killed) and can replace the 10-minute `startedAt` timer with a real signal.
- Mod abilities that might apply: `classic.Stop` `{block, reason}`, `stop_hook_active` on the input, `$.session.id()`, `$.fs` (read `flow.json`), `$.agent.list()`, `$.store` / `$.state` (cache the flow path for the session), `$.clock`.

## 4. Research questions
1. Does the `classic.Stop` input type carry `stop_hook_active`, `session_id` and (for a subagent) `agent_id`? What exactly does returning `block` with a `reason` do for the main agent's stop?
2. How does a mod tell a **main-agent** stop from a **subagent** stop? Is there a separate `classic.SubagentStop` event, and does `classic.Stop` fire for subagents? (Needed to keep the "Stop only, not SubagentStop" rule.)
3. What does `$.agent.list()` return (fields, status values, scope, does it include the finished or crashed step-executor)? Can it reliably say "the subagent for step X is dead" so the 600 s timer can be dropped?
4. Can a mod hold the `session id -> flow dir` mapping itself (`$.store` or `$.state`) instead of scanning `.session` files? What survives `/clear`, `/resume`, restart? (Linked to C01.)
5. What is the time limit for a Stop hook and what happens on throw or timeout (fail open or fail closed, `.catch` guard)? Can reading `flow.json` through `$.fs` stay well inside it?
6. When both settings hooks and mods are registered for the same Stop, what is the run order, and are multiple blocks merged or does the first win? (Matters for the mixed period where H02/H03 may still be shell scripts.)
7. Can the mod re-prompt (`block` reason) with the same text as today, and is there a way to return structured context (`additionalContext`, `stopReason`) instead of a shell-built JSON string?
8. If mods are off (`allowManagedModsOnly`, `--safe-mode`), the rule silently disappears. Can the settings-hook version stay as fallback in the same plugin without double blocking? (Link to X01.)

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - Events: https://code.claude.com/docs/en/plugins/mods/events , sections "Guard or change a tool call" (for the pattern), the `classic.<Event>` section, "Handle a hook that fails" (fail-open vs `.catch` fail-closed), and the part about order of mods and settings hooks.
   - Reference: https://code.claude.com/docs/en/plugins/mods/reference , "events" table (Stop, SubagentStop rows), Limits (hook time limit).
   - API: https://code.claude.com/docs/en/plugins/mods/api , `$.agent`, `$.fs`, `$.session`, `$.store`.
   - Interface: https://code.claude.com/docs/en/plugins/mods/interface , "$.state vs $.store vs module variables" and state after `/clear`, `/resume`.
   - Admin: https://code.claude.com/docs/en/plugins/mods/admin (what happens when mods are off).
2. Search the type file (`claude-code.d.ts`, get it via the `plugin-authoring` skill; never read it whole) for: `ClassicResult`, `ClassicResultFields`, `ClassicResultOf`, `stop_hook_active`, `StopInput`, `SubagentStop`, `preventContinuation`, `stopReason`, `additionalContext`, `AgentInfo`, `agent.list`, `AgentStatus`.
3. Read these repo files: `scripts/block-stop-pending-steps.sh`, `hooks/hooks.json`, `scripts/parse_hook_input.py`, `scripts/flow_manager.py` (`cmd_update_step_status` ~`:455`, status relocation `:994`), `skills/flow-continue/SKILL.md` (how `.session` is bound), `docs/claude/claude-code-hooks-reference.md` (Stop / SubagentStop sections, lines ~530-570).
4. Compare: settings Stop hook (stdout JSON `decision: block`, exit 0, loop guard `stop_hook_active`, no time limit configured in `hooks/hooks.json`) versus mod `classic.Stop` (`block` result, hook time limit, `.catch` behaviour, ordering). Also compare "no loop guard here" with what a mod would need (a mod should probably bound re-blocks, for example with a counter in `$.state`).
5. Write the answer under "7. Research result".

## 6. Out of scope
No implementation. No plugin edits. No building a mod. (Only items S01–S03 may build a throwaway mod outside this repo.) Do not run or change the plugin's scripts.

## 7. Research result

Owner answers from the plan page (2026-10-09), applied below: (a) drop the shell script, no fallback when mods are off; (b) keep a time rule for a crashed step if agent status fails; (c) **no loop guard**: block while any step is `pending` or `in_progress`, ignore `stop_hook_active`.

### Claude Code version
`2.1.295 (Claude Code)`. Type file written by the `plugin-authoring` skill for this build (`claude-code.d.ts`, 21,451 lines). The mods reference page says "as of v2.1.290".

### Answers per question

1. **Input and effect of `block`.** `classic.Stop` is a settings-hook event named `classic.<Event>`; `e` is the same JSON a settings hook gets on stdin (events page, "Handle the settings hook events"). `StopHookInput` = `BaseHookInput` (`session_id`, `transcript_path`, `cwd`, optional `agent_id`/`agent_type`) + `stop_hook_active: boolean` + `last_assistant_message?` (type file `StopHookInput`, ~line 12115). The result is `Pick<ClassicResult, 'block' | 'preventContinuation' | 'stopReason' | 'additionalContext'>` (`ClassicResultOf`, `ClassicResultFields.Stop`). `block?: string` is documented as "`decision: "block"` with this text as `reason`: the event's block, veto or re-prompt". So `return { block: '...' }` equals today's JSON `{"decision":"block","reason":...}`. `preventContinuation: true` ends the session; do **not** use it.
2. **Main agent vs subagent.** Two separate events: `classic.Stop` (main agent finishes) and `classic.SubagentStop` (subagent finishes, input has `agent_id`, `agent_type`, `agent_transcript_path`). Repo copy of the hooks reference says Stop "Fires when the main Claude Code agent finishes responding" (`docs/claude/claude-code-hooks-reference.md` ~540-555). A mod that hooks only `classic.Stop` keeps today's "Stop only, not SubagentStop" rule. Extra safety: skip when `e.agent_id` is set (`BaseHookInput.agent_id`: "Absent for the main thread"). **Not run:** that `classic.Stop` never fires for a subagent is from docs, not a live test (S03).
3. **`$.agent.list()`.** Returns `AgentInfo[]`: `id`, `description`, `type`, `status`, `parentId?`, `spawnedBy?`, `name?`, `teammateId?`. `status` is `pending | running | waiting | idle | completed | failed | killed` (`AgentStatus`; `idle`/`waiting` need v2.1.289+). Scope: the session's subagents and teammates; an entry is dropped "as a teammate ends or seconds after, a subagent's later" (doc on `agent.list`). Consequences: (a) at Stop time, a step still `in_progress` with **no** live step-executor in the list (none `running`/`pending`/`waiting` of type `zeremai:step-executor`) is an orphan right now, so the 600 s timer is not needed for the common case; (b) the list has **no step id**: link agent to step only via `description` (the text the Agent call was given), so the mod must not rely on matching one agent to one step; (c) after `/resume` or restart the list is empty, so an `in_progress` step is correctly an orphan. Gap: a crashed agent is visible as `failed`/`killed` only for a few seconds. Owner choice (b): keep a timer only as a fallback if the live check proves unreliable in S03.
4. **Session to flow mapping.** `$.store` is "a key-value store that every session on the machine shares", saved as JSON under `~/.claude/plugins/store/`, 4 MiB total, survives restart (reference, interface page "Keep state"). `$.state` lasts to session end and is **reset by `/clear`, `/resume`, `/branch`** (interface page). Module variables are lost on every reload. `e.session_id` is on every classic input; `$.session.id()` also exists. Recommendation: do **not** cache the mapping. Read `~/.claude/zeremai/active/*/.session` through `$.fs.list` / `$.fs.read` each Stop (a handful of small files, far inside the 10 s limit). The `.session` file stays the contract with the UI app and with H08. Replacing the file with `$.store` belongs to C01/H08, not here.
5. **Time limit and failure.** A hook's own execution time is **10 s**; time inside `next` or a mods API call (`$.fs.*`) does not count; a `.catch` handler gets **1 s** (reference "Limits"). A hook that throws or times out **before** calling `next` is skipped and the next handler runs, so it **fails open**; one line names mod, event and reason (events page "Handle a hook that fails"). `.catch(handler)` can answer instead, with `next.called` and `next.error.kind` (`throw`/`timeout`). With owner choice (c), fail-open is the safe side: a fail-closed `.catch` that blocks would turn a bug into a permanent block. Reading `flow.json` (small file, 4 MiB `$.fs.read` cap) is well inside the limit.
6. **Order with settings hooks.** Chain for `classic.<Event>` = `[managed settings hooks, ...hooks modules, the other settings hooks as core]` (`ClassicEventOf` doc, type file ~1239). So the plugin's `hooks/hooks.json` Stop scripts (H02, H03) are **inside** the mod's `next`. Settings hooks "fold into one result (last write wins, contexts concatenate)" (`ClassicResult` doc). Two consequences. (a) A mod that answers **without** calling `next` stops H02 and H03 from running at all. The mod must `const r = await next(e)` first, and return `r` untouched when `r.block` is set. (b) Block reasons from several hooks are not joined by the engine ("last write wins" for `block`); the mod can append its own text to `r.block` if it wants both shown. **Not verified:** how Claude Code merges several settings-hook blocks today (the three scripts in one group), and whether the model sees all of them. Needs S03.
7. **Same text, structured context.** Yes. `block` takes any string, so the existing message becomes a JS template: no heredoc, no hand-spliced JSON, quotes or `\` in a step name are safe. `additionalContext: string[]` is also allowed for `Stop` (`ClassicResultFields.Stop`) for text that is not the re-prompt itself. `stopReason` only pairs with `preventContinuation`.
8. **Mods off.** Under `allowManagedModsOnly`, a plugin from a normal marketplace counts as a user's mod and is refused; settings hooks keep running (admin page). `--safe-mode` turns all installed mods off. `disableAllHooks` in managed settings stops mods **and** settings hooks. A plugin can ship both: `hooks/hooks.json` holds `modules` and may also hold settings `hooks` (reference "Files"). Owner choice (a): ship **no** script, so with mods off there is no guard and a flow can stop with steps left. That is a real regression versus today, where the script runs whenever hooks run. If the owner changes this later, both can coexist; a double block is harmless (one block already wins) but gives two copies of the rule. See X01.

### Live test result (2026-10-09, Claude Code 2.1.295) — changes the verdict
A throwaway copy of the plugin (renamed `h01-live`, mod with a log) was run with `claude -p --plugin-dir`, a fake flow folder bound to a known session id, and `--setting-sources local`. The mod loaded (`hooks module h01-live@inline loaded (worker, environment 2, tier user); events: classic.Stop`) and passed `claude plugin validate` and 9 unit tests. At the first Stop the debug log says:

`h01-live: classic.Stop bypassed by cc-plugin-sec-default (tier user); beneath runs`

The built-in guard `sec-default@builtin` registers `on('classic.*', ($, e, next) => next.to(e, 'append'))` (source: `mods/sec-default/hooks/register.ts` in the Claude Code repo), so **every `classic.<Event>` hook of a user-installed mod is skipped**; only the settings hooks beneath (the shell scripts, which did run and block) and org-tier mods (`prependPlugins`/`appendPlugins`) act. The guard loads on a machine with managed settings or for a user signed in on a Team or Enterprise plan (admin page, "Know what happens by default"), which is the case on this machine. The mod's own log file stayed empty. The docs say this only as "a user's mod can't change what your managed hooks receive or decide"; the events page does not say that `classic.*` is skipped.

Effect on the answers above: Q1, Q2, Q5, Q6, Q7 are true for the API, but **not reachable for a user-tier mod where the guard loads**. Questions 3 and the four open questions could not be tested live, because the hook never ran. The shell script kept working in the same run.

### Implemented (2026-10-09, branch `feat/h01-stop-guard-mod`, not committed)
Owner chose a native-event route. `hooks/on-agent-stopping/on-agent-stopping.ts` hooks `turn.complete` (not skipped by the guard) and, when the session's flow has a `pending` or `in_progress` step, calls `$.prompt.submit` with the old block text. It skips subagent turns and interrupted or failed turns. Cap: at most 3 re-prompts in a row for the same step state, reset by a user prompt (module variable). Tests: 11 pass (`claude plugin test .`). Live test (`claude -p --plugin-dir`, fake flow, `--max-budget-usd 0.4`): 1 turn + 3 re-prompts, then it stopped by itself (about $0.20). Without the cap an earlier run kept going for 13 turns (about $0.25) until killed. `scripts/block-stop-pending-steps.sh` and its `hooks.json` entry are removed. A TODO in `auto-advance.ts` says to switch to `classic.Stop` `{ block }` once the plugin is on the organization's mods whitelist.

Differences from the script: it is a new turn, not a veto of the stop; a turn the user interrupts is not re-prompted; with mods off nothing guards; each re-prompt costs a model turn.

### Final verdict
**improve / partial replace** (live test first showed `keep`; the `turn.complete` route then worked). A true stop veto still needs an organization mod. A mod can replace the script only (a) where the guard does not load (a personal API-key machine with no managed settings), or (b) as an organization mod: the plugin installed from a directory marketplace by absolute path, enabled in managed `enabledPlugins`, and listed in `appendPlugins` or `prependPlugins` (admin page, "Install your organization's mods"). Neither is how this plugin is distributed today (git marketplace, user scope). Not tested: that an org-tier mod's `classic.Stop` runs.

Shape of the mod (a draft exists in `hooks/stop-guard.ts`, untracked and not wired in `hooks.json`; 9 unit tests pass with stubs, which sit beneath the guard):
```ts
on('classic.Stop', async ($, e, next) => {
  const r = await next(e)                       // let H02/H03 run first
  if (r.block || e.agent_id) return r
  const p = await findFlowBySession($, e.session_id)   // $.fs over active/*/.session
  if (!p || p.hasPendingInteraction || p.status !== 'running') return r
  const step = p.steps.find(s => s.status === 'pending' || s.status === 'in_progress')
  if (!step) return r
  return { ...r, block: reasonFor(step, p.dir) } // reasonFor lists: continue, mark failed, or write-pending
})
```
Decision (c) means no `stop_hook_active` test. The block reason must name the two exits (mark the step failed, or write `pending-interaction.json`).

### Evidence
- Events page: https://code.claude.com/docs/en/plugins/mods/events , "Handle the settings hook events", "The order mods run in", "Handle a hook that fails".
- Reference: https://code.claude.com/docs/en/plugins/mods/reference , "Mods API methods" (`$.agent`), "Limits".
- API page: "Reach files, flows, and the network". Interface page: "Keep state". Admin page: "Choose how much to allow", "Know what happens by default".
- Type file `claude-code.d.ts`: `ClassicResult`, `ClassicResultFields`, `ClassicResultOf`, `ClassicEventOf`, `StopHookInput`, `SubagentStopHookInput`, `BaseHookInput`, `AgentInfo`, `AgentStatus`, `agent.list`.
- Repo: `scripts/block-stop-pending-steps.sh:13-15,17-26,33-35,38-40,43-64,66-97`; `hooks/hooks.json:3-22` (Stop group of 3, no SubagentStop entry for this script); `scripts/flow_manager.py:485-486` (`startedAt` set once), `:994-1009` (folder moves out of `active/`); `skills/flow-continue/SKILL.md:30-39` (`.session` binding); `docs/claude/claude-code-hooks-reference.md` ~540-570.

### Open questions
0. **New:** does an org-tier mod (`appendPlugins`, managed directory marketplace) get its `classic.Stop` through the guard? Needs a managed-settings test machine.
1. Does `classic.Stop` really not fire for subagents, and does `e.agent_id` stay unset on the main stop? (S03)
2. How does Claude Code merge several blocks from the three settings Stop hooks, and does the model see all reasons? Does it cap repeated re-blocks? The hooks reference says "Check `stop_hook_active` to avoid infinite loops"; with no guard, a stuck step could loop forever. (S03)
3. Does `$.agent.list()` still hold the step-executor entry (as `failed`/`killed`) at the moment the main agent's Stop fires after a crash? Is `type` exactly `zeremai:step-executor`? (S03)
4. Does `description` of the Agent call carry the step id (needed only if the mod must match agent to step)? Check `skills/step-executor-delegation`.
5. Background (not foreground) step-executors: should a live agent make the mod allow the stop or block it? Today's script blocks.

### Risks
- **A user-tier mod's `classic.Stop` is skipped by the built-in guard** on machines with managed settings or a Team/Enterprise sign-in. Removing the script then removes the guard completely. Do not delete `scripts/block-stop-pending-steps.sh` on the strength of this research.
- **No guard when mods are off** (owner choice a): `--safe-mode`, an org policy, or a crashed hooks worker (three crashes unload all mods until `/reload-plugins`, admin page) leave a flow free to stop early. Today's script does not have this gap.
- **No loop guard** (owner choice c): a step the agent cannot finish traps the agent. Mitigated only by the block text naming the two exits. If Claude Code has its own re-block cap, behaviour is unknown until S03.
- Mod answering without `next` silently disables H02 and H03 during the mixed period.
- Mods are early access; the API and type file move between releases (`2.1.295` here).
- Session binding is unchanged: a flow never bound to a session is never enforced (H08/C01).

### What a later plan must decide
- Order of migration: H01 together with H02/H03 (same Stop chain), or H01 alone with `await next(e)` passthrough.
- Whether to keep the 600 s timer as a fallback after S03, or drop it for the live-agent check.
- Whether to keep the `.session` file scan or move the mapping to `$.store` (C01/H08), given the UI app reads the files.
- Whether to accept "no guard when mods are off" or ship a settings-hook fallback (X01).
- Whether to add a re-block cap, if S03 shows the engine has none.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "H01"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
