---
name: step-executor-delegation
description: Execute a flow step by delegating to the step-executor subagent. Use when a flow step needs to be executed. Provide the flow directory and step ID as arguments. Optionally pass user corrections as a third argument for re-execution.
context: fork
agent: zeremai:step-executor
arguments: [flow-dir, step-id, corrections]
user-invocable: false
---

Execute the step identified below.

## Flow Metadata
- Flow directory: $flow-dir
- Step ID: $step-id

## Instructions

1. Read `flow.json` from the flow directory
2. Locate your step by matching the step ID against `steps[].id`
3. Read your `stepDefinition` from that step entry — this is your SOLE source of execution instructions
4. Read only the memory topic files declared in `stepDefinition.memoryFileUsage.readFrom` from the `memory/` directory for context from prior steps
5. Read flow `parameters` from `flow.json` for flow-level context
6. Execute according to the stepDefinition's guidance, substeps, and flow
7. Update flow state via the `flow-state-update` skill (use `--topic` for memory writes)

If the stepDefinition is empty, this is a sub-flow orchestrator step that should have been handled by the flow-run skill (which detects `subFlowTrigger` and spawns child flows). Do NOT improvise or execute based on the step name. Return an error: "Empty stepDefinition — this is a sub-flow orchestrator step. It must be driven by the parent flow driver, not the step-executor."

## User Corrections
$corrections

If corrections are provided above, this is a re-execution after the user reviewed deliverables. Read the step's current state from flow.json and the relevant memory topic files to understand what was done previously, then apply the corrections. Do not redo the entire step — only address the corrections.
