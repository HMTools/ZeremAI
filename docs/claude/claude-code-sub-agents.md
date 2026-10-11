# Claude Code: Create Custom Subagents

> **Source:** https://code.claude.com/docs/en/sub-agents
> **Captured:** 2026-02-28
> **Sections:** Built-in subagents, Quickstart, Configuration, Working with subagents, Examples

---

## Table of Contents

1. [Overview](#overview)
2. [Built-in Subagents](#built-in-subagents)
3. [Quickstart: Create Your First Subagent](#quickstart-create-your-first-subagent)
4. [Configure Subagents](#configure-subagents)
   - [/agents command](#use-the-agents-command)
   - [Scope / Storage Locations](#choose-the-subagent-scope)
   - [Writing Subagent Files](#write-subagent-files)
   - [Supported Frontmatter Fields](#supported-frontmatter-fields)
   - [Model Selection](#choose-a-model)
   - [Tool Access](#available-tools)
   - [Permission Modes](#permission-modes)
   - [Skills Preloading](#preload-skills-into-subagents)
   - [Persistent Memory](#enable-persistent-memory)
   - [Conditional Hooks](#conditional-rules-with-hooks)
   - [Disabling Subagents](#disable-specific-subagents)
   - [Hooks for Subagents](#define-hooks-for-subagents)
5. [Work with Subagents](#work-with-subagents)
   - [Automatic Delegation](#understand-automatic-delegation)
   - [Foreground vs Background](#run-subagents-in-foreground-or-background)
   - [Common Patterns](#common-patterns)
   - [Subagents vs Main Conversation](#choose-between-subagents-and-main-conversation)
   - [Context Management](#manage-subagent-context)
6. [Example Subagents](#example-subagents)

---

## Overview

Subagents are specialized AI assistants that handle specific types of tasks. Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions. When Claude encounters a task that matches a subagent's description, it delegates to that subagent, which works independently and returns results.

> **Note:** For multiple agents working in parallel and communicating with each other, see [agent teams](https://code.claude.com/docs/en/agent-teams). Subagents work within a single session; agent teams coordinate across separate sessions.

**Subagents help you:**

- **Preserve context** — keep exploration and implementation out of your main conversation
- **Enforce constraints** — limit which tools a subagent can use
- **Reuse configurations** — share subagents across projects with user-level definitions
- **Specialize behavior** — focused system prompts for specific domains
- **Control costs** — route tasks to faster, cheaper models like Haiku

Claude uses each subagent's `description` field to decide when to delegate. Write clear descriptions so Claude knows when to use each one.

---

## Built-in Subagents

Claude Code includes built-in subagents that are automatically used when appropriate. Each inherits the parent conversation's permissions with additional tool restrictions.

| Subagent | Model | Tools | Purpose |
|----------|-------|-------|---------|
| **Explore** | Haiku (fast) | Read-only | File discovery, code search, codebase exploration |
| **Plan** | Inherits | Read-only | Codebase research during plan mode |
| **General-purpose** | Inherits | All tools | Complex research, multi-step operations, code modifications |
| **Bash** | Inherits | — | Running terminal commands in a separate context |
| **statusline-setup** | Sonnet | — | Configures your status line via `/statusline` |
| **Claude Code Guide** | Haiku | — | Answers questions about Claude Code features |

**Explore** is invoked with a thoroughness level: `quick`, `medium`, or `very thorough`.

**Plan** prevents infinite nesting — subagents cannot spawn other subagents — while still gathering necessary context.

---

## Quickstart: Create Your First Subagent

Subagents are defined in Markdown files with YAML frontmatter. You can create them via the `/agents` command or manually.

### Steps

1. **Open the subagents interface**
   ```
   /agents
   ```

2. **Create a new user-level agent**
   Select **Create new agent** → **User-level**. This saves to `~/.claude/agents/` so it's available in all projects.

3. **Generate with Claude**
   Select **Generate with Claude**. Describe the subagent, e.g.:
   ```
   A code improvement agent that scans files and suggests improvements
   for readability, performance, and best practices.
   ```
   Press `e` to open in editor if you want to customize.

4. **Select tools**
   For a read-only reviewer, deselect everything except **Read-only tools**.

5. **Select model**
   Choose the model. Sonnet balances capability and speed for code analysis.

6. **Choose a color**
   Pick a background color to identify the subagent in the UI.

7. **Save and try it out** — available immediately, no restart needed:
   ```
   Use the code-improver agent to suggest improvements in this project
   ```

---

## Configure Subagents

### Use the /agents Command

The `/agents` command provides an interactive interface for managing subagents:

- View all subagents (built-in, user, project, plugin)
- Create new subagents with guided setup or Claude generation
- Edit existing configuration and tool access
- Delete custom subagents
- See which subagents are active when duplicates exist

To list all configured subagents from the CLI without an interactive session:
```bash
claude agents
```

---

### Choose the Subagent Scope

Subagents are Markdown files stored in different locations depending on scope. When multiple subagents share the same name, the higher-priority location wins.

| Location | Scope | Priority | How to create |
|----------|-------|----------|---------------|
| `--agents` CLI flag | Current session only | 1 (highest) | Pass JSON when launching |
| `.claude/agents/` | Current project | 2 | Interactive or manual |
| `~/.claude/agents/` | All your projects | 3 | Interactive or manual |
| Plugin's `agents/` directory | Where plugin is enabled | 4 (lowest) | Installed with plugins |

**Project subagents** (`.claude/agents/`) — ideal for codebase-specific agents; check into version control.

**User subagents** (`~/.claude/agents/`) — personal agents available in all projects.

**CLI-defined subagents** — pass as JSON for the current session only (useful for quick testing or automation):

```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```

The `--agents` flag accepts JSON with the same frontmatter fields as file-based subagents: `description`, `prompt`, `tools`, `disallowedTools`, `model`, `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`, and `memory`.

---

### Write Subagent Files

Subagent files use YAML frontmatter for configuration, followed by the system prompt in Markdown:

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

> **Note:** Subagents are loaded at session start. If you create a subagent by manually adding a file, restart your session or use `/agents` to load it immediately.

The frontmatter defines metadata and configuration. The body becomes the system prompt. Subagents receive only this system prompt (plus basic environment details like working directory) — not the full Claude Code system prompt.

---

### Supported Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier using lowercase letters and hyphens |
| `description` | Yes | When Claude should delegate to this subagent |
| `tools` | No | Tools the subagent can use. Inherits all tools if omitted |
| `disallowedTools` | No | Tools to deny, removed from inherited or specified list |
| `model` | No | `sonnet`, `opus`, `haiku`, or `inherit`. Defaults to `inherit` |
| `permissionMode` | No | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, or `plan` |
| `maxTurns` | No | Maximum number of agentic turns before stopping |
| `skills` | No | Skills to inject into the subagent's context at startup |
| `mcpServers` | No | MCP servers available to this subagent |
| `hooks` | No | Lifecycle hooks scoped to this subagent |
| `memory` | No | Persistent memory scope: `user`, `project`, or `local` |
| `background` | No | Set `true` to always run this subagent as a background task |
| `isolation` | No | Set `worktree` to run in a temporary git worktree |

---

### Choose a Model

The `model` field controls which AI model the subagent uses:

- `sonnet`, `opus`, `haiku` — specific model alias
- `inherit` — use the same model as the main conversation (default when omitted)

---

### Available Tools

Subagents can use any of Claude Code's internal tools. By default, they inherit all tools from the main conversation, including MCP tools.

Restrict tools using an allowlist or denylist:

```yaml
---
name: safe-researcher
description: Research agent with restricted capabilities
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
---
```

#### Restrict Which Subagents Can Be Spawned

When an agent runs as the main thread with `claude --agent`, restrict which subagent types it can spawn:

```yaml
---
name: coordinator
description: Coordinates work across specialized agents
tools: Task(worker, researcher), Read, Bash
---
```

- `Task(worker, researcher)` — allowlist: only these subagents can be spawned
- `Task` (no parentheses) — allow spawning any subagent
- Omit `Task` entirely — agent cannot spawn any subagents

To block specific agents while allowing all others, use `permissions.deny` instead.

---

### Permission Modes

The `permissionMode` field overrides how the subagent handles permission prompts:

| Mode | Behavior |
|------|----------|
| `default` | Standard permission checking with prompts |
| `acceptEdits` | Auto-accept file edits |
| `dontAsk` | Auto-deny permission prompts (explicitly allowed tools still work) |
| `bypassPermissions` | Skip all permission checks |
| `plan` | Plan mode (read-only exploration) |

> **Warning:** Use `bypassPermissions` with caution. If the parent uses `bypassPermissions`, it takes precedence and cannot be overridden.

---

### Preload Skills into Subagents

Use the `skills` field to inject skill content into a subagent's context at startup:

```yaml
---
name: api-developer
description: Implement API endpoints following team conventions
skills:
  - api-conventions
  - error-handling-patterns
---

Implement API endpoints. Follow the conventions and patterns from the preloaded skills.
```

The full content of each skill is injected — not just made available for invocation. Subagents don't inherit skills from the parent; you must list them explicitly.

---

### Enable Persistent Memory

The `memory` field gives the subagent a persistent directory that survives across conversations:

```yaml
---
name: code-reviewer
description: Reviews code for quality and best practices
memory: user
---

You are a code reviewer. As you review code, update your agent memory with
patterns, conventions, and recurring issues you discover.
```

| Scope | Location | Use when |
|-------|----------|----------|
| `user` | `~/.claude/agent-memory/<name>/` | Learnings should apply across all projects |
| `project` | `.claude/agent-memory/<name>/` | Knowledge is project-specific and shareable via version control |
| `local` | `.claude/agent-memory-local/<name>/` | Project-specific but should NOT be in version control |

When memory is enabled:
- System prompt includes instructions for reading/writing to the memory directory
- First 200 lines of `MEMORY.md` are injected into the system prompt
- Read, Write, and Edit tools are automatically enabled

**Tips:**
- `user` is the recommended default scope
- Ask the subagent to consult memory before starting: *"Review this PR, and check your memory for patterns you've seen before."*
- Ask it to update memory after completing a task to build institutional knowledge over time
- Include memory instructions directly in the subagent's markdown file for proactive maintenance

---

### Conditional Rules with Hooks

Use `PreToolUse` hooks for dynamic control over tool usage — useful when you need to allow some operations of a tool while blocking others.

Example: a subagent that only allows read-only database queries:

```yaml
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

Validation script:

```bash
#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b' > /dev/null; then
  echo "Blocked: Only SELECT queries are allowed" >&2
  exit 2
fi

exit 0
```

Exit code `2` blocks the operation and feeds the error message back to Claude.

---

### Disable Specific Subagents

Add subagents to the `deny` array in `settings.json`:

```json
{
  "permissions": {
    "deny": ["Task(Explore)", "Task(my-custom-agent)"]
  }
}
```

Or via CLI flag:

```bash
claude --disallowedTools "Task(Explore)"
```

Works for both built-in and custom subagents.

---

### Define Hooks for Subagents

Two ways to configure hooks:

1. **In the subagent's frontmatter** — run only while that subagent is active
2. **In `settings.json`** — run in the main session when subagents start or stop

#### Hooks in Subagent Frontmatter

```yaml
---
name: code-reviewer
description: Review code changes with automatic linting
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-command.sh $TOOL_INPUT"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "./scripts/run-linter.sh"
---
```

`Stop` hooks in frontmatter are automatically converted to `SubagentStop` events.

#### Project-Level Hooks for Subagent Lifecycle Events

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": "db-agent",
        "hooks": [
          { "type": "command", "command": "./scripts/setup-db-connection.sh" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          { "type": "command", "command": "./scripts/cleanup-db-connection.sh" }
        ]
      }
    ]
  }
}
```

| Event | Matcher input | When it fires |
|-------|---------------|---------------|
| `SubagentStart` | Agent type name | When a subagent begins execution |
| `SubagentStop` | Agent type name | When a subagent completes |
| `PreToolUse` | Tool name | Before the subagent uses a tool |
| `PostToolUse` | Tool name | After the subagent uses a tool |
| `Stop` | (none) | When the subagent finishes |

---

## Work with Subagents

### Understand Automatic Delegation

Claude automatically delegates tasks based on:
- The task description in your request
- The `description` field in subagent configurations
- Current context

Include phrases like **"use proactively"** in the description to encourage automatic delegation.

You can also request a specific subagent explicitly:
```
Use the test-runner subagent to fix failing tests
Have the code-reviewer subagent look at my recent changes
```

---

### Run Subagents in Foreground or Background

| Mode | Behavior |
|------|----------|
| **Foreground** | Blocks main conversation until complete. Permission prompts pass through. |
| **Background** | Runs concurrently. Permissions are pre-approved before launch. Auto-denies anything not pre-approved. |

If a background subagent fails due to missing permissions, resume it in the foreground to retry with interactive prompts.

**Controls:**
- Ask Claude to "run this in the background"
- Press **Ctrl+B** to background a running task
- Set `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` to disable all background task functionality
- Set `background: true` in frontmatter to always run as a background task

---

### Common Patterns

#### Isolate High-Volume Operations

Delegate operations that produce large output (tests, logs, docs fetching) to keep verbose output out of your main context:

```
Use a subagent to run the test suite and report only the failing tests with their error messages
```

#### Run Parallel Research

For independent investigations, spawn multiple subagents simultaneously:

```
Research the authentication, database, and API modules in parallel using separate subagents
```

> **Warning:** When subagents complete, their results return to your main conversation. Running many subagents that each return detailed results can consume significant context. For sustained parallelism, consider [agent teams](https://code.claude.com/docs/en/agent-teams).

#### Chain Subagents

For multi-step workflows, use subagents in sequence:

```
Use the code-reviewer subagent to find performance issues, then use the optimizer subagent to fix them
```

---

### Choose Between Subagents and Main Conversation

**Use the main conversation when:**
- The task needs frequent back-and-forth or iterative refinement
- Multiple phases share significant context (planning → implementation → testing)
- You're making a quick, targeted change
- Latency matters (subagents start fresh and may need time to gather context)

**Use subagents when:**
- The task produces verbose output you don't need in your main context
- You want to enforce specific tool restrictions or permissions
- The work is self-contained and can return a summary

**Consider Skills instead** when you want reusable prompts or workflows that run in the main conversation context rather than isolated subagent context.

> **Note:** Subagents cannot spawn other subagents. If your workflow requires nested delegation, use Skills or chain subagents from the main conversation.

---

### Manage Subagent Context

#### Resume Subagents

Each subagent invocation creates a new instance with fresh context. To continue an existing subagent's work:

```
Use the code-reviewer subagent to review the authentication module
[Agent completes]

Continue that code review and now analyze the authorization logic
```

Resumed subagents retain their full conversation history, including all previous tool calls, results, and reasoning.

Subagent transcripts are stored at:
```
~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl
```

**Transcript lifecycle:**
- Main conversation compaction does not affect subagent transcripts (stored separately)
- You can resume a subagent after restarting Claude Code by resuming the same session
- Transcripts are cleaned up based on `cleanupPeriodDays` setting (default: 30 days)

#### Auto-Compaction

Subagents support automatic compaction (same logic as main conversation). Default trigger: ~95% capacity. Override with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (e.g., `50` for 50%).

Compaction is logged in subagent transcript files:
```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 167189
  }
}
```

---

## Example Subagents

### Code Reviewer

Read-only subagent with limited tool access. No Edit or Write permissions.

```markdown
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation implemented
- Good test coverage
- Performance considerations addressed

Provide feedback organized by priority:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples of how to fix issues.
```

---

### Debugger

Includes Edit because fixing bugs requires modifying code. Clear workflow from diagnosis to verification.

```markdown
---
name: debugger
description: Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues.
tools: Read, Edit, Bash, Grep, Glob
---

You are an expert debugger specializing in root cause analysis.

When invoked:
1. Capture error message and stack trace
2. Identify reproduction steps
3. Isolate the failure location
4. Implement minimal fix
5. Verify solution works

Debugging flow:
- Analyze error messages and logs
- Check recent code changes
- Form and test hypotheses
- Add strategic debug logging
- Inspect variable states

For each issue, provide:
- Root cause explanation
- Evidence supporting the diagnosis
- Specific code fix
- Testing approach
- Prevention recommendations

Focus on fixing the underlying issue, not the symptoms.
```

---

### Data Scientist

Domain-specific subagent for SQL/BigQuery data analysis. Explicitly sets `model: sonnet`.

```markdown
---
name: data-scientist
description: Data analysis expert for SQL queries, BigQuery operations, and data insights. Use proactively for data analysis tasks and queries.
tools: Bash, Read, Write
model: sonnet
---

You are a data scientist specializing in SQL and BigQuery analysis.

When invoked:
1. Understand the data analysis requirement
2. Write efficient SQL queries
3. Use BigQuery command line tools (bq) when appropriate
4. Analyze and summarize results
5. Present findings clearly

Key practices:
- Write optimized SQL queries with proper filters
- Use appropriate aggregations and joins
- Include comments explaining complex logic
- Format results for readability
- Provide data-driven recommendations

For each analysis:
- Explain the query approach
- Document any assumptions
- Highlight key findings
- Suggest next steps based on data

Always ensure queries are efficient and cost-effective.
```

---

### Database Query Validator

Allows Bash access but uses a `PreToolUse` hook to permit only read-only SQL queries — finer control than the `tools` field alone.

```markdown
---
name: db-reader
description: Execute read-only database queries. Use when analyzing data or generating reports.
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---

You are a database analyst with read-only access. Execute SELECT queries to answer questions about the data.

When asked to analyze data:
1. Identify which tables contain the relevant data
2. Write efficient SELECT queries with appropriate filters
3. Present results clearly with context

You cannot modify data. If asked to INSERT, UPDATE, DELETE, or modify schema, explain that you only have read access.
```

Validation script (`./scripts/validate-readonly-query.sh`):

```bash
#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Block write operations (case-insensitive)
if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE)\b' > /dev/null; then
  echo "Blocked: Write operations not allowed. Use SELECT queries only." >&2
  exit 2
fi

exit 0
```

```bash
chmod +x ./scripts/validate-readonly-query.sh
```

---

## Best Practices

- **Design focused subagents** — each should excel at one specific task
- **Write detailed descriptions** — Claude uses the description to decide when to delegate
- **Limit tool access** — grant only necessary permissions for security and focus
- **Check into version control** — share project subagents (`.claude/agents/`) with your team
- **Use `memory: user`** for subagents that should accumulate knowledge across projects
- **Prefer `disallowedTools`** over a narrow `tools` allowlist when you only need to block a few things
- **Use hooks for conditional logic** when tool-level restrictions aren't granular enough

---

## Related Docs

- [Agent Teams](https://code.claude.com/docs/en/agent-teams) — multiple agents working in parallel across separate sessions
- [Skills](https://code.claude.com/docs/en/skills) — reusable prompts/workflows that run in the main conversation context
- [Hooks Reference](https://code.claude.com/docs/en/hooks.md) — complete hook configuration format
- [Plugins](https://code.claude.com/docs/en/plugins) — distribute subagents across teams
- [Headless / Agent SDK](https://code.claude.com/docs/en/headless) — run Claude Code programmatically in CI/CD
- [MCP Servers](https://code.claude.com/docs/en/mcp) — give subagents access to external tools and data
- [Permissions](https://code.claude.com/docs/en/permissions) — permission rules and tool-specific settings
- [CLI Reference](https://code.claude.com/docs/en/cli-reference) — `--agents` flag format and all CLI options

---

*Captured from https://code.claude.com/docs/en/sub-agents on 2026-02-28*
