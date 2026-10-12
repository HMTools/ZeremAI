---
name: view-template
description: Open an installed flow template on one readable page: an outline of its steps, a ribbon that shows where you approve, loops and child flows. Use when the user wants to read, understand or review a template that already exists, or runs /zeremai:view-template with a template name or path.
argument-hint: <template name or path>
---

# View Template

The user wants to read an installed flow template. Show it on the same page that `create-template` uses, in view mode. The text is: `$ARGUMENTS`

This skill changes nothing: it reads template files and publishes a page. It never starts a flow.

## Steps

1. **Find the template.** If the text is a path to a template JSON file or to its folder, use it. Otherwise it is a name: look for `~/.claude/zeremai/templates/flows/<category>/<name>/<name>.json`. If several categories hold the name, ask which one. If none does, say so and list the installed template names. If the text is empty, list them and ask.
2. **Build the page.** `<plugin>` is the plugin folder, two levels above this skill's base directory. Run:

   ```
   python3 <plugin>/scripts/template_to_page.py <template path> --page <plugin>/skills/create-template/page.html -o <scratchpad>/<name>.html
   ```

   It prints one JSON line: `status`, `path`, and the counts of `steps`, `approvals`, `loops` and `children`. On `error`, show the message and stop. The script reads the step files that sit inside the template's own folder, and finds a child template of a sub-flow by its id among the sibling folders and the installed templates.
3. **Publish it.** Publish the file with the Artifact tool, with no `capabilities`: in view mode the page has no answer bar. If there is no Artifact tool, give the user the file path.
4. **Say what is on it, in one line:** the number of steps, approvals and loops, and that nothing was reviewed. Offer `/zeremai:create-template` only if the user wants to change it. Do not edit the template.

## Notes

- A step without a `phase` is grouped by its approvals ("Steps 1–3", where step 3 is the one you approve). A template that sets `phase` on its steps shows those names.
- A child template the script cannot find shows as missing. Tell the user which one.
