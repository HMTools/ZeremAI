# Claude Code Plugins Reference

> **Source:** https://code.claude.com/docs/en/plugins-reference  
> **Captured:** March 8, 2026  
> **Sections:** Plugin components, Installation scopes, Manifest schema, Caching, Directory structure, CLI commands, Debugging, Versioning

---

## Table of Contents

1. [Plugin Components Reference](#plugin-components-reference)
   - [Skills](#skills)
   - [Agents](#agents)
   - [Hooks](#hooks)
   - [MCP Servers](#mcp-servers)
   - [LSP Servers](#lsp-servers)
2. [Plugin Installation Scopes](#plugin-installation-scopes)
3. [Plugin Manifest Schema](#plugin-manifest-schema)
   - [Complete Schema](#complete-schema)
   - [Required Fields](#required-fields)
   - [Metadata Fields](#metadata-fields)
   - [Component Path Fields](#component-path-fields)
   - [Path Behavior Rules](#path-behavior-rules)
   - [Environment Variables](#environment-variables)
4. [Plugin Caching and File Resolution](#plugin-caching-and-file-resolution)
   - [Path Traversal Limitations](#path-traversal-limitations)
   - [Working with External Dependencies](#working-with-external-dependencies)
5. [Plugin Directory Structure](#plugin-directory-structure)
   - [Standard Plugin Layout](#standard-plugin-layout)
   - [File Locations Reference](#file-locations-reference)
6. [CLI Commands Reference](#cli-commands-reference)
   - [plugin install](#plugin-install)
   - [plugin uninstall](#plugin-uninstall)
   - [plugin enable](#plugin-enable)
   - [plugin disable](#plugin-disable)
   - [plugin update](#plugin-update)
7. [Debugging and Development Tools](#debugging-and-development-tools)
   - [Debugging Commands](#debugging-commands)
   - [Common Issues](#common-issues)
   - [Example Error Messages](#example-error-messages)
   - [Hook Troubleshooting](#hook-troubleshooting)
   - [MCP Server Troubleshooting](#mcp-server-troubleshooting)
   - [Directory Structure Mistakes](#directory-structure-mistakes)
8. [Distribution and Versioning Reference](#distribution-and-versioning-reference)
   - [Version Management](#version-management)
9. [See Also](#see-also)

---

## Plugin Components Reference

A **plugin** is a self-contained directory of components that extends Claude Code with custom functionality. Plugin components include skills, agents, hooks, MCP servers, and LSP servers.

### Skills

Plugins add skills to Claude Code, creating `/name` shortcuts that you or Claude can invoke.

**Location**: `skills/` or `commands/` directory in plugin root

**File format**: Skills are directories with `SKILL.md`; commands are simple markdown files

**Skill structure**:

```
skills/
├── pdf-processor/
│   ├── SKILL.md
│   ├── reference.md (optional)
│   └── scripts/ (optional)
└── code-reviewer/
    └── SKILL.md
```

**Integration behavior**:
- Skills and commands are automatically discovered when the plugin is installed
- Claude can invoke them automatically based on task context
- Skills can include supporting files alongside SKILL.md

### Agents

Plugins can provide specialized subagents for specific tasks that Claude can invoke automatically when appropriate.

**Location**: `agents/` directory in plugin root

**File format**: Markdown files describing agent capabilities

**Agent structure**:

```markdown
---
name: agent-name
description: What this agent specializes in and when Claude should invoke it
---

Detailed system prompt for the agent describing its role, expertise, and behavior.
```

**Integration points**:
- Agents appear in the `/agents` interface
- Claude can invoke agents automatically based on task context
- Agents can be invoked manually by users
- Plugin agents work alongside built-in Claude agents

### Hooks

Plugins can provide event handlers that respond to Claude Code events automatically.

**Location**: `hooks/hooks.json` in plugin root, or inline in plugin.json

**Format**: JSON configuration with event matchers and actions

**Hook configuration**:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format-code.sh"
          }
        ]
      }
    ]
  }
}
```

**Available events**:

| Event | Description |
|-------|-------------|
| `PreToolUse` | Before Claude uses any tool |
| `PostToolUse` | After Claude successfully uses any tool |
| `PostToolUseFailure` | After Claude tool execution fails |
| `PermissionRequest` | When a permission dialog is shown |
| `UserPromptSubmit` | When user submits a prompt |
| `Notification` | When Claude Code sends notifications |
| `Stop` | When Claude attempts to stop |
| `SubagentStart` | When a subagent is started |
| `SubagentStop` | When a subagent attempts to stop |
| `SessionStart` | At the beginning of sessions |
| `SessionEnd` | At the end of sessions |
| `TeammateIdle` | When an agent team teammate is about to go idle |
| `TaskCompleted` | When a task is being marked as completed |
| `PreCompact` | Before conversation history is compacted |

**Hook types**:
- `command`: Execute shell commands or scripts
- `prompt`: Evaluate a prompt with an LLM (uses `$ARGUMENTS` placeholder for context)
- `agent`: Run an agentic verifier with tools for complex verification tasks

### MCP Servers

Plugins can bundle Model Context Protocol (MCP) servers to connect Claude Code with external tools and services.

**Location**: `.mcp.json` in plugin root, or inline in plugin.json

**Format**: Standard MCP server configuration

**MCP server configuration**:

```json
{
  "mcpServers": {
    "plugin-database": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": {
        "DB_PATH": "${CLAUDE_PLUGIN_ROOT}/data"
      }
    },
    "plugin-api-client": {
      "command": "npx",
      "args": ["@company/mcp-server", "--plugin-mode"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

**Integration behavior**:
- Plugin MCP servers start automatically when the plugin is enabled
- Servers appear as standard MCP tools in Claude's toolkit
- Server capabilities integrate seamlessly with Claude's existing tools
- Plugin servers can be configured independently of user MCP servers

### LSP Servers

Plugins can provide [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) (LSP) servers to give Claude real-time code intelligence while working on your codebase.

LSP integration provides:
- **Instant diagnostics**: Claude sees errors and warnings immediately after each edit
- **Code navigation**: go to definition, find references, and hover information
- **Language awareness**: type information and documentation for code symbols

**Location**: `.lsp.json` in plugin root, or inline in `plugin.json`

**Format**: JSON configuration mapping language server names to their configurations

**`.lsp.json` file format**:

```json
{
  "go": {
    "command": "gopls",
    "args": ["serve"],
    "extensionToLanguage": {
      ".go": "go"
    }
  }
}
```

**Inline in `plugin.json`**:

```json
{
  "name": "my-plugin",
  "lspServers": {
    "go": {
      "command": "gopls",
      "args": ["serve"],
      "extensionToLanguage": {
        ".go": "go"
      }
    }
  }
}
```

**Required fields:**

| Field | Description |
|-------|-------------|
| `command` | The LSP binary to execute (must be in PATH) |
| `extensionToLanguage` | Maps file extensions to language identifiers |

**Optional fields:**

| Field | Description |
|-------|-------------|
| `args` | Command-line arguments for the LSP server |
| `transport` | Communication transport: `stdio` (default) or `socket` |
| `env` | Environment variables to set when starting the server |
| `initializationOptions` | Options passed to the server during initialization |
| `settings` | Settings passed via `workspace/didChangeConfiguration` |
| `workspaceFolder` | Workspace folder path for the server |
| `startupTimeout` | Max time to wait for server startup (milliseconds) |
| `shutdownTimeout` | Max time to wait for graceful shutdown (milliseconds) |
| `restartOnCrash` | Whether to automatically restart the server if it crashes |
| `maxRestarts` | Maximum number of restart attempts before giving up |

> **Note:** You must install the language server binary separately. LSP plugins configure how Claude Code connects to a language server, but they don't include the server itself.

**Available LSP plugins:**

| Plugin | Language server | Install command |
|--------|-----------------|-----------------|
| `pyright-lsp` | Pyright (Python) | `pip install pyright` or `npm install -g pyright` |
| `typescript-lsp` | TypeScript Language Server | `npm install -g typescript-language-server typescript` |
| `rust-lsp` | rust-analyzer | [See rust-analyzer installation](https://rust-analyzer.github.io/manual.html#installation) |

---

## Plugin Installation Scopes

When you install a plugin, you choose a **scope** that determines where the plugin is available and who else can use it:

| Scope | Settings file | Use case |
|-------|---------------|----------|
| `user` | `~/.claude/settings.json` | Personal plugins available across all projects (default) |
| `project` | `.claude/settings.json` | Team plugins shared via version control |
| `local` | `.claude/settings.local.json` | Project-specific plugins, gitignored |
| `managed` | Managed settings | Managed plugins (read-only, update only) |

---

## Plugin Manifest Schema

The `.claude-plugin/plugin.json` file defines your plugin's metadata and configuration.

The manifest is optional. If omitted, Claude Code auto-discovers components in default locations and derives the plugin name from the directory name. Use a manifest when you need to provide metadata or custom component paths.

### Complete Schema

```json
{
  "name": "plugin-name",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "commands": ["./custom/commands/special.md"],
  "agents": "./custom/agents/",
  "skills": "./custom/skills/",
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "outputStyles": "./styles/",
  "lspServers": "./.lsp.json"
}
```

### Required Fields

If you include a manifest, `name` is the only required field.

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | string | Unique identifier (kebab-case, no spaces) | `"deployment-tools"` |

This name is used for namespacing components. For example, in the UI, the agent `agent-creator` for the plugin with name `plugin-dev` will appear as `plugin-dev:agent-creator`.

### Metadata Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `version` | string | Semantic version | `"2.1.0"` |
| `description` | string | Brief explanation of plugin purpose | `"Deployment automation tools"` |
| `author` | object | Author information | `{"name": "Dev Team", "email": "dev@company.com"}` |
| `homepage` | string | Documentation URL | `"https://docs.example.com"` |
| `repository` | string | Source code URL | `"https://github.com/user/plugin"` |
| `license` | string | License identifier | `"MIT"`, `"Apache-2.0"` |
| `keywords` | array | Discovery tags | `["deployment", "ci-cd"]` |

### Component Path Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `commands` | string\|array | Additional command files/directories | `"./custom/cmd.md"` or `["./cmd1.md"]` |
| `agents` | string\|array | Additional agent files | `"./custom/agents/reviewer.md"` |
| `skills` | string\|array | Additional skill directories | `"./custom/skills/"` |
| `hooks` | string\|array\|object | Hook config paths or inline config | `"./my-extra-hooks.json"` |
| `mcpServers` | string\|array\|object | MCP config paths or inline config | `"./my-extra-mcp-config.json"` |
| `outputStyles` | string\|array | Additional output style files/directories | `"./styles/"` |
| `lspServers` | string\|array\|object | LSP configs for code intelligence | `"./.lsp.json"` |

### Path Behavior Rules

**Important**: Custom paths supplement default directories - they don't replace them.

- If `commands/` exists, it's loaded in addition to custom command paths
- All paths must be relative to plugin root and start with `./`
- Commands from custom paths use the same naming and namespacing rules
- Multiple paths can be specified as arrays for flexibility

**Path examples**:

```json
{
  "commands": [
    "./specialized/deploy.md",
    "./utilities/batch-flow.md"
  ],
  "agents": [
    "./custom-agents/reviewer.md",
    "./custom-agents/tester.md"
  ]
}
```

### Environment Variables

**`${CLAUDE_PLUGIN_ROOT}`**: Contains the absolute path to your plugin directory. Use this in hooks, MCP servers, and scripts to ensure correct paths regardless of installation location.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/flow.sh"
          }
        ]
      }
    ]
  }
}
```

---

## Plugin Caching and File Resolution

Plugins are specified in one of two ways:
- Through `claude --plugin-dir`, for the duration of a session.
- Through a marketplace, installed for future sessions.

For security and verification purposes, Claude Code copies *marketplace* plugins to the user's local **plugin cache** (`~/.claude/plugins/cache`) rather than using them in-place.

### Path Traversal Limitations

Installed plugins cannot reference files outside their directory. Paths that traverse outside the plugin root (such as `../shared-utils`) will not work after installation because those external files are not copied to the cache.

### Working with External Dependencies

If your plugin needs to access files outside its directory, you can create symbolic links to external files within your plugin directory. Symlinks are honored during the copy flow:

```bash
# Inside your plugin directory
ln -s /path/to/shared-utils ./shared-utils
```

The symlinked content will be copied into the plugin cache.

---

## Plugin Directory Structure

### Standard Plugin Layout

A complete plugin follows this structure:

```
enterprise-plugin/
├── .claude-plugin/           # Metadata directory (optional)
│   └── plugin.json             # plugin manifest
├── commands/                 # Default command location
│   ├── status.md
│   └── logs.md
├── agents/                   # Default agent location
│   ├── security-reviewer.md
│   ├── performance-tester.md
│   └── compliance-checker.md
├── skills/                   # Agent Skills
│   ├── code-reviewer/
│   │   └── SKILL.md
│   └── pdf-processor/
│       ├── SKILL.md
│       └── scripts/
├── hooks/                    # Hook configurations
│   ├── hooks.json           # Main hook config
│   └── security-hooks.json  # Additional hooks
├── settings.json            # Default settings for the plugin
├── .mcp.json                # MCP server definitions
├── .lsp.json                # LSP server configurations
├── scripts/                 # Hook and utility scripts
│   ├── security-scan.sh
│   ├── format-code.py
│   └── deploy.js
├── LICENSE                  # License file
└── CHANGELOG.md             # Version history
```

> **Warning:** The `.claude-plugin/` directory contains the `plugin.json` file. All other directories (commands/, agents/, skills/, hooks/) must be at the plugin root, not inside `.claude-plugin/`.

### File Locations Reference

| Component | Default Location | Purpose |
|-----------|------------------|---------|
| **Manifest** | `.claude-plugin/plugin.json` | Plugin metadata and configuration (optional) |
| **Commands** | `commands/` | Skill Markdown files (legacy; use `skills/` for new skills) |
| **Agents** | `agents/` | Subagent Markdown files |
| **Skills** | `skills/` | Skills with `<name>/SKILL.md` structure |
| **Hooks** | `hooks/hooks.json` | Hook configuration |
| **MCP servers** | `.mcp.json` | MCP server definitions |
| **LSP servers** | `.lsp.json` | Language server configurations |
| **Settings** | `settings.json` | Default configuration (only `agent` settings currently supported) |

---

## CLI Commands Reference

Claude Code provides CLI commands for non-interactive plugin management, useful for scripting and automation.

### plugin install

Install a plugin from available marketplaces.

```bash
claude plugin install <plugin> [options]
```

**Arguments:**
- `<plugin>`: Plugin name or `plugin-name@marketplace-name` for a specific marketplace

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --scope <scope>` | Installation scope: `user`, `project`, or `local` | `user` |
| `-h, --help` | Display help for command | |

**Examples:**

```bash
# Install to user scope (default)
claude plugin install formatter@my-marketplace

# Install to project scope (shared with team)
claude plugin install formatter@my-marketplace --scope project

# Install to local scope (gitignored)
claude plugin install formatter@my-marketplace --scope local
```

### plugin uninstall

Remove an installed plugin.

```bash
claude plugin uninstall <plugin> [options]
```

**Arguments:**
- `<plugin>`: Plugin name or `plugin-name@marketplace-name`

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --scope <scope>` | Uninstall from scope: `user`, `project`, or `local` | `user` |
| `-h, --help` | Display help for command | |

**Aliases:** `remove`, `rm`

### plugin enable

Enable a disabled plugin.

```bash
claude plugin enable <plugin> [options]
```

**Arguments:**
- `<plugin>`: Plugin name or `plugin-name@marketplace-name`

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --scope <scope>` | Scope to enable: `user`, `project`, or `local` | `user` |
| `-h, --help` | Display help for command | |

### plugin disable

Disable a plugin without uninstalling it.

```bash
claude plugin disable <plugin> [options]
```

**Arguments:**
- `<plugin>`: Plugin name or `plugin-name@marketplace-name`

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --scope <scope>` | Scope to disable: `user`, `project`, or `local` | `user` |
| `-h, --help` | Display help for command | |

### plugin update

Update a plugin to the latest version.

```bash
claude plugin update <plugin> [options]
```

**Arguments:**
- `<plugin>`: Plugin name or `plugin-name@marketplace-name`

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --scope <scope>` | Scope to update: `user`, `project`, `local`, or `managed` | `user` |
| `-h, --help` | Display help for command | |

---

## Debugging and Development Tools

### Debugging Commands

Use `claude --debug` (or `/debug` within the TUI) to see plugin loading details:

This shows:
- Which plugins are being loaded
- Any errors in plugin manifests
- Command, agent, and hook registration
- MCP server initialization

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Plugin not loading | Invalid `plugin.json` | Validate JSON syntax with `claude plugin validate` or `/plugin validate` |
| Commands not appearing | Wrong directory structure | Ensure `commands/` at root, not in `.claude-plugin/` |
| Hooks not firing | Script not executable | Run `chmod +x script.sh` |
| MCP server fails | Missing `${CLAUDE_PLUGIN_ROOT}` | Use variable for all plugin paths |
| Path errors | Absolute paths used | All paths must be relative and start with `./` |
| LSP `Executable not found in $PATH` | Language server not installed | Install the binary (e.g., `npm install -g typescript-language-server typescript`) |

### Example Error Messages

**Manifest validation errors**:
- `Invalid JSON syntax: Unexpected token } in JSON at position 142`: check for missing commas, extra commas, or unquoted strings
- `Plugin has an invalid manifest file at .claude-plugin/plugin.json. Validation errors: name: Required`: a required field is missing
- `Plugin has a corrupt manifest file at .claude-plugin/plugin.json. JSON parse error: ...`: JSON syntax error

**Plugin loading errors**:
- `Warning: No commands found in plugin my-plugin custom directory: ./cmds. Expected .md files or SKILL.md in subdirectories.`: command path exists but contains no valid command files
- `Plugin directory not found at path: ./plugins/my-plugin. Check that the marketplace entry has the correct path.`: the `source` path in marketplace.json points to a non-existent directory
- `Plugin my-plugin has conflicting manifests: both plugin.json and marketplace entry specify components.`: remove duplicate component definitions or remove `strict: false` in marketplace entry

### Hook Troubleshooting

**Hook script not executing**:

1. Check the script is executable: `chmod +x ./scripts/your-script.sh`
2. Verify the shebang line: First line should be `#!/bin/bash` or `#!/usr/bin/env bash`
3. Check the path uses `${CLAUDE_PLUGIN_ROOT}`: `"command": "${CLAUDE_PLUGIN_ROOT}/scripts/your-script.sh"`
4. Test the script manually: `./scripts/your-script.sh`

**Hook not triggering on expected events**:

1. Verify the event name is correct (case-sensitive): `PostToolUse`, not `postToolUse`
2. Check the matcher pattern matches your tools: `"matcher": "Write|Edit"` for file operations
3. Confirm the hook type is valid: `command`, `prompt`, or `agent`

### MCP Server Troubleshooting

**Server not starting**:

1. Check the command exists and is executable
2. Verify all paths use `${CLAUDE_PLUGIN_ROOT}` variable
3. Check the MCP server logs: `claude --debug` shows initialization errors
4. Test the server manually outside of Claude Code

**Server tools not appearing**:

1. Ensure the server is properly configured in `.mcp.json` or `plugin.json`
2. Verify the server implements the MCP protocol correctly
3. Check for connection timeouts in debug output

### Directory Structure Mistakes

**Symptoms**: Plugin loads but components (commands, agents, hooks) are missing.

**Correct structure**: Components must be at the plugin root, not inside `.claude-plugin/`. Only `plugin.json` belongs in `.claude-plugin/`.

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json      ← Only manifest here
├── commands/            ← At root level
├── agents/              ← At root level
└── hooks/               ← At root level
```

If your components are inside `.claude-plugin/`, move them to the plugin root.

**Debug checklist**:

1. Run `claude --debug` and look for "loading plugin" messages
2. Check that each component directory is listed in the debug output
3. Verify file permissions allow reading the plugin files

---

## Distribution and Versioning Reference

### Version Management

Follow semantic versioning for plugin releases:

```json
{
  "name": "my-plugin",
  "version": "2.1.0"
}
```

**Version format**: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (incompatible API changes)
- **MINOR**: New features (backward-compatible additions)
- **PATCH**: Bug fixes (backward-compatible fixes)

**Best practices**:

- Start at `1.0.0` for your first stable release
- Update the version in `plugin.json` before distributing changes
- Document changes in a `CHANGELOG.md` file
- Use pre-release versions like `2.0.0-beta.1` for testing

> **Warning:** Claude Code uses the version to determine whether to update your plugin. If you change your plugin's code but don't bump the version in `plugin.json`, your plugin's existing users won't see your changes due to caching.
>
> If your plugin is within a marketplace directory, you can manage the version through `marketplace.json` instead and omit the `version` field from `plugin.json`.

---

## See Also

- [Plugins](https://code.claude.com/docs/en/plugins) - Tutorials and practical usage
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) - Creating and managing marketplaces
- [Skills](https://code.claude.com/docs/en/skills) - Skill development details
- [Subagents](https://code.claude.com/docs/en/sub-agents) - Agent configuration and capabilities
- [Hooks](https://code.claude.com/docs/en/hooks) - Event handling and automation
- [MCP](https://code.claude.com/docs/en/mcp) - External tool integration
- [Settings](https://code.claude.com/docs/en/settings) - Configuration options for plugins

---

*This summary was automatically generated from https://code.claude.com/docs/en/plugins-reference*
