# <ID> · <Title>

> Status and result live in `../progress.html` (entry `<ID>`). Read `../README.md` first, then `../shared/mods-docs-reading-list.md`.

## 1. Context (no previous knowledge needed)
Five lines: what the `zeremai` plugin is, where this part sits, who calls it.

## 2. What exists today
- Files, with `path:line`.
- Behaviour in plain words (inputs, outputs, what it blocks or writes).
- State it reads or writes (paths under `~/.claude/zeremai/`).
- Known weaknesses seen in step 3.

## 3. First guess (step 3, not final)
- Verdict: replace | improve | keep | later
- Why.
- Mod abilities that might apply (event or `$` method names).

## 4. Research questions
Numbered. Each can be answered yes/no or with a short fact.

## 4b. Shared questions (UI phase, group `U` only)
S1 What does the app screen do today? S2 What draws it in the mod, for the terminal and for the Desktop app? S3 How does it learn of a change (no file watcher)? S4 What stays outside the mod, or is dropped? S5 Verdict and what a later plan must decide. Apply the result of `U01` (look and feel).

## 5. How to research
1. Re-read these mods docs pages (see `../shared/mods-docs-reading-list.md`): …
2. Search the type file for: …
3. Read these repo files: …
4. Compare with: …
5. Write the answer under "7. Research result".

## 6. Out of scope
No implementation. No plugin edits. (Only items S01–S03 may build a throwaway mod outside this repo.)

## 7. Research result
_(empty until the research is done; fill: Claude Code version, answers to each question with evidence, final verdict, open questions, risks, what a later plan must decide.)_

## 8. After the research: update the progress page
Edit `../progress.html`: find the object with `id: "<ID>"` between `/* ITEMS:START */` and `/* ITEMS:END */` and set:
- `status`: `"done"` (or `"blocked"` with the reason in `summary`)
- `verdict`: the final verdict
- `summary`: 1–3 sentences
- `open`: list of open questions (empty list if none)
- `updated`: today's date `YYYY-MM-DD`
Do not change other entries. Then open the file in a browser and check your row.
