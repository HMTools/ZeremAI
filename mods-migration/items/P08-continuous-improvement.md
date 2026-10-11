# P08 · Continuous improvement and apply-improvements

> Status and result live in `../progress.html` (entry `P08`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
`zeremai` (v2.0.28) is a Claude Code plugin that runs resumable workflows ("flows") made of steps. The framework adds two steps to every flow automatically: **continuous-improvement** (reads the flow log, saves improvement ideas as "findings") and **end-flow-validation** (checks the operating principles, marks the flow completed). Findings are stored globally. Later, the user runs the skill **apply-improvements** to review the saved findings across all flows and implement the approved ones. The agent running the step calls the Python CLI `scripts/flow_manager.py` to save and update findings.

## 2. What exists today
**Files and code**
- Framework step definitions: `framework-steps/continuous-improvement/continuous-improvement.json` (224 lines) and `framework-steps/end-flow-validation/end-flow-validation.json` (218 lines). Both have `"type": "framework-step"`.
- Injection at flow creation: `scripts/flow_manager.py:375-398` loops over `framework-steps/*/`, reads each JSON whose `type` is `framework-step`, and appends a step with a fresh UUID (`stepRef` = the framework step's own id). Fields embedded come from `EMBED_FIELDS + EXTRA_EMBED_FIELDS` (`flow_manager.py:287-288`). `skills/flow-new/SKILL.md:97` documents it for template authors.
- Continuous improvement step: `approvalRequired: false` (`continuous-improvement.json:6`); the step only saves findings and never proposes or edits (`:9`, `:28-33`, `:196-203`); substeps `:54-146` (read log, analyse with a deep dive, prioritise top 3-5, save each with `write-finding`, summarise, compliance check); memory output topic `improvements.json` (`:150-160`); categories `:161-186`; success criteria `:204-209`.
- Findings CLI: `flow_manager.py:1121` `cmd_write_finding`, `:1157` `cmd_list_findings` (`--status`, `--template-id`), `:1170` `cmd_update_finding_status` (`--status applied|rejected|deferred`, `--notes`, `--files-modified`). Data class `scripts/models.py:599` `ImprovementFinding`; storage root `models.py:595` `FINDINGS_DIR = ~/.claude/zeremai/improvement-findings`. Details are in item `P07`.
- apply-improvements skill: `skills/apply-improvements/SKILL.md` (64 lines): gather open findings (`:13-22`), prioritise (`:24-28`), per finding propose / wait for approve-reject-defer / implement / show diff / record outcome (`:30-49`), summarise (`:51-54`), notes (`:56-64`: never hand-edit `improvement-findings/`; stop for marketplace templates the user does not own; zero findings is fine).
- End-flow validation step: checks five principles (log first, read JSON, stop at checkpoints, no todos, verify actions) by reading `log.json` (`end-flow-validation.json:29-44`) and then moves the flow folder from `active/` to `completed/` (`:41`, substep text at `:145-148`).

**Behaviour in plain words**: the improvement step runs inside the flow, like any other step, driven by the agent from the JSON guidance. It writes findings and finishes immediately. The review is a separate, user-started, interactive skill run later. Nothing connects the two except the files: no reminder tells the user findings are waiting.

**State read/written**: reads `active/<flow>/log.json`; writes `improvement-findings/<templateId>/<flowId>.json` and `memory/improvements.json`; `apply-improvements` edits the real target files named in each finding's `scope`.

**Known weaknesses (step 3)**: nothing tells the user that open findings exist; findings for marketplace templates cannot be applied (SKILL notes `:61-63`); the end-of-flow principle check is done by the agent reading its own log (self-audit).

## 3. First guess (step 3, not final)
- Verdict: **keep**.
- Why: the work is analysis and code changes by an agent with tools. A mod cannot replace that. A mod's model call (`$.model.complete`) has no tools and no conversation, so it cannot do the "deep dive" the step requires. A mod can at most add a nudge or a command around the existing workflow (then the verdict becomes `improve`).
- Mod abilities that might apply: `session.start` + `$.flow.run(['python3', '.../flow_manager.py', 'list-findings', '--status', 'open'])` + `$.ui.toast` or `$.ui.status` ("3 open improvement findings, run /zeremai:apply-improvements"); `$.command.register` for a short `/findings` command that prints the list (`command.run` returns `{ text }`); `$.prompt.submit` to start the skill; `classic.SessionEnd`; `turn.complete` (returns `{ text }` to show a line under the answer). For the principle checks in end-flow-validation, the guard mods of items `H01`-`H11` may make the self-audit partly redundant.

## 4. Research questions
1. Can a mod show a count of open findings at session start or after a flow completes, using only `$.flow.run` of `list-findings` and `$.ui.toast` / `$.ui.status`? What are the time limits (10 s hook, 30 s `$.flow.run`) and what happens if python or the script fails?
2. Can a mod register a command that starts the `apply-improvements` skill (for example by `$.prompt.submit({ text: '/zeremai:apply-improvements', asUser: true })`), or is it simpler to leave the existing skill as the entry point?
3. Does `$.model.complete` or `$.model.fork` have any ability to read files or use tools? If not, confirm that analysing the log and tracing real execution needs the main agent, so the step stays as it is.
4. Is there a mod event that fires when a flow reaches `completed` or when the folder moves to `completed/`? (There is no file-watch method in the `$` list; check `$.fs`, `classic.*` events, and `tool.call` on Bash commands that call `update-flow-status`.)
5. Could a mod replace the self-audit in end-flow-validation by checking the principles itself (for example, "all user interactions logged": the `pending-log` flag is the signal)? Which principles would still need the agent?
6. Does anything in the mods docs help the marketplace-template gap (findings about templates the user does not own)? Probably no: record it as out of mod scope if so.

## 5. How to research
1. Re-read these mods docs pages (full URLs under `https://code.claude.com/docs/en/plugins/mods/`):
   - `api`: "Show something without starting a turn" (`$.ui.status`, `$.ui.toast`, `$.ui.log`), "Call a model", "Start a turn from a background job", "Add a command".
   - `events`: "Follow a turn" (`turn.complete`), "Handle the settings hook events" (`classic.SessionEnd`, `classic.Stop`).
   - `reference`: "Mods API methods" (`$.model`, `$.prompt`, `$.ui`) and "Limits".
2. Search the type file for: `interface ModelCompleteOptions` or `model.complete`, `PromptSubmit` / `prompt.submit` (`asUser`), `'turn.complete'`, `ClassicEventName` (is `SessionEnd` in it), `ui.toast`, `ui.status`.
3. Read these repo files: `framework-steps/continuous-improvement/continuous-improvement.json`, `framework-steps/end-flow-validation/end-flow-validation.json`, `skills/apply-improvements/SKILL.md`, `scripts/flow_manager.py` lines 375-398 and 1121-1190, `scripts/models.py` lines 595-655, `skills/flow-state-update/SKILL.md` (`write-finding` section), and the hook scripts listed in `../README.md` for the principles end-flow-validation checks (`scripts/enforce-log-first.sh`, `scripts/block-todo-tools.sh`).
4. Compare: each activity of the step and the skill (analyse, save, remind, review, implement, record) against what a mod can do; mark each "agent only" or "mod could help".
5. Write the answer under "7. Research result": verdict plus a list of at most three small mod additions (if any) with the exact events and `$` methods.

## 6. Out of scope
Research only. No repo edits and no building a mod. Do not redesign the finding format. Related items: `P07` (findings files), `P11` (status display in the session), `H01`-`H11` (hook scripts behind the principles).

## 7. Research result

Built at the owner's request after the plan page "Mod Migration P06 to P12" (all 5 decisions kept as proposed).

### Claude Code version
2.1.296

### Answers (short)
1. Yes: `session.start` counts open findings with `listFindings` and calls `$.ui.toast` (`on-flow-tools.ts`, `nudgeFindings`). It shows nothing for 0 and nothing if the call fails.
2. A command to start the skill was not added. The message names `/zeremai:apply-improvements`.
3. `$.model` has no tools, so the deep dive stays with the agent. The step stays as it is.
4. No event fires when a flow completes by itself; not needed.
5. The self-audit in end-flow-validation stays. The guard mods cover most principles, but the step is cheap.
6. The marketplace-template gap is out of mod scope.

### Final verdict
**improve.**

### Evidence
Repo: `on-flow-tools.ts` (`nudgeFindings`), test "a session start with open findings shows one message; with none, nothing".

### Risks
The toast shows 4 seconds and only in the terminal and the Desktop app.

### What a later plan must decide
Nothing.

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `"id": "P08"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
