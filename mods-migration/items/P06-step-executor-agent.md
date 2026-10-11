# P06 · Step executor agent and delegation

> Status and result live in `../progress.html` (entry `P06`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` is a Claude Code plugin that runs resumable workflows ("flows") made of steps. To keep the main conversation clean, each step is executed by a separate subagent with isolated context: the `step-executor` agent. The main model does not call the agent directly; it invokes a skill, `step-executor-delegation`, that forks into that agent. A second agent, `flow-spawner`, creates child flows. Callers: the `flow-new` and `flow-continue` skills (P04). Hooks interact with this: the Stop hook must let subagents return, and the approval hook runs on `SubagentStop` too. Related: P04, P03, P05, H-series for Stop hooks.

## 2. What exists today
Files:
- `agents/step-executor.md` (135 lines). Frontmatter (1-7): `model: inherit`, `readonly: false`, `is_background: false`. Sections: "Your Role" 11; "When Invoked" 15 (receives only flow dir and step id); "Corrections Mode" 29; "Pre-Step Initialization" 36-88 (load operating principles from `~/.claude/zeremai/config/operating-principles.json`, print them, call `update-current-state --total-substeps`, end-step verification); "Execution Protocol" 89-122 (sub-flow orchestrator guard, embedded `stepDefinition` is the sole source of guidance, report each substep with `update-active-substep`, never Write/Edit state files, handle approval by returning deliverables); "Output Format" 129.
- `skills/step-executor-delegation/SKILL.md` (31 lines). Frontmatter: `context: fork`, `agent: zeremai:step-executor`, `arguments: [flow-dir, step-id, corrections]`, `user-invocable: false`. Body: read `flow.json`, find the step, use ONLY its `stepDefinition`, read only the memory topics in `memoryFileUsage.readFrom`, execute substeps, update state through the `flow-state-update` skill. Refuses empty `stepDefinition` (orchestrator steps). Last section passes user corrections for re-execution.
- `agents/flow-spawner.md` (64 lines): validate template, create the flow folder, use `flow-new` skill for state files, for sub-flows pass `--parent-*` and call `register-child-flow`. By reading, `flow-new` and `flow-continue` do the spawning themselves (Sub-Flow Step Handling in both SKILL.md files), and the skills' "Subagent Delegation" section lists flow-spawner as an option; whether anything actually calls it was not verified.
- Hooks involved: `hooks/hooks.json` (Stop: `check-approval-stop.sh`, `enforce-log-on-stop.sh`, `block-stop-pending-steps.sh`; SubagentStop: `check-approval-stop.sh` only; the comment at `block-stop-pending-steps.sh:4` says it is Stop-only "so step-executor subagents can return"); `scripts/block-todo-tools.sh` (blocks `Task|TaskCreate|...` while a flow runs, so the model cannot spawn subagents with the Task tool at all, which is why delegation goes through the skill; note the tool may now be named differently, verify); `scripts/block-stop-pending-steps.sh:65-95` (10-minute timer on `in_progress` steps to guess a crashed subagent).
- `AGENTS.md` in the repo root lists both agents.

Behaviour in plain words:
- The parent marks the step `in_progress`, then invokes the delegation skill with `<flow-dir> <step-id> [corrections]`. The fork starts the step-executor with a fixed prompt. The agent reads everything it needs from files (flow.json, memory topics, operating principles) and writes state only through `flow_manager.py` (via the `flow-state-update` skill). At the end it returns a text summary to the parent.
- Context isolation is the main purpose: the deliverable work does not pollute the main conversation.
- Approval: the agent never approves; it returns deliverables and the parent creates the pending file (P02) and waits for the user (P03).
- Known weaknesses: the agent re-reads `flow.json` every time; hooks inside the subagent see the SAME `session_id` as the parent (by reading; verify), so the `.session` lookup cannot tell parent and subagent apart; crash detection is a 10-minute timer; the principles printing step (`✓ Operating principles loaded`) is prose that costs tokens each step; the delegation skill text and the agent file duplicate most instructions.

## 3. First guess (step 3, not final)
- Verdict: keep.
- Why: subagent execution with isolated context is already native to Claude Code; mods have no obvious replacement for "run a step in a subagent". A mod might improve around the edges only.
- Mod abilities that might apply (to check, not assume):
  - `$.agent.register` / `agent.offer`: register or withhold the `step-executor` agent type from a mod (for example only offer it when a flow is bound).
  - `agent.spawn` hook: `next({ ...e, model })` to pick the step's model per step (a step definition could carry a model), or `{ deny: reason }` for spawns that break rules.
  - `$.agent.spawn` + `$.agent.list()`: a mod could start the step-executor itself and read its `status` (`running`, `failed`, `killed`, `completed`, ...), replacing the 10-minute crash timer in `block-stop-pending-steps.sh`.
  - `tool.call` / `tool.check` fields `agentId`: tell subagent tool calls from main-conversation calls (replaces the shared-session-id ambiguity).
  - `prompt.section` / `skill.prompt`: inject the operating principles instead of the agent printing them.
  - `$.session.send({ to: { agentId } })`: send corrections to a running subagent instead of re-invoking.
  - `classic.SubagentStop` (as `classic.<Event>`): the approval stop check for subagents.

## 4. Research questions
1. Can a mod spawn a named subagent type (`$.agent.spawn`) with a prompt and wait for its result? What is returned, and does it keep context isolation the way a `context: fork` skill does? (Check the type file for `spawn` signature and result.)
2. Can `$.agent.register` define an agent type from the plugin without `agents/step-executor.md`, or is the markdown file still the definition? Does `agent.offer` allow hiding the agent when no flow is bound?
3. Does `$.agent.list()` give enough (id, type, status, started time) to detect a crashed or killed step-executor and replace the 10-minute timer? How would the mod link an `agentId` to a step id (the prompt, or `agent.spawn` input)?
4. Do `tool.call` and `tool.check` hooks get `agentId` for the step-executor's tool calls, so a guard can apply different rules inside the subagent than in the main conversation? Does `session_id` in settings hooks differ between the two, or not?
5. Does the delegation skill's `context: fork` plus `agent:` frontmatter continue to be the best way to start the agent, or does `agent.spawn` give something it cannot (per-step model, effort, tool allowlist, background)?
6. Can per-step guidance (the `stepDefinition`) be delivered to the agent through the mods API (`prompt.context` for the subagent, `agent.spawn` input rewrite) so the agent does not need to read `flow.json` itself? Is this worth it, given the owner's decision that the JSON files stay the contract?
7. Is `flow-spawner` used by anything? (Answer by grepping skills and docs.) If unused, say it is a candidate for deletion rather than migration.
8. What is the fallback when mods are off? (Agent and skill stay as they are; see X01.)

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`):
   - https://code.claude.com/docs/en/plugins/mods/reference#events ("Subagents" table: `agent.offer`, `agent.spawn`; "Tools" table: `agentId` on `tool.check`) and `#mods-api-methods` (`$.agent` row, status values)
   - https://code.claude.com/docs/en/plugins/mods/api#send-and-receive-messages-between-sessions (`$.session.send` to `agentId`)
   - https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call and `#follow-a-turn`
   - https://code.claude.com/docs/en/sub-agents and https://code.claude.com/docs/en/agent-teams (what a native subagent is; compare with `../docs/claude/claude-code-sub-agents.md` in this repo)
   - https://code.claude.com/docs/en/plugins/mods/admin
2. Search the type file for: `agent.spawn`, `AgentSpawnInput`, `agent.offer`, `agent.register`, `AgentRegister`, `agent.list`, `AgentStatus`, `agentId`, `isTeammate`, `ToolCallInput`.
3. Read these repo files: `agents/step-executor.md`, `agents/flow-spawner.md`, `skills/step-executor-delegation/SKILL.md`, `hooks/hooks.json`, `scripts/block-stop-pending-steps.sh`, `scripts/check-approval-stop.sh`, `scripts/block-todo-tools.sh`, `skills/flow-new/SKILL.md` (sections "Step Execution Loop" and "Subagent Delegation"), `config` operating principles (`~/.claude/zeremai/config/operating-principles.json` if present).
4. Compare: what the fork skill + agent md give today versus what `agent.spawn`/`agent.register` give. Make a small table: start a step / pass corrections / pick model / detect crash / identify subagent tool calls.
5. Write the answer under "7. Research result".

## 6. Out of scope
No implementation. No plugin edits (do not delete `flow-spawner` here; only report). No building a mod. (Only items S01-S03 may build a throwaway mod outside this repo; a spike on `$.agent` is S-series work, not this item.)

## 7. Research result

Built at the owner's request after the plan page "Mod Migration P06 to P12" (all 5 decisions kept as proposed).

### Claude Code version
2.1.296

### Answers (short)
1. Spawn by mod: not needed. The delegation skill (`context: fork` + `agent:`) already gives context isolation. No change.
2. The agent stays a markdown file (`agents/step-executor.md`). Nothing gained by registering it from the mod.
3. Crash detection: done. `isStepExecutorRunning` reads the agent list (`hooks/infra/step-executors/step-executors.ts:6`) and `on-agent-stopping.ts:100` starts the step again when no agent is alive. The 10-minute timer script is gone.
4. Subagent tool calls carry `agentId`; the guards use it (`on-todo-tool.ts:23`, `on-agent-editing.ts:31`).
5. Per-step model or tool list: not needed now. A later plan can add it with `agent.spawn`.
6. Step guidance stays in `flow.json`; the agent reads it. The JSON files are the contract.
7. `flow-spawner` was never called: before P04 the only mention was an optional list in the two old skills, which created sub-flows themselves. `flow-run` does the same. **Deleted** (agent file, `AGENTS.md`, `README.md`).
8. With mods off the agent and skill still load, but no flow tool exists (see P10).

### Final verdict
**keep** (plus one deletion).

### Evidence
Repo: `step-executors.ts:6`, `on-agent-stopping.ts:100`, `AGENTS.md`, `README.md`. Search: grep of the repo for `flow-spawner` found only its own file and two doc lines.

### Risks
A grep covers this plugin only, not other plugins that could name the agent.

### What a later plan must decide
Whether the mod, not the model, drives the step loop (H01).

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P06"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1-3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
