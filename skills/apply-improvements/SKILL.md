---
name: apply-improvements
description: Review and act on improvement findings gathered asynchronously by the continuous-improvement step across past and active flows. Use when the user wants to review pending improvement findings, or invokes /apply-improvements.
---

# Apply Improvements

The `continuous-improvement` step (auto-injected into every flow) only gathers and
saves findings — it never proposes or implements anything live. This skill is where
that actually happens: it reviews everything gathered across every flow and, for
each finding the user approves, implements the real change.

## 1. Gather open findings

Run the subcommand `list-findings` of the flow script with `{"status":"open"}` (the command form is in the flow-state-update skill).

Add `templateId` if the user asked to focus on one template (each finding's own
`template` field has the readable name to show the user). Group similar findings across
flows — same category, overlapping scope files — findings already sit together by
template on disk, which makes "this keeps coming up for template X" easy to spot.

## 2. Prioritize

Score by frequency (how many flows/log entries raised it), impact, and ease — same
criteria the old continuous-improvement step used before this change. Limit to the top
3-5 per run.

## 3. For each prioritized finding

a. Propose to the user: What / Why / Impact / Scope (target files), citing which
   flow(es) it came from and its finding id.
b. Wait for an explicit approve / reject / defer.
c. If approved: investigate the real current file(s), then implement the actual
   change. Carry over the discipline the old step used:
   - VERIFY BEFORE PROPOSING: confirm the target file was actually relevant.
   - DEEP DIVE REQUIRED: trace real execution, find all affected files, not just the obvious one.
   - Atomic, self-contained changes: one improvement at a time.
   - Clean implementation: no "before/after" traceback comments — make it look like it was always there.
d. Show the diff — what files were modified and what changed.
e. Record the outcome:
Run the subcommand `update-finding-status` with `flowId` (the finding's flowId), `findingId`, `status: applied`, `notes`, and `filesModified` (a list of paths). Use `status: rejected` or `status: deferred` (with `notes` explaining why) when not implementing.

## 4. Summarize

List what was applied, rejected, and deferred this run, each with the flow(es) it
came from and the files touched.

## Notes

- Never hand-edit files under `improvement-findings/` — always go through
  `update_finding_status`. That directory is flow state, same rule as `flow.json`,
  `log.json`, and `memory/*.json`.
- If a target file belongs to a template the user doesn't own (a marketplace template),
  say so and stop — do not attempt the edit. This is a pre-existing gap this skill
  doesn't solve.
- Zero open findings is a normal outcome — report that and stop, don't invent work.
