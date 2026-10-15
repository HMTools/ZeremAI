---
name: flow-state-update
description: Update flow state files (flow.json, memory/<topic>.json, log.json) with the flow script. ALWAYS use this skill when working with zeremai — whenever you need to update step status, record memory, log actions, or modify any flow state file. Never use Write/Edit or Bash on flow state files. Used by step-executor and the flow-run skill.
user-invocable: false
---

# Flow State Update

**Critical**: All flow state changes go through one script, `scripts/flow_manager.py` of this plugin, and only through it. This page names each operation by `<name>` with underscores (for example `update_step_status`); the subcommand is the same name with dashes (`update-step-status`). Never use Write, Edit or any other Bash command on flow state files: the plugin refuses it, and a hand edit can corrupt the flow.

## When to Use

Use this skill whenever you need to:
- Update step status (pending → in_progress → completed)
- Record memory entries after completing work
- Log actions, reasoning, and user interactions
- Update flow-wide status or observations

If you work in the ZeremAI framework and need to change any `.json` file in a flow directory, use the tools on this page.

## How to run an operation

The first message of every flow gives the exact command form, with the full path of the script. It is always one Bash command:

```
python3 <plugin>/scripts/flow_manager.py <subcommand> --json '<one JSON object>'
```

- The input is one JSON object in single quotes. The keys are the inputs named on this page (`flowDir`, `stepId`, ...). Lists and objects are real JSON values. An apostrophe inside the JSON is written `'\''`.
- Nothing else on the line: no pipe, no `;`, no `&&`, no redirect, nothing after the closing quote. The plugin refuses any other form.
- Each call answers one line: `{"status": "ok", "files_written": [...]}` or `{"status": "error", "message": "..."}`. Read the message of an error: it says what to do next.
- The plugin also refuses a call at the wrong moment: with no flow bound, while the approval dialog is open, for a folder that is not a flow of this session, or for `approve-step` (only the user approves). The plugin logs each prompt of the user itself: you never log a prompt.
- `request_approval` is the subcommand `request-approval` with `--json '{}'`. It shows the user the dialog and waits for the click.

Every operation takes `flowDir`, the absolute path of the flow folder (for example `~/.claude/zeremai/active/flow-name`, written out in full), except `list_findings` and `update_finding_status`.

---

## Available Tools

### update_step_status

Change a step's status in `flow.json`. It sets `startedAt` when the step moves to `in_progress` and `completedAt` when it moves to `completed`.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir` | Yes | Flow folder |
| `stepId` | Yes | Step id (UUID) |
| `status` | Yes | `pending`, `in_progress`, `completed`, `skipped`, `awaiting_approval` or `blocked` |
| `reason` | For `blocked` | One sentence: what the user must do (for example "The az login expired.") |
| `command` | No | For `blocked`: the command the user runs |

**Blocked**: use it only when a retry cannot help and the user must act (an expired login, no access, a missing secret). The step then shows as blocked with the reason, and the plugin does not push you to continue. A step that moves to any other status loses the note.

**Note**: A step with `approvalRequired: true` cannot be completed until the user approved it. The user approves with a click in the dialog that the tool `request_approval` opens. If the step is not approved, this tool answers an error.

---

### update_current_state

Set the active step in `flow.json`, with the substep if the step has substeps.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir` | Yes | Flow folder |
| `stepId`, `stepName` | Yes | The active step |
| `summary` | Yes | What the step does now |
| `details` | No | More detail |
| `totalSubsteps` | No | Number of substeps (default 0) |
| `substepNumber`, `substepName` | No | The current substep, 1-based; give both |

---

### update_active_substep

Change only the substep of the active step, when the step itself did not change.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir` | Yes | Flow folder |
| `substepNumber` | Yes | Current substep, 1-based |
| `substepName` | Yes | Name of the substep |
| `summary` | No | New action summary |

---

### add_memory_entry

Add or update what a step produced in `memory/<topic>.json`. If the step already has an entry in that topic, the decisions and files are appended and the information is merged. The tool also updates `memory/_cross-references.json`. The step name comes from `flow.json`.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir`, `stepId` | Yes | Flow folder and step |
| `topic` | Yes | Topic file name, lowercase with hyphens: `context`, `identified-files`, `implementation-decisions` |
| `info` | No | Object: information produced |
| `decisions` | No | List of decisions made |
| `files` | No | List of files modified or created |

A step can write only the topics in its `memoryFileUsage.writeTo`. An empty list means no limit.

---

### read_memory_topic

Read a memory topic file. A step can read only the topics in its `memoryFileUsage.readFrom`. `_cross-references` is always readable.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir`, `stepId` | Yes | Flow folder and step (for the access check) |
| `topic` | Yes | Topic name |

The answer is `{"status": "ok", "topic": "context", "data": {...}}`, or `"data": null` when the file does not exist.

---

### run_verifiers

Run the verifier scripts of a step. The answer is always `status: ok`, with `result` (`pass` or `fail`) and `checks` (`name`, `passed`, `message`). A step with no verifiers passes. It only reads. The plugin runs it when a step subagent ends, so a step subagent can use it to check its own work first.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir`, `stepId` | Yes | Flow folder and step |

---

### get_step_brief

Give the prompt of a step subagent as one text: the step, the flow parameters, the content of the memory topics it reads, and on a re-run its earlier summary and the corrections. It only reads. The plugin runs it when you start a step subagent: you never need it.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir`, `stepId` | Yes | Flow folder and step |
| `corrections` | No | What the user asked to change, on a re-run |

The answer is `{"status": "ok", "text": "..."}`. A step with an empty definition (a sub-flow step) is an error.

---

### add_log_entry

Append to the entry of a step in `log.json`. Only the inputs you give are appended.

| Input | Description |
|-------|-------------|
| `flowDir`, `stepId` | Required: flow folder and step |
| `actions` | List of actions taken |
| `reasoning` | List of reasoning entries |
| `filesModified` | List of file paths modified |
| `problems` | List of problems met (feeds the `continuous-improvement` analysis) |
| `decisions` | List of decisions made |
| `performanceNotes` | List of performance observations |

**Important**: Log every issue, error, workaround or surprise in `problems`. The `continuous-improvement` step reads `problemsEncountered` from the log to find systemic issues and save them as findings (see `write_finding`).

---

### update_flow_status

Change the status of the flow. A finished flow moves to its status folder: `completed/`, `failed/`, or back to `active/` for `running` and `paused`. The answer then has `relocated_to`: use that path from then on.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir` | Yes | Flow folder |
| `status` | Yes | `running`, `completed`, `failed` or `paused` |
| `summary` | When completing a sub-flow | What the sub-flow did. The parent reads it. |

---

### register_child_flow

Record a sub-flow in the parent's `flow.json` (`subFlowState.childFlows`). A child with the same id is updated, not added twice.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir` | Yes | The parent's folder |
| `childId`, `childName` | Yes | The child's id and name |
| `childStatus` | Yes | `running`, `completed`, `failed` or `paused` |
| `spawnedAtStep` | Yes | UUID of the parent step that started the child (not its number) |
| `syncPoint` | Yes | UUID of the parent step that waits for the child |
| `childFlowPath` | Yes | The child's folder |

---

### update_child_status

Change the status of a child in the parent's `flow.json`.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir` | Yes | The parent's folder |
| `childId` | Yes | The child's id |
| `childStatus` | Yes | `running`, `completed`, `failed` or `paused` |

---

### update_log_observations

Append to `flowWideObservations` in `log.json`. Steps like `apply-changes`, `review-verify-document` and `continuous-improvement` use it for patterns and recommendations. Every input is optional.

| Input | Description |
|-------|-------------|
| `flowDir` | Required: flow folder |
| `patterns` | List of patterns detected |
| `feedback` | List of user feedback summaries |
| `metrics` | Object of efficiency metrics (merged) |
| `recommendations` | List of recommendations for the future |

---

### create_flow

Create the files of a new flow from a template. Only the mod (when the user presses **Create flow** on the ZeremAI site, opened with `/zeremai`) and sub-flow steps use this.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir` | Yes | The new flow folder |
| `templatePath` | Yes | Path to the template JSON |
| `name` | No | Flow name; defaults to the template name |
| `params` | No | Object: the parameters of the flow |
| `projectPath` | No | Absolute project path; defaults to the session folder |
| `parentFlowPath`, `parentId`, `parentName`, `returnToStep` | No | For a sub-flow |

---

### write_finding

Save one improvement finding to the global store (`~/.claude/zeremai/improvement-findings/<templateId>/<flowId>.json`). Only the `continuous-improvement` step calls it, never a normal work step.

| Input | Required | Description |
|-------|----------|-------------|
| `flowDir` | Yes | Flow folder |
| `category` | Yes | One of the step's `improvementCategories` names |
| `title` | Yes | Short description |
| `what` | Yes | What the improvement does |
| `why` | Yes | Why it is worth doing |
| `impact` | Yes | Expected impact |
| `scope` | No | List of target file paths |

---

### list_findings

Return the findings of every flow. Only the `apply-improvements` skill calls it, never a running flow.

| Input | Description |
|-------|-------------|
| `status` | `open`, `applied`, `rejected` or `deferred` |
| `templateId` | Only this template. It is the template's own UUID (the `"id"` of its JSON, or `metadata.templateId` of a flow), not its name. Each finding has its readable name in `template`. |

---

### update_finding_status

Record the outcome of a finding. Only the `apply-improvements` skill calls it.

| Input | Required | Description |
|-------|----------|-------------|
| `flowId` | Yes | The flow UUID. It is enough to find the file. |
| `findingId` | Yes | The finding UUID |
| `status` | Yes | `applied`, `rejected` or `deferred` |
| `notes` | No | Notes |
| `filesModified` | No | List of file paths modified |

---

## Important Rules

1. **Never use Write, Edit or Bash** on `flow.json`, `log.json`, `memory/*.json` or the findings store. The plugin refuses it. Use the tools above.
2. **Always read the answer** of each tool: `{"status": "ok"}` is success, `{"status": "error", "message": ...}` says what failed.
3. **Use full paths** for `flowDir`. After `update_flow_status` moves the folder, use the `relocated_to` path.
4. **Approval is the user's.** Call `request_approval` and wait for the click. Do not try to set `approved` yourself.

---

## Common Mistakes (DO NOT DO THESE)

### [WRONG] Using Write/Edit/Bash on flow state files
**WRONG:** `Write(file_path="flow.json", content="...")` or `sed -i ... flow.json` — the plugin refuses it, and a hand edit can corrupt the state.

**CORRECT:** call the tool for the change: `update_step_status`, `add_memory_entry`, `add_log_entry`, and the others above.

### [WRONG] Building a shell command
**WRONG:** `python3 .../flow_manager.py update-step-status ...` — this script no longer exists.

**CORRECT:** call the tool `update_step_status` with `flowDir`, `stepId` and `status`.
