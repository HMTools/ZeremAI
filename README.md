# ZeremAI

A powerful plugin for managing long-running, multi-step workflows with AI agents. Create reusable flow templates, modular step definitions, and track complex tasks from start to finish with persistent state management.

## Installation

Add the marketplace (one-time), then install the plugin:
```bash
[in claude] /plugin marketplace add HMTools/ZeremAI
claude plugin install zeremai@zeremai
```

Or use a local plugin directory (no marketplace needed):
```bash
claude --plugin-dir /path/to/zeremai
```

After installation, run `/flow` and open the **Templates** tab to refresh the marketplaces and install templates. This installs flow templates to `~/.claude/zeremai/templates/flows/`.

The plugin is a Claude Code mod and needs a Claude Code build with mods. With mods off (an admin policy, an untrusted new folder, a crash or `--safe-mode`) it cannot change a flow. The flow skill then tells the user and stops. Under `--safe-mode` no plugin loads at all, so the user sees nothing from this plugin.

## Overview

ZeremAI enables structured, repeatable workflows for complex development tasks. It provides:

- **Flow Templates**: Reusable workflow definitions with parameter substitution
- **Modular Steps**: Self-contained step definitions within each flow template
- **State Management**: Persistent flow state with checkboxes, timestamps, and audit logs
- **AI Integration**: Seamless integration with Claude Code
- **Flow Tracking**: Resume interrupted flows, track progress, and maintain context across sessions
- **Template Marketplaces**: Templates installed from configurable git-backed marketplaces, enabling team sharing and versioning

## Key Features

### Flow Management
- Create flows from templates with parameter substitution
- Track progress with checkboxes and timestamps
- Maintain audit logs for all actions
- Resume interrupted flows seamlessly
- Move flows between active/completed/failed states

### Modular Architecture
- **Templates**: Define reusable workflows with placeholders
- **Steps**: Self-contained step definitions within each template directory
- **Pluggable Resources**: Add your own templates, steps, components, and guidelines
- **Marketplaces**: Configure multiple git repositories as template marketplaces

### State Persistence
- Flow state stored in JSON files
- Memory files for cross-step information sharing
- Audit logs for complete history
- No data loss between sessions

### AI Integration
- Command: `/flow` (a pane with a New tab and a Continue tab)
- Strict flow adherence to prevent deviation
- Proactive guidance for next steps
- Subagent delegation for context isolation

## Quick Start

### 1. Install Templates from Marketplaces

After installing the plugin, run `/flow` and open the **Templates** tab. Press Refresh to read the git-backed template repositories, then Install the ones you need. They go to `~/.claude/zeremai/templates/`.

### 2. Create a New Flow

Use the command:
```
/flow
```

On the New tab:
1. Pick a template from `~/.claude/zeremai/templates/flows/`
2. Fill in its fields (required ones have a star) and press Create
3. The plugin resolves the step definitions, creates the flow instance and binds it to the session, then starts the first step

### 3. Continue an Existing Flow

To resume a flow, use `/flow` and open the Continue tab:
1. Every active flow shows with its current step and last change
2. Pick one: the plugin binds it to the session and resumes from the last incomplete step

### 4. Flow Structure

A flow consists of:
- **Flow File** (`flow.json`): Primary state and machine-readable data
- **Memory Directory** (`memory/`): Topic-based files for persistent information shared across steps
- **Log File** (`log.json`): Detailed execution log (auto-updated)

## Plugin Structure

```
zeremai/                    # Plugin root
├── .claude-plugin/
│   └── plugin.json                   # Claude Code plugin manifest
├── agents/                           # Root-level agents (auto-discovered)
│   └── step-executor.md
├── framework-steps/                  # Auto-injected framework-level steps
│   ├── continuous-improvement/
│   │   └── continuous-improvement.json
│   └── complete-flow/
│       └── complete-flow.json
├── hooks/
│   ├── hooks.json                    # Loads the mod (register.ts)
│   └── ...                           # The mod: one folder for each rule, infra/ for the code they share
├── skills/
│   ├── flow-run/
│   │   └── SKILL.md                  # Run the steps of a bound flow
│   ├── flow-state-update/
│   │   └── SKILL.md                  # Update flow state files
├── config/
│   └── marketplaces.default.json     # Default marketplace configuration
├── types/                            # TypeScript types + schema.json
├── assets/
│   └── logo.svg                      # Plugin branding
├── AGENTS.md                         # Agent discovery file
└── docs/                             # Documentation
```

## Core Concepts

### Flows

A **flow** is an instance of a workflow created from a template. It tracks:
- Current step and progress
- Completed steps with timestamps
- Memory and context
- Audit log of all actions

Flows are stored in `~/.claude/zeremai/`:
- `~/.claude/zeremai/active/` - Currently running flows
- `~/.claude/zeremai/completed/` - Finished flows
- `~/.claude/zeremai/failed/` - Failed flows

### Templates

**Templates** define reusable workflows with:
- Parameter placeholders (`{{paramName}}`)
- Step references via UUID (`stepRef`) with human-readable companion (`stepRefName`)
- Flow diagrams (mermaid)
- Sequential step definitions

Templates are installed to `~/.claude/zeremai/templates/flows/{category}/` from configured marketplaces.

### Steps

**Steps** are modular, self-contained definitions that live as subdirectories within each flow template directory. Each step includes:
- Description and objectives
- Expected outputs
- Detailed guidance
- Substeps breakdown
- Examples and common pitfalls

Steps are defined in subdirectories of each flow template. Each step definition JSON file has a unique `id` field (UUID v4), and templates reference steps via this UUID in the `stepRef` field, with a `stepRefName` companion for human readability.

### Framework Steps

**Framework steps** are cross-cutting workflow steps that are automatically injected into every flow by the tool `create_flow` at creation time. Template authors do not need to include them. Currently, two framework steps are auto-appended as the final steps of every flow:

- **Continuous Improvement** — Captures learnings, improvements, and patterns discovered during flow execution.
- **Complete Flow** — Deletes the artifact files the steps made, then marks the flow completed. The status tool records the time and moves the folder.

Framework steps are identified by `"type": "framework-step"` in their JSON definition and use plain UUID `stepRef` values (no prefix). Their definitions live in `{PLUGIN_ROOT}/framework-steps/{name}/{name}.json`.

## Template Marketplaces

Templates are distributed via git-backed marketplaces, not bundled with the plugin. This enables:

- **Versioned templates**: Pin to a branch or tag for stability
- **Team sharing**: Host custom templates in private repos
- **Multiple marketplaces**: Combine official and custom template repos
- **Per-template install**: Browse catalogs and install only the templates you need
- **Update detection**: See which installed templates have updates available
- **Independent updates**: Update templates without updating the plugin

### Configuration

Marketplaces are configured in `~/.claude/zeremai/config/marketplaces.json`:

```json
{
  "marketplaces": [
    {
      "name": "official",
      "url": "https://github.com/HMTools/ZeremAI-marketplace.git",
      "branch": "main",
      "enabled": true,
      "priority": 100
    }
  ]
}
```

### Managing Marketplaces

The **Templates** tab of `/flow` does these:
- **Refresh**: Fetch the latest template catalogs from all enabled marketplaces
- **Install / Update**: Copy a template from a marketplace cache, or update it when the marketplace has a newer version
- **Remove**: Delete an installed template

The same tab manages the marketplaces: **Add**, **Edit** (name, git address, branch, priority), **On/Off**, and **Remove** (press twice; it deletes the cache, not installed templates). They are kept in `~/.claude/zeremai/config/marketplaces.json`.

### Runtime Layout

After installing templates from marketplaces:
```
~/.claude/zeremai/
├── config/
│   ├── marketplaces.json              # Marketplace configuration
│   └── installed-templates.json       # Installed templates manifest
├── cache/
│   └── sources/{name}/                # Git clone cache per marketplace
├── templates/
│   └── flows/{category}/          # Installed flow templates (steps within each)
├── active/                            # Running flows
├── completed/                         # Finished flows
├── failed/                            # Failed flows
├── flags/                             # Runtime flags
└── guidelines/                        # Project-specific guidelines
```

## Documentation

- [Getting Started](docs/getting-started.md) - Detailed quick start guide
- [Architecture](docs/architecture.md) - System architecture deep dive
- [Examples](docs/examples.md) - More usage examples

## Roadmap

View the full interactive roadmap: [https://hmtools.github.io/zeremai/](https://hmtools.github.io/zeremai/)

### ZeremAI (Framework Plugin)
- add `stepType` with enum `spawn` (subflow) `direct` (regular step template) and also show it in the UI, think if we can also connect in case of spawn what is the flow template target so we will be able to show it also in the ui
- replace `guidelines` with `flavors` (not a must), and make it `compile` time so the flow instance files will have the flavor in it on creation so the active flow will not need to take it into account
- verification checklist for each step with (can be done by hook or by low cost model via subagent)
- change memory files from single file to multiple files
- use dynamic context injection in the `continue-flow` skill
- finish session hook - empty .session file
- improve pending-interactions - add to where each option is sending to (next step, some prev step) - framework + ui
- events - event on different life cycle acts of the flows - can be framework (global) level and template level - multiple subscriptions can be assigned to each event listener (can be also on the server app)
- hook that blocks framework file changes by the agent - so only skills using python can change them
- git managment - branches, tagging, work trees
- dynamic flows / templates
- simple `do` template / - dynamic built workflow that checks for exist steps and with final step for saving steps, guidelines and flow
- improve continuous learning step - guide it to find things so in the future everything will be one-shot, also guide it to find improvements for better token cost effective, and context management effective
- set different llm model for different steps (in config)
- change steps to be defaulted as flow template scope (related to specific template), with allowing to set global steps (maybe)
- step-level shared behaviors (previously _components) - now handled by hooks and skills
- ~~remove the view only md files~~ (DONE - JSON-only architecture implemented)
- cost analysis of flows and steps
- graphify
- triggers (ci, cd)
- use full skills frontmatter capabilities
- step executor skill
- replace template sources git with marketplaces (strongly driven by ui) git that the user can see which templates he needs to update and can install specific templates
- verif subagent (different cotnext window) as optional part of the delcaration of the step and not a dedicated step in the flow

### ZeremAI UI
- add the option of using `Channel` mcp - and not directly writing to cli
- Web-based deployment (beyond Electron)
- steps inner flow live diagrams (active-step)
- create a persist way to see which files been modified (currently we see only what in flow instance folder)
- add more super easy UX ways for reviewing flows (maybe not md)
- template creator via chat (with dynamic preview ui)

### ZeremAI Server - TBD
- Template marketplace — discover and share community templates

## Contributing

### Contributing to Official Templates

Official templates live in the [ZeremAI-marketplace](https://github.com/HMTools/ZeremAI-marketplace) repository. To contribute:

1. Fork the templates repository
2. Create or modify templates under `templates/flows/{category}/` (step definitions live as subdirectories within each template)
3. Submit a pull request

### Adding Custom Templates Locally

For local/team-specific templates, add a custom marketplace:

1. Create a git repo with the standard template structure (`templates/flows/`)
2. Add it on the Templates tab of `/flow` (Add marketplace)
3. Refresh and install the templates you need

### Template Authoring

Flow templates use parameter placeholders (`{{paramName}}`) and define steps as subdirectories within the template directory. Each step definition includes description, output, guidance, substeps, examples, and common pitfalls.

## License

MIT

---

**Built for structured, repeatable workflows with AI agents.**
