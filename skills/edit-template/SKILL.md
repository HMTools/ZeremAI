---
name: edit-template
description: Change an installed flow template from a description, or send the changes you made to its marketplace repository as a pull request. Use when the ZeremAI page hands you a template to edit or to send, or when the user runs /zeremai:edit-template with a template folder and a change. It drafts the change, has a reviewer check it, shows it on one page, and writes only after the user approves.
argument-hint: <template folder> <what should change | send>
---

# Edit Template

The user wants to change an installed template, or to send an earlier change to its marketplace. The text is: `$ARGUMENTS`

This skill never starts a flow and never changes a flow. A running flow keeps its own copy of every step, so an edit does not reach it. It does not use the flow script.

The first word of the text is the template folder: `~/.claude/zeremai/templates/flows/<category>/<name>`. If the text says **send mode**, go to "Send". If the folder is missing, list the installed templates and ask.

## Where things are

Same as `create-template`: `<plugin>` is the plugin folder two levels above this skill's base directory, the formats are `<plugin>/types/template-definition.ts` and `step-definition.ts`, and the draft is `draft.json` in your scratchpad folder, written with the Write tool.

## Edit

1. **Read the template.** Read `<name>.json` and every `<step>/<step>.json` in the folder. Tell the user in one line if the folder has a marketplace in `~/.claude/zeremai/config/installed-templates.json`: the change will be a copy of the template, and the next Update from that marketplace asks before it erases it.
2. **Draft.** Build `draft.json` in the shape `create-template` uses: `{ "template": <TemplateDefinition>, "newSteps": [<StepDefinition>], "copied": [], "children": [], "findings": null }`. Start from the files you read. Apply the change the user asked for and nothing else. Keep every `id` and every `stepRef` that exists. A new step gets a fresh UUID v4. Set `lastUpdated` to today. Follow every rule of `create-template` for the plan: self-contained steps, approvals only where a person must judge, no framework steps.
3. **Check.** Run `python3 <plugin>/scripts/check_template.py --draft <draft.json>`. Fix every `must-fix` and run it again.
4. **Review.** Start the `zeremai:template-reviewer` agent with the path of the draft and nothing else. Put its findings in `draft.json` as `create-template` step 4 says.
5. **Show it.** Build the page like `create-template` step 5 does (`mode: "draft"`), and say in the title what changed. Publish it with the Artifact tool and `capabilities: {"comments": {}}`. Say in one line what changed and how many findings are open. Then wait for the `[zeremai answer]` comment, and read it like `create-template` step 6 does. If there is no Artifact tool, ask in chat.
6. **On Approve, write.** Write the changed files into the same template folder. Never write to `~/.claude/zeremai/cache/sources`. Run `python3 <plugin>/scripts/check_template.py --dir <folder>`. Tell the user the page now shows the template as "edited by you", and that **Send as PR** sends it to the marketplace.

## Send

1. **Find the marketplace.** The page names it. Read its `url` and `branch` in `~/.claude/zeremai/config/marketplaces.json`. If the template has no marketplace, say so and stop.
2. **Clone fresh.** Clone the marketplace into your scratchpad folder. Never use `~/.claude/zeremai/cache/sources`: it is only pulled.
3. **Look for a clash.** Read `version` of the template in `~/.claude/zeremai/config/installed-templates.json`: the commit that the user installed. Run `git fetch` in the clone for that commit, then `git diff <version> HEAD -- templates/flows/<category>/<name>`. If it shows changes, the repository changed the same template since the install. **Do not push.** Merge the two versions by hand in the clone, show the user the result with `git diff`, and wait.
4. **Copy and branch.** Copy the template folder over `templates/flows/<category>/<name>` in the clone. Make a branch `edit-template-<name>` and commit. Show `git diff --stat`.
5. **Ask before the push.** A push is outward-facing, so ask in chat first. After the push, open a pull request with `gh pr create` if `gh` exists. Otherwise give the branch name and the repository address. If git asks for a login that does not work, say so and stop. Nothing is lost.
6. **Finish.** Say where the pull request is. The template on this machine stays as it is. After the pull request merges and the user presses Refresh and Update on the page, the template shows as up to date.
