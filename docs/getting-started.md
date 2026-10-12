# Getting Started with ZeremAI

This guide will help you get started with ZeremAI, from installation to creating your first flow.

## Prerequisites

- Claude Code
- Basic understanding of markdown files
- Familiarity with workflow management concepts

## Installation

### Option 1: Plugin Marketplace (Recommended)

```bash
claude plugin install zeremai
```

### Option 2: Local Plugin Directory

For development or customization, use the plugin directory flag:

```bash
claude --plugin-dir /path/to/zeremai
```

### After Installation

After installing the plugin, open the Marketplace in the UI to browse available templates and install the ones you need. This installs flow templates to `~/.claude/zeremai/templates/flows/` and creates all required runtime directories (`active/`, `completed/`, `failed/`, `flags/`, etc.).

## Your First Flow

### Step 1: Invoke Flow Creation

In Claude Code, type:
```
/zeremai new
```

### Step 2: Select a Template

The system will display available templates. For example:
- `develop-user-story` - End-to-end user story implementation
- `integration-test-fix` - Fix failing integration tests
- `set-concept` - Establish a new concept/pattern

Select the template that matches your task.

### Step 3: Provide Parameters

The system will ask for required parameters. For example, for `develop-user-story`:
- `userStoryTitle`: "User Authentication"
- `userStoryDescription`: "Implement login functionality"
- `acceptanceCriteria`: "User can log in with email and password"

Provide the requested information.

### Step 4: Flow Created

The system will:
1. Resolve all step references
2. Substitute all parameters
3. Create flow instance in `~/.claude/zeremai/active/flow-{name}-{YYYYMMDD}/`
4. Display the flow with steps ready to execute

### Step 5: Begin Work

The flow is ready. The system will highlight the first step and offer to begin working immediately.

## Understanding Flow Structure

### Flow File (`flow.json`)

The primary state file contains:
- Flow metadata (name, template, status)
- Current state (active step, current action)
- All steps with status tracking
- Parameters

### Memory File (`memory/ directory`)

Stores information shared across steps:
- Information produced in each step
- Decisions made
- Files created/modified
- Notes and context

### Log File (`log.json`)

Automatically maintained execution log:
- Detailed action history
- User interactions
- Challenges encountered
- Time tracking

## Working with Flows

### Completing Steps

As you work through steps:
1. Follow the step guidance
2. Complete the substeps
3. Mark the step complete when done
4. The system automatically updates state and audit log

### Resuming a Flow

To continue a flow:
```
/zeremai continue
```

The system will:
1. List all active flows
2. Show current progress
3. Resume from the last incomplete step

### Flow States

Flows can be in three states:
- **Running**: Currently active, in `~/.claude/zeremai/active/`
- **Completed**: Finished successfully, moved to `~/.claude/zeremai/completed/`
- **Failed**: Encountered errors, moved to `~/.claude/zeremai/failed/`

## Key Concepts

### Templates

Templates define reusable workflows:
- Use parameter placeholders: `{{paramName}}`
- Reference steps by UUID via `stepRef`, with `stepRefName` as human-readable companion
- Include flow diagrams
- Define sequential steps

Templates are installed to `~/.claude/zeremai/templates/flows/{category}/` from configured marketplaces.

### Steps

Steps are subdirectories of their flow template directory. Each step subdirectory contains:
- `{step-name}.json` -- complete step definition with guidance, substeps, flow

### Step References

Templates reference steps using a UUID that matches the `id` field of the step definition:
```json
{
  "stepRef": "28047be4-e7c5-4152-8329-2929982ad042",
  "stepRefName": "understand-context"
}
```
Resolution: scan template subdirectories for a step definition JSON file whose `id` field matches the UUID. The `stepRefName` is a human-readable companion for display only -- never used for resolution.

Framework steps use plain UUID `stepRef` values and are identified by `"type": "framework-step"` in their definition.

## Common Workflows

### Feature Development

1. Create flow from `develop-user-story` template
2. Provide user story details
3. System creates high-level plan
4. Review and approve plan
5. System creates detailed step plans
6. Execute implementation steps
7. Write tests
8. Update documentation
9. Complete flow

### Bug Fix

1. Create flow from `integration-test-fix` template
2. System diagnoses test failure
3. Implement fix
4. Verify test passes
5. Complete flow

## Tips for Success

1. **Be Specific**: Provide detailed parameters for better flow creation
2. **Review Steps**: Review expanded steps before starting work
3. **Use Memory**: Store important information in memory file
4. **Check State**: Review current state section to understand progress
5. **Follow Guidance**: Step guidance provides detailed instructions

## Setting Up Marketplaces

Marketplaces are git-backed repositories that provide flow templates. The default configuration includes the official templates repo, but you can add custom marketplaces.

### Viewing Configured Marketplaces

Open the Marketplace section in the UI Settings to see all configured marketplaces with their status, installed template counts, and available updates.

### Adding a Custom Marketplace

In the Marketplace section of the UI Settings, click "Add Marketplace" and provide:
- **name**: A short identifier for the marketplace
- **url**: The git clone URL
- **branch**: The branch to track (default: `main`)
- **priority**: Lower number = higher priority

### Browsing and Installing Templates

Expand a marketplace row to see its template catalog. Each template shows its name, description, category, type (flow/step), and install status. Click "Install" to install a template, or "Uninstall" to remove it. Templates with available updates show an "Update" button.

### Refreshing Marketplaces

Click "Refresh All" to fetch the latest template catalogs from all enabled marketplaces, or refresh individual marketplaces using the refresh button on each row.

## Next Steps

- Read [Architecture Guide](architecture.md) for system details
- Check [Examples](examples.md) for more use cases
- Explore templates by opening the Marketplace in the UI Settings to browse available templates

## Getting Help

If you encounter issues:
1. Check the flow's log.json for execution history
2. Review memory/ directory for context
3. Check the flow.json for current state
4. Consult the documentation files

---

**Ready to create your first flow?** Type `/zeremai new` to get started!
