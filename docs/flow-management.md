# Flow Management Guidelines

This document provides essential guidelines for working with ZeremAI. All AI agents working within flows must follow these guidelines.

## Table of Contents

1. [Mandatory Logging Workflow](#mandatory-logging-workflow)
2. [Flow State Management](#flow-state-management)
3. [Approval Checkpoints](#approval-checkpoints)
4. [File Modification Guidelines](#file-modification-guidelines)
5. [User Interaction Handling](#user-interaction-handling)
6. [Sub-Flows](#sub-flows)
7. [Design Principles](#design-principles)

---

## Mandatory Logging Workflow

### ⚠️ CRITICAL RULE: Log User Interactions Immediately

**When working within an active flow, you MUST follow this workflow:**

```
User Makes Request/Correction → 
IMMEDIATELY Log to log.json (before any file changes) → 
Make File Changes → 
Update log.json with what was changed
```

### Enforcement Checklist

Before making ANY file changes in response to user input, verify:

- [ ] **Did the user make a request/correction?** → Log it immediately
- [ ] **Am I about to modify a file?** → Check if I logged the user interaction first
- [ ] **Did I just modify a file?** → Update log.json with the change details

**If user interaction not logged → STOP and log it first**

### Log Format for User Interactions

Every user interaction must be logged in the current step's "User Interactions" section:

```markdown
### User Interactions
1. **User Request**: {exact user request or summary}
   - **Reason**: {why user explained, or inferred reason}
   - **Agent Response**: {what I changed in response}
   - **Timestamp**: {current timestamp in YYYY-MM-DD HH:mm:ss format}
```

### When to Log

**ALWAYS log immediately when:**
- User requests a change or correction
- User provides feedback or clarification
- User asks a question that affects the work
- User approves or rejects something
- User provides additional context or requirements

**DO NOT wait until:**
- End of step
- End of flow
- After making changes
- After completing work

**Logging must happen BEFORE taking action.**

### Example Log Entry

```markdown
### User Interactions
1. **User Request**: "the `review-and-verify` template should be generic for investigations, the examples are just use cases"
   - **Reason**: Template description was too specific, making it seem like it only handles those two use cases when it should be generic
   - **Agent Response**: Updated Description and Parameters sections in flow.json to clarify template is generic for investigations/reviews/verifications, with examples listed as example use cases
   - **Timestamp**: 2026-01-03 17:35:30
```

---

## Flow State Management

### Current State Updates

### Memory File Updates

The `memory/ directory` file must be updated:
- **At the start of each step**: Initialize step section
- **As work progresses**: Document information produced, decisions made, files modified
- **When step completes**: Finalize step section with all outputs

### Log File Updates

The `log.json` file must be updated:
- **At step start**: Log timestamp and planned actions
- **During step**: Log each user interaction immediately (see [Mandatory Logging Workflow](#mandatory-logging-workflow))
- **As work progresses**: Log actions taken, agent reasoning, problems encountered
- **At step end**: Log completion time, summary, and observations

---

## Approval Checkpoints

### User-Only Approval Architecture

Step approval is **user-only**. No agent or automated flow can approve steps. The approval is a click in a dialog that the plugin's mod shows:

1. **The agent asks.** When a step with `approvalRequired: true` is done, the agent calls the tool `request_approval`. The mod opens a dialog with the step's name and output, and holds the call until the user answers.
2. **The user clicks.** On Approve, the mod sets `approved: true` on the step in `flow.json`. On Request changes, the user types what to change, and the agent reads it as the tool result. There is no Reject option: a step the user does not want gets changes requested.
3. **Nothing else approves.** There is no approve command. The mod refuses a hand edit of a flow file by the agent (`flow.json`, `log.json`, `memory/*.json`, the findings): the Write and Edit tools, and Bash commands that write it. Only the flow tools write them. The tool `update_step_status` still refuses completing on a step that is not approved.

While a gate is open, the agent can only research: read, search, MCP tools and subagents. A write, an edit or a Bash command waits for the click (Bash can still log the user's prompt). If the user closes the dialog, it opens again with their next prompt. The gate is a record in the mod's store, so a restart does not lose it.

### Agent Role at Approval Checkpoints

When a step has `approvalRequired: true`, the agent's role is:

1. **Check flow.json** - Look for `"approvalRequired": true` on the current step
2. **Present deliverables** to the user
3. **Call `request_approval`** - The call waits for the user's click. The answer is the result.
4. **Log user response** in log.json via the tool `log_interaction`
5. **Complete the step** via the tool `update_step_status` (status completed) (succeeds only if the user has approved). If the user asked for changes, change the step and call `request_approval` again.

### Workflow Checklist (Before Completing Step)

- [ ] Check if step has `approvalRequired: true`
- [ ] If yes: Present deliverables and call `request_approval`
- [ ] Log the user's answer via the tool `log_interaction`
- [ ] Call the tool `update_step_status` with status completed (user must have approved first)

---

## File Modification Guidelines

### Before Modifying Any File

1. **Check if you're in an active flow**
   - If yes: Follow flow workflow
   - If no: Inform user they need to create a flow first

2. **Log user interaction** (if applicable)
   - See [Mandatory Logging Workflow](#mandatory-logging-workflow)

3. **Update flow state** (if in active flow)
   - Update `memory/ directory` with planned changes
   - Log action in `log.json`

### After Modifying Any File

1. **Update log.json**
   - Add file to "Files Modified" section
   - Document what changed
   - Increment iteration count if file was modified multiple times

2. **Update memory/ directory**
   - Add file to "Files Modified/Created" section
   - Document what was produced

---

## User Interaction Handling

### Types of User Interactions

1. **Corrections**: User points out something wrong
   - **Action**: Log immediately → Fix → Log what was fixed

2. **Clarifications**: User provides additional context
   - **Action**: Log immediately → Update understanding → Continue work

3. **Approvals**: User approves a design or change
   - **Action**: Log immediately → Proceed with approved work

4. **Rejections**: User rejects a design or change
   - **Action**: Log immediately → Revise based on feedback → Log revision

5. **Questions**: User asks a question
   - **Action**: Log immediately → Answer → Continue work

### Handling User Corrections

When a user corrects something:

1. **STOP** what you're doing
2. **Log the correction** in `log.json` under current step's "User Interactions"
3. **Understand the correction** - what needs to change and why
4. **Make the change**
5. **Update log.json** with what was changed
6. **Update memory/ directory** with the file modification
7. **Continue** with the corrected approach

### Never Skip Logging

**Common mistakes to avoid:**
- ❌ Making changes first, then logging later
- ❌ Logging at end of step instead of immediately
- ❌ Forgetting to log user interactions
- ❌ Logging only major changes, not all user requests

**Remember**: Every user interaction is valuable for the Continuous Improvement step to learn and improve flows.

---

## Sub-Flows

Sub-flows allow a parent flow to spawn child flows for delegation or parallel work.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Sub-flow** | A regular flow with a parent reference |
| **Sync Point** | Where parent checks if sub-flows are complete |
| **Push Model** | Child notifies parent when done (updates parent's memory) |

### When to Use Sub-Flows

| Scenario | Example |
|----------|---------|
| **Delegation** | Missing dependencies → spawn sub-flow to create each |
| **Parallel work** | After LLD → spawn test plan and code dev flows |

### Sync Point Placement

Place sync points where parent needs sub-flow results:
- **Immediate**: Right after spawn (delegation pattern - parent waits)
- **Deferred**: Later in parent flow (parallel pattern - parent continues)
- **At end**: Before parent completes

### How It Works

```
1. DECLARE: Template step includes subFlowTrigger or subFlowConfig metadata
   ├── Declares which sub-flow template to spawn
   ├── Declares parameters to pass
   └── Declares sync point (immediate, deferred, end)

2. SPAWN: The step-executor reads the metadata and invokes flow-spawner
   ├── Creates sub-flow with parent reference
   └── Records child in parent's subFlowState

3. COMPLETE: When sub-flow finishes, the mod auto-notifies parent
   ├── update_flow_status (status completed, with a summary)
   ├── Automatically updates child status in parent's flow.json
   └── Adds completion summary to parent's memory/ directory

4. SYNC: At sync points, flow-continue checks parent's subFlowState
   ├── If children complete: proceed
   └── If children pending: wait or offer to continue sub-flow
```

### Declaring Sub-Flows in Templates

Template steps declare sub-flow spawning via metadata:

**`subFlowTrigger`** (single sub-flow):
- `template`: Template for sub-flow
- `parameters`: Parameters to pass
- `syncPoint`: When to wait ("immediate", "step-N", "end")

**`subFlowConfig`** (batch/iterative sub-flows):
- `template`: Template for each sub-flow
- `sync`: When to wait
- `iterateOver`: Data source for iteration
- `parameterMapping`: How to map iteration data to parameters

### Parent Notification (Automatic)

Parent notification is handled automatically by the tool `update_flow_status`. When a sub-flow completes:
- `update_flow_status` is called with status completed and a summary
- The script detects the parent reference in `subFlowState.parentFlow`
- It updates the child's status in the parent's `flow.json`
- It adds the completion summary to the parent's `memory/ directory`
- No explicit notification step is needed in templates

The `--summary` argument is **required** for sub-flows. If omitted, the script returns a descriptive error explaining what to provide.

### Example: Delegation Pattern

```markdown
- [ ] Step 3: Validate flow-steps exist
  - **Sub-Flow Trigger**: If missing steps found
    - For each missing dependency, spawn the appropriate sub-flow
    - **Sync Point**: Immediate (wait for all to complete)
    - Continue with newly created steps
```

### Memory Structure for Sub-Flows

Parent memory includes Sub-Flow State section:

```markdown
## Sub-Flow State

### Parent Flow
- **Parent**: None - this is a root flow

### Child Sub-Flows
| Name | Template | Status | Spawned At | Sync Point |
|------|----------|--------|------------|------------|
| flow-create-template-xyz-20260120 | create-flow-template | completed | Step 3 | immediate |

### Sync Points
- **Next Sync Point**: None
- **Pending Sub-Flows**: []
```

---

---

## Design Principles

When designing new concepts, patterns, or flows, follow these principles:

### Start Simple

**Avoid over-engineering.** Start with the simplest solution that could work, then add complexity only when justified.

| Approach | Example |
|----------|---------|
| ✅ **Simple** | Sub-flows are regular flows with parent-child references |
| ❌ **Over-engineered** | Sub-flows have special directories, monitoring, and execution modes |

**Signs of over-engineering:**
- Creating new categories when existing ones suffice
- Adding special handling for cases that don't need it
- Separating concepts that are actually the same (e.g., "sync" and "async" when sync is just async with immediate wait)

### Leverage Existing Patterns

Before creating something new, check if existing infrastructure can be extended:
- Can JSON files store this metadata?
- Can existing templates be modified?
- Does a similar pattern already exist?

### The Entity That Knows Should Report

For notifications and status updates, prefer push over pull:
- The entity that knows something happened should report it
- Don't poll when you can notify
- Example: Child flow notifies parent when done (instead of parent polling child)

---

## Why This Matters

### For Continuous Improvement

The Continuous Improvement step analyzes `log.json` to:
- Identify patterns in user corrections
- Find opportunities to automate repetitive fixes
- Improve templates and steps based on actual usage
- Reduce future user interventions

**If user interactions aren't logged, the system can't learn and improve.**

### For Flow Tracking

Accurate logging enables:
- Understanding what happened during flow execution
- Debugging issues that occurred
- Replicating successful patterns
- Identifying bottlenecks and inefficiencies

---

## Quick Reference

### Workflow Checklist

When user makes a request:

```
[ ] 1. Log user interaction in log.json (User Interactions section)
[ ] 2. Make necessary file changes
[ ] 4. Update log.json (Files Modified section)
[ ] 5. Update memory/ directory (Files Modified/Created section)
[ ] 6. Continue with work
```

### Log File Structure

```json
{
  "steps": {
    "step1": {
      "name": "Step Name",
      "timestamp": {
        "started": "2026-01-22T10:00:00Z",
        "completed": "2026-01-22T10:30:00Z"
      },
      "actionsTaken": [
        "Action description",
        "Another action"
      ],
      "agentReasoning": [
        "Why decisions were made",
        "Context considered"
      ],
      "userInteractions": [
        {
          "userRequest": "What the user asked",
          "reason": "Why the change was needed",
          "agentResponse": "What was changed in response",
          "timestamp": "2026-01-22T10:15:00Z"
        }
      ],
      "filesModified": [
        {
          "path": "path/to/file.md",
          "changes": "Description",
          "iterations": 1
        }
      ]
    }
  }
}
```

---

## Enforcement

These guidelines are **MANDATORY** for all AI agents working within flows. Failure to follow the logging workflow prevents the system from learning and improving.

**If you find yourself about to modify a file without logging a user interaction first, STOP and log it immediately.**

---

**Last Updated**: 2026-01-20
**Version**: 1.1

