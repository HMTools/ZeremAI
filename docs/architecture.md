# ZeremAI Architecture

This document provides a detailed overview of the ZeremAI architecture, components, and how they work together.

## System Overview

The ZeremAI is a plugin-based workflow management system designed for AI agents. It provides structured, repeatable flows with persistent state management, working seamlessly with Claude Code.

## Plugin Architecture

The framework is distributed as a plugin that can be installed via marketplace or local directory:

```
zeremai/                    # Plugin root
├── .claude-plugin/plugin.json        # Claude Code plugin manifest
├── agents/                           # Auto-discovered agents
├── commands/                         # Auto-discovered commands
├── hooks/hooks.json                  # Hook configuration
├── scripts/                          # Hook and utility scripts
│   ├── template_manager.py           # Marketplace template operations
│   └── ...hook scripts...
├── skills/                           # Skills for AI discoverability
├── config/                           # Default configuration files
│   └── marketplaces.default.json
├── types/                            # TypeScript types + schema.json
└── AGENTS.md                         # Agent discovery file
```

### Component Auto-Discovery

Claude Code automatically discovers:
- **Agents**: From `agents/` directory
- **Commands**: From `commands/` directory
- **Skills**: From `skills/` directory
- **Hooks**: From `hooks/hooks.json`

## Core Components

### 1. Flow Manager

The Flow Manager is the central component that:
- Creates flows from templates
- Resolves step references
- Tracks flow state
- Updates flow files
- Manages flow lifecycle

**Location**: Defined in `commands/` directory

### 2. Templates

Templates define reusable workflows with:
- Parameter placeholders
- Step references
- Flow diagrams
- Sequential step definitions

**Location**: `~/.claude/zeremai/templates/flows/{category}/` (installed from marketplaces)

**Structure**:
```markdown
<!--
Template: Template Name
Purpose: What this template is for
Required Parameters: param1, param2
-->

# Flow: {{flowName}}
## Steps
- [ ] Step 1: Description
  - **Step**: `step-name` (resolved via UUID-based stepRef)
```

### 3. Steps

Steps are modular, self-contained definitions with:
- Description and objectives
- Expected outputs
- Detailed guidance
- Flow diagrams
- Substeps
- Examples

**Location**: Steps are subdirectories of their flow template directory (e.g., `{template-dir}/understand-context/understand-context.json`). Each step definition has a unique `id` field (UUID v4) and templates reference steps by UUID via `stepRef`.

### 4. Flow Instances

Flow instances are created from templates and contain:
- Flow file (`flow.json`) - Machine-readable state for tooling/UI
- Memory directory (`memory/`) - Topic-based files for persistent information shared across steps
- Log file (`log.json`) - Detailed execution log

**Location**: `~/.claude/zeremai/{state}/flow-{name}-{YYYYMMDD}-{shortid}/`

**States**:
- `active/` - Currently running
- `completed/` - Finished successfully
- `failed/` - Encountered errors

### 5. Subagents

The framework uses subagents for context isolation:

- **step-executor**: Executes individual flow steps. Invoked via the `step-executor-delegation` skill (`context: fork`, `agent: step-executor`). The skill content is the only task message the step-executor receives — the orchestrator cannot add extra context.
- **flow-spawner**: Creates new flows/sub-flows in isolated context

Subagent files are in `agents/` and are auto-discovered by Claude Code.

### 6. Hooks System

Hooks provide behavioral controls during flow execution:

**Hook Types**:
- `stop` / `subagentStop`: Check approval requirements before stopping
- `preToolUse`: Block tools during pending interactions, enforce log-first
- `postToolUse`: Validate flow file structure
- `beforeSubmitPrompt`: Create log-first flags

**Platform Integration**:
Scripts integrate with Claude Code's hook system:
- Environment variable: `CLAUDE_PROJECT_DIR` for project directory
- Session tracking: `session_id` for flow-session binding
- Output format: Claude Code JSON response format (`decision`/`reason`)

## Data Flow

```mermaid
graph TD
    A[User Request] --> B{Command Type}
    B -->|/zeremai new| C[Template Selection]
    B -->|/zeremai continue| D[Flow Discovery]
    
    C --> E[Parameter Collection]
    E --> F[Step Resolution]
    F --> G[Flow Creation]
    G --> H[Active Flow]
    
    D --> I[State Reading]
    I --> H
    
    H --> J[Step Execution via Subagent]
    J --> K[State Update]
    K --> L{Complete?}
    L -->|No| J
    L -->|Yes| M[Move to Completed]
    
    F --> N[Templates]
    F --> O[Steps Library]
    H --> P[Memory]
    H --> Q[Log]
```

## Step Resolution Flow

When a flow is created from a template:

1. **Template Reading**: Read template file from the flow template directory
2. **Step Resolution**: For each step with a `stepRef`:
   - `stepRef` is a UUID matching the `id` field of a step definition JSON file in a subdirectory of the template directory
   - Resolution: scan template subdirectories for step definition files with a matching `id` field (UUID-only lookup, no name-based fallback)
   - The `stepRefName` companion field provides a human-readable name (e.g., `"understand-context"`) for display only
   - Framework steps are identified by `"type": "framework-step"` in their definition and use plain UUID `stepRef` values
3. **Step Loading**: Read step JSON file and extract EmbeddedStepDefinition fields (output, guidance, substeps, flow, etc.)
4. **Context Application**: Apply context parameters from template
5. **Flow Creation**: Create flow instance in `~/.claude/zeremai/active/`

## State Management

### Flow State

Flow state is maintained in `flow.json`:

```json
{
  "type": "flow-instance",
  "id": "uuid",
  "status": "running",
  "currentState": {
    "activeStep": {
      "id": "uuid",
      "name": "Step Name",
      "actionSummary": "Working on specific task",
      "totalSubsteps": 10,
      "currentSubstep": {
        "number": 3,
        "name": "Clarify Requirements"
      }
    }
  },
  "steps": [...]
}
```

### Memory State

Memory state is maintained in the `memory/` directory with topic-based files:

```
memory/
  _cross-references.json    # Aggregated decisions and files across all topics
  context.json              # Context and requirements from understand-context step
  identified-files.json     # File identification results
  implementation-decisions.json  # Design and implementation plan data
```

Each topic file follows this structure:
```json
{
  "type": "memory-topic-file",
  "topic": "context",
  "lastUpdated": "2026-01-15T10:30:00.000Z",
  "entries": {
    "step-uuid": {
      "stepName": "Understand concept",
      "informationProduced": {},
      "decisionsMade": [],
      "filesModifiedCreated": []
    }
  }
}
```

## Integration Points

**Skills**: Auto-discovered from `skills/` directory
- `flow-new/SKILL.md` - Flow creation
- `flow-continue/SKILL.md` - Flow continuation
- `flow-state-update/SKILL.md` - State file updates
- Marketplace management via UI Settings

**Agents**: Auto-discovered from `agents/` and `AGENTS.md`
- `step-executor.md` - Step execution subagent
- `flow-spawner.md` - Flow spawning subagent

**Hooks**: Configured in `hooks/hooks.json`

**Task Tool Delegation**: Skills include instructions for using the Task tool to invoke subagents.

## File Structure

```
# Plugin (zeremai/)
.claude-plugin/plugin.json           # Claude Code manifest
agents/                              # Subagents
commands/                            # Commands
hooks/hooks.json                     # Hook configuration
scripts/                             # Hook and utility scripts
├── template_manager.py              # Marketplace template operations
├── models.py                        # Shared data models
└── ...hook scripts...
skills/
├── flow-new/SKILL.md             # Start new flow
├── flow-continue/SKILL.md        # Continue existing flow
├── flow-state-update/SKILL.md    # Update flow state
config/
└── marketplaces.default.json        # Default marketplace config
types/                               # TypeScript types + schema.json
AGENTS.md                            # Agent discovery

# Runtime Location (~/.claude/zeremai/)
~/.claude/zeremai/
├── config/
│   ├── marketplaces.json            # User's marketplace config
│   └── installed-templates.json     # Installed templates manifest
├── cache/
│   └── sources/{name}/              # Git clone cache per marketplace
├── templates/
│   └── flows/{category}/        # Installed flow templates (steps within each)
├── flags/                           # Runtime flag files
├── active/                          # Running flows
│   └── flow-{name}-{date}-{id}/
│       ├── flow.json             # Primary state
│       ├── memory/                  # Topic-based memory files
│       │   ├── _cross-references.json
│       │   └── <topic>.json
│       └── log.json                 # Execution log
├── completed/                       # Finished flows
└── failed/                          # Failed flows
```

## Design Principles

### 1. Plugin-First Architecture

The framework is distributed as a plugin for easy installation and updates:
- Marketplace distribution
- Version management
- Automatic component discovery

### 2. Plugin Architecture

Distributed as a Claude Code plugin with automatic component discovery:
- Marketplace distribution and local directory support
- Automatic agent, command, skill, and hook discovery
- Unified hook configuration

### 3. Modular Steps

Steps are self-contained and reusable:
- DRY principle
- Consistent patterns
- Easy maintenance

### 4. Persistent State

State is always persisted:
- No data loss between sessions
- Resume from any point
- Complete audit trail

### 5. Subagent Delegation

Steps are executed via the `step-executor-delegation` skill which forks into the step-executor subagent:
- **Context isolation**: Enforced by `context: fork` — the skill content is the only task message. The orchestrator cannot add extra context.
- **Clear responsibility boundaries**: The skill defines WHAT the step-executor receives. The step-executor.md defines HOW it behaves. The orchestrator handles the workflow around execution.
- **Consistent execution patterns**: All step execution goes through one skill, regardless of which orchestrator (flow-continue or flow-new) triggers it.

## Template Marketplace

Templates are distributed via git-backed marketplaces rather than bundled with the plugin. This architecture enables versioning, team sharing, per-template installation, and update detection.

### Marketplace Refresh & Install Flow

```mermaid
graph TD
    A[User opens Marketplace in UI] --> B[template_manager.py refresh]
    B --> C[Read config/marketplaces.json]
    C --> D{For each enabled marketplace}
    D --> E[Clone or pull git repo to cache/]
    E --> F[template_manager.py catalog]
    F --> G[Browse available templates in UI]
    G --> H{User selects Install}
    H --> I[template_manager.py install]
    I --> J[Copy template from cache to runtime]
    I --> K[Update installed-templates.json manifest]
    J --> L[Template available for /zeremai new]
```

### Marketplace Configuration

Marketplaces are configured in `~/.claude/zeremai/config/marketplaces.json`. Each marketplace specifies a git URL, branch, and priority.

### Cache Strategy

Each marketplace is shallow-cloned to `~/.claude/zeremai/cache/sources/{marketplace-name}/`. The cache is separate from the installed templates, so a failed refresh cannot corrupt the working set.

### Install Tracking

Installed templates are tracked in `~/.claude/zeremai/config/installed-templates.json`. Each entry records the template name, category, type, source marketplace, installation timestamp, and git commit hash. Update detection compares the installed version hash against the current cache HEAD.

## Extension Points

### Adding Custom Marketplaces

1. Create a git repo with the standard structure: `templates/flows/`
2. Open the Marketplace in the UI Settings and add the repo as a marketplace
3. Refresh and install the templates you need

### Contributing to Official Templates

Official templates are maintained in the [ZeremAI-marketplace](https://github.com/HMTools/ZeremAI-marketplace) repository. Fork, modify, and submit pull requests.

### Custom Hooks

Add custom hook scripts in `scripts/` and register them in `hooks/hooks.json`.

---

For more details, see:
- [Getting Started](getting-started.md)
- [Examples](examples.md)
