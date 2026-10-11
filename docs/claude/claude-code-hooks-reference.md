# Claude Code Hooks Reference

> **Source:** https://code.claude.com/docs/en/hooks
> **Captured:** 2026-02-21
> **Scope:** Full hooks reference page

---

## Table of Contents

1. [Hook Lifecycle](#hook-lifecycle)
2. [Configuration](#configuration)
   - [Hook Locations](#hook-locations)
   - [Matcher Patterns](#matcher-patterns)
   - [Hook Handler Fields](#hook-handler-fields)
   - [Reference Scripts by Path](#reference-scripts-by-path)
   - [Hooks in Skills and Agents](#hooks-in-skills-and-agents)
   - [The /hooks Menu](#the-hooks-menu)
   - [Disable or Remove Hooks](#disable-or-remove-hooks)
3. [Hook Input and Output](#hook-input-and-output)
   - [Common Input Fields](#common-input-fields)
   - [Exit Code Output](#exit-code-output)
   - [JSON Output](#json-output)
   - [Decision Control](#decision-control)
4. [Hook Events](#hook-events)
   - [SessionStart](#sessionstart)
   - [UserPromptSubmit](#userpromptsubmit)
   - [PreToolUse](#pretooluse)
   - [PermissionRequest](#permissionrequest)
   - [PostToolUse](#posttooluse)
   - [PostToolUseFailure](#posttoolusefailure)
   - [Notification](#notification)
   - [SubagentStart](#subagentstart)
   - [SubagentStop](#subagentstop)
   - [Stop](#stop)
   - [TeammateIdle](#teammateidle)
   - [TaskCompleted](#taskcompleted)
   - [ConfigChange](#configchange)
   - [PreCompact](#precompact)
   - [SessionEnd](#sessionend)
5. [Prompt-Based Hooks](#prompt-based-hooks)
6. [Agent-Based Hooks](#agent-based-hooks)
7. [Async Hooks](#async-hooks)
8. [Security Considerations](#security-considerations)
9. [Debug Hooks](#debug-hooks)

---

## Hook Lifecycle

Hooks are user-defined shell commands or LLM prompts that execute automatically at specific points in Claude Code's lifecycle. When an event fires and a matcher matches, Claude Code passes JSON context about the event to your hook handler via stdin.

| Event | When it fires |
|:------|:--------------|
| `SessionStart` | When a session begins or resumes |
| `UserPromptSubmit` | When you submit a prompt, before Claude flows it |
| `PreToolUse` | Before a tool call executes. Can block it |
| `PermissionRequest` | When a permission dialog appears |
| `PostToolUse` | After a tool call succeeds |
| `PostToolUseFailure` | After a tool call fails |
| `Notification` | When Claude Code sends a notification |
| `SubagentStart` | When a subagent is spawned |
| `SubagentStop` | When a subagent finishes |
| `Stop` | When Claude finishes responding |
| `TeammateIdle` | When an agent team teammate is about to go idle |
| `TaskCompleted` | When a task is being marked as completed |
| `ConfigChange` | When a configuration file changes during a session |
| `PreCompact` | Before context compaction |
| `SessionEnd` | When a session terminates |

### How a Hook Resolves

Example: a `PreToolUse` hook that blocks destructive shell commands.

**Configuration:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/block-rm.sh"
          }
        ]
      }
    ]
  }
}
```

**Script (`block-rm.sh`):**
```bash
#!/bin/bash
COMMAND=$(jq -r '.tool_input.command')

if echo "$COMMAND" | grep -q 'rm -rf'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Destructive command blocked by hook"
    }
  }'
else
  exit 0  # allow the command
fi
```

**Resolution flow** (for `Bash "rm -rf /tmp/build"`):
1. `PreToolUse` event fires → JSON sent to hook on stdin
2. Matcher `"Bash"` matches → `block-rm.sh` runs
3. Script finds `rm -rf` → prints deny decision to stdout
4. Claude Code reads decision → blocks the tool call

---

## Configuration

Hooks are defined in JSON settings files with three levels of nesting:
1. Choose a **hook event** (`PreToolUse`, `Stop`, etc.)
2. Add a **matcher group** to filter when it fires
3. Define one or more **hook handlers** to run when matched

### Hook Locations

| Location | Scope | Shareable |
|:---------|:------|:----------|
| `~/.claude/settings.json` | All your projects | No, local to your machine |
| `.claude/settings.json` | Single project | Yes, committable |
| `.claude/settings.local.json` | Single project | No, gitignored |
| Managed policy settings | Organization-wide | Yes, admin-controlled |
| Plugin `hooks/hooks.json` | When plugin is enabled | Yes, bundled with plugin |
| Skill/agent frontmatter | While component is active | Yes, in component file |

### Matcher Patterns

The `matcher` field is a regex string. Use `"*"`, `""`, or omit it entirely to match all occurrences.

| Event | What the matcher filters | Example values |
|:------|:-------------------------|:---------------|
| `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest` | tool name | `Bash`, `Edit\|Write`, `mcp__.*` |
| `SessionStart` | how session started | `startup`, `resume`, `clear`, `compact` |
| `SessionEnd` | why session ended | `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other` |
| `Notification` | notification type | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |
| `SubagentStart` / `SubagentStop` | agent type | `Bash`, `Explore`, `Plan`, or custom names |
| `PreCompact` | what triggered compaction | `manual`, `auto` |
| `ConfigChange` | configuration source | `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` |
| `UserPromptSubmit`, `Stop`, `TeammateIdle`, `TaskCompleted` | no matcher support | always fires |

**MCP tool matching** — MCP tools follow the pattern `mcp__<server>__<tool>`:
- `mcp__memory__.*` → all tools from the `memory` server
- `mcp__.*__write.*` → any "write" tool from any server

### Hook Handler Fields

Three handler types:
- **Command** (`type: "command"`) — run a shell command
- **Prompt** (`type: "prompt"`) — single-turn LLM evaluation returning a yes/no decision
- **Agent** (`type: "agent"`) — multi-turn subagent with tool access

#### Common Fields (all types)

| Field | Required | Description |
|:------|:---------|:------------|
| `type` | yes | `"command"`, `"prompt"`, or `"agent"` |
| `timeout` | no | Seconds before canceling (defaults: 600 command, 30 prompt, 60 agent) |
| `statusMessage` | no | Custom spinner message while hook runs |
| `once` | no | If `true`, runs only once per session (skills only) |

#### Command Hook Fields

| Field | Required | Description |
|:------|:---------|:------------|
| `command` | yes | Shell command to execute |
| `async` | no | If `true`, runs in background without blocking |

#### Prompt and Agent Hook Fields

| Field | Required | Description |
|:------|:---------|:------------|
| `prompt` | yes | Prompt text; use `$ARGUMENTS` as placeholder for hook input JSON |
| `model` | no | Model to use (defaults to a fast model) |

All matching hooks run in parallel; identical handlers are deduplicated. Handlers run in the current directory with Claude Code's environment. `$CLAUDE_CODE_REMOTE` is `"true"` in remote web environments.

### Reference Scripts by Path

- `$CLAUDE_PROJECT_DIR` — project root (wrap in quotes for paths with spaces)
- `${CLAUDE_PLUGIN_ROOT}` — plugin's root directory

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/check-style.sh"
          }
        ]
      }
    ]
  }
}
```

### Hooks in Skills and Agents

Hooks can be defined in skill/agent YAML frontmatter. They are scoped to the component's lifecycle. For subagents, `Stop` hooks are automatically converted to `SubagentStop`.

```yaml
---
name: secure-operations
description: Perform operations with security checks
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
---
```

### The /hooks Menu

Type `/hooks` in Claude Code to open the interactive hooks manager. Each hook is labeled with its source:
- `[User]` — from `~/.claude/settings.json`
- `[Project]` — from `.claude/settings.json`
- `[Local]` — from `.claude/settings.local.json`
- `[Plugin]` — from a plugin's `hooks/hooks.json`, read-only

### Disable or Remove Hooks

- **Remove**: delete its entry from settings JSON, or use `/hooks` menu
- **Disable all**: set `"disableAllHooks": true` in settings (cannot disable managed hooks at user/project level)
- **Note**: direct edits to hook files don't take effect immediately — Claude Code snapshots hooks at startup and requires review in `/hooks` before mid-session changes apply

---

## Hook Input and Output

### Common Input Fields

All hook events receive these via stdin as JSON:

| Field | Description |
|:------|:------------|
| `session_id` | Current session identifier |
| `transcript_path` | Path to conversation JSON |
| `cwd` | Current working directory |
| `permission_mode` | `"default"`, `"plan"`, `"acceptEdits"`, `"dontAsk"`, or `"bypassPermissions"` |
| `hook_event_name` | Name of the event that fired |

### Exit Code Output

| Exit code | Meaning |
|:----------|:--------|
| `0` | Success — Claude Code parses stdout for JSON output |
| `2` | Blocking error — stderr text fed back to Claude; blocks action where applicable |
| Other | Non-blocking error — stderr shown in verbose mode; execution continues |

#### Exit Code 2 Behavior Per Event

| Hook event | Can block? | What happens on exit 2 |
|:-----------|:-----------|:-----------------------|
| `PreToolUse` | Yes | Blocks the tool call |
| `PermissionRequest` | Yes | Denies the permission |
| `UserPromptSubmit` | Yes | Blocks prompt and erases it |
| `Stop` | Yes | Prevents Claude from stopping |
| `SubagentStop` | Yes | Prevents subagent from stopping |
| `TeammateIdle` | Yes | Teammate continues working |
| `TaskCompleted` | Yes | Task not marked complete |
| `ConfigChange` | Yes | Config change not applied |
| `PostToolUse` | No | Shows stderr to Claude (tool already ran) |
| `PostToolUseFailure` | No | Shows stderr to Claude |
| `Notification` | No | Shows stderr to user only |
| `SubagentStart` | No | Shows stderr to user only |
| `SessionStart` | No | Shows stderr to user only |
| `SessionEnd` | No | Shows stderr to user only |
| `PreCompact` | No | Shows stderr to user only |

### JSON Output

Exit 0 and print a JSON object to stdout for structured control. **Choose one approach: exit codes OR JSON — not both.**

| Field | Default | Description |
|:------|:--------|:------------|
| `continue` | `true` | If `false`, Claude stops processing entirely |
| `stopReason` | none | Message shown to user when `continue` is `false` |
| `suppressOutput` | `false` | If `true`, hides stdout from verbose mode |
| `systemMessage` | none | Warning message shown to user |

Stop Claude entirely:
```json
{ "continue": false, "stopReason": "Build failed, fix errors before continuing" }
```

### Decision Control

| Events | Decision pattern | Key fields |
|:-------|:----------------|:-----------|
| `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStop`, `ConfigChange` | Top-level `decision` | `decision: "block"`, `reason` |
| `TeammateIdle`, `TaskCompleted` | Exit code only | Exit 2 blocks, stderr as feedback |
| `PreToolUse` | `hookSpecificOutput` | `permissionDecision` (allow/deny/ask), `permissionDecisionReason` |
| `PermissionRequest` | `hookSpecificOutput` | `decision.behavior` (allow/deny) |

---

## Hook Events

### SessionStart

Fires when Claude Code starts or resumes a session. Keep these hooks fast.

**Matcher values:**
| Value | Fires when |
|:------|:-----------|
| `startup` | New session |
| `resume` | `--resume`, `--continue`, or `/resume` |
| `clear` | `/clear` |
| `compact` | Auto or manual compaction |

**Input (additional fields):** `source`, `model`, optional `agent_type`

```json
{
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "claude-sonnet-4-6"
}
```

**Decision control:**
- Stdout text added as context for Claude
- `additionalContext` in `hookSpecificOutput` for discrete context injection

**Persist environment variables** via `CLAUDE_ENV_FILE`:
```bash
#!/bin/bash
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export NODE_ENV=production' >> "$CLAUDE_ENV_FILE"
  echo 'export DEBUG_LOG=true' >> "$CLAUDE_ENV_FILE"
fi
exit 0
```

---

### UserPromptSubmit

Fires when the user submits a prompt, before Claude flows it. No matcher support — always fires.

**Input (additional fields):** `prompt` — the text submitted

```json
{
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to calculate factorial"
}
```

**Decision control:**
- Plain stdout (non-JSON) → added as context shown in transcript
- `additionalContext` in JSON → added more discretely
- `decision: "block"` → blocks prompt and erases it from context

```json
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "My additional context here"
  }
}
```

---

### PreToolUse

Fires after Claude creates tool parameters and before the tool call is processed.

**Matched tool names:** `Bash`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Task`, `WebFetch`, `WebSearch`, and MCP tools.

**Key tool input fields:**

| Tool | Key Fields |
|:-----|:-----------|
| `Bash` | `command`, `description`, `timeout`, `run_in_background` |
| `Write` | `file_path`, `content` |
| `Edit` | `file_path`, `old_string`, `new_string`, `replace_all` |
| `Read` | `file_path`, `offset`, `limit` |
| `Glob` | `pattern`, `path` |
| `Grep` | `pattern`, `path`, `glob`, `output_mode`, `-i`, `multiline` |
| `WebFetch` | `url`, `prompt` |
| `WebSearch` | `query`, `allowed_domains`, `blocked_domains` |
| `Task` | `prompt`, `description`, `subagent_type`, `model` |

**Decision control** — uses `hookSpecificOutput` (NOT top-level `decision`):

| Field | Description |
|:------|:------------|
| `permissionDecision` | `"allow"` bypasses permissions, `"deny"` blocks, `"ask"` prompts user |
| `permissionDecisionReason` | Shown to user (allow/ask) or Claude (deny) |
| `updatedInput` | Modifies tool input before execution |
| `additionalContext` | Added to Claude's context before execution |

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Database writes are not allowed"
  }
}
```

> **Note:** The deprecated top-level `decision`/`reason` fields map `"approve"` → `"allow"` and `"block"` → `"deny"`. Use `hookSpecificOutput` going forward.

---

### PermissionRequest

Fires when a permission dialog is about to be shown to the user. Matches on tool name (same as PreToolUse).

**Input (additional fields):** `tool_name`, `tool_input`, optional `permission_suggestions` array

```json
{
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf node_modules" },
  "permission_suggestions": [
    { "type": "toolAlwaysAllow", "tool": "Bash" }
  ]
}
```

**Decision control** — uses `hookSpecificOutput`:

| Field | Description |
|:------|:------------|
| `behavior` | `"allow"` grants permission, `"deny"` denies it |
| `updatedInput` | (allow only) Modifies tool input before execution |
| `updatedPermissions` | (allow only) Applies "always allow" rule |
| `message` | (deny only) Tells Claude why permission was denied |
| `interrupt` | (deny only) If `true`, stops Claude |

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedInput": { "command": "npm run lint" }
    }
  }
}
```

---

### PostToolUse

Fires immediately after a tool completes successfully. Matches on tool name.

**Input (additional fields):** `tool_name`, `tool_input`, `tool_response`, `tool_use_id`

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.txt", "content": "..." },
  "tool_response": { "filePath": "/path/to/file.txt", "success": true },
  "tool_use_id": "toolu_01ABC123..."
}
```

**Decision control:**

| Field | Description |
|:------|:------------|
| `decision` | `"block"` prompts Claude with the reason |
| `reason` | Shown to Claude when blocked |
| `additionalContext` | Additional context for Claude |
| `updatedMCPToolOutput` | (MCP tools only) Replaces tool output |

---

### PostToolUseFailure

Fires when a tool execution fails. Matches on tool name.

**Input (additional fields):** `tool_name`, `tool_input`, `tool_use_id`, `error`, optional `is_interrupt`

```json
{
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "error": "Command exited with non-zero status code 1",
  "is_interrupt": false
}
```

**Decision control:** `additionalContext` in `hookSpecificOutput`

---

### Notification

Fires when Claude Code sends notifications. **Matcher values:** `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`.

**Input (additional fields):** `message`, optional `title`, `notification_type`

Cannot block or modify notifications. Can return `additionalContext`.

---

### SubagentStart

Fires when a subagent is spawned via the Task tool. Matcher filters on agent type name.

**Input (additional fields):** `agent_id`, `agent_type`

Cannot block subagent creation. Can return `additionalContext` to inject into the subagent's context.

---

### SubagentStop

Fires when a subagent finishes responding. Matches on agent type.

**Input (additional fields):** `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`

Uses the same decision control format as [Stop](#stop).

---

### Stop

Fires when the main Claude Code agent finishes responding. Does not fire on user interrupt. No matcher support.

**Input (additional fields):** `stop_hook_active` (true if already continuing due to a stop hook), `last_assistant_message`

**Decision control:**

| Field | Description |
|:------|:------------|
| `decision` | `"block"` prevents Claude from stopping |
| `reason` | Required when blocking — tells Claude why to continue |

```json
{
  "decision": "block",
  "reason": "Must be provided when Claude is blocked from stopping"
}
```

> **Important:** Check `stop_hook_active` to avoid infinite loops.

---

### TeammateIdle

Fires when an agent team teammate is about to go idle. No matcher support. Uses **exit codes only** (no JSON decision control).

**Input (additional fields):** `teammate_name`, `team_name`

Exit 2 → teammate receives stderr as feedback and continues working.

```bash
#!/bin/bash
if [ ! -f "./dist/output.js" ]; then
  echo "Build artifact missing. Run the build before stopping." >&2
  exit 2
fi
exit 0
```

---

### TaskCompleted

Fires when a task is being marked as completed (via TaskUpdate tool, or when a team teammate finishes with in-progress tasks). No matcher support. Uses **exit codes only**.

**Input (additional fields):** `task_id`, `task_subject`, optional `task_description`, `teammate_name`, `team_name`

Exit 2 → task not marked complete; stderr fed back to the model.

```bash
#!/bin/bash
INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')

if ! npm test 2>&1; then
  echo "Tests not passing. Fix failing tests before completing: $TASK_SUBJECT" >&2
  exit 2
fi
exit 0
```

---

### ConfigChange

Fires when a configuration file changes during a session. Can audit, enforce policies, or block unauthorized changes.

**Matcher values:** `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills`

**Input (additional fields):** `source`, optional `file_path`

**Decision control:**

| Field | Description |
|:------|:------------|
| `decision` | `"block"` prevents the config change |
| `reason` | Shown to user when blocked |

> **Note:** `policy_settings` changes cannot be blocked — hooks fire for auditing only.

---

### PreCompact

Fires before a compact operation.

**Matcher values:** `manual` (`/compact`), `auto` (auto-compact when context window is full)

**Input (additional fields):** `trigger`, `custom_instructions`

---

### SessionEnd

Fires when a session ends. Cannot block session termination. Useful for cleanup and logging.

**Matcher values:** `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other`

**Input (additional fields):** `reason`

No decision control available.

---

## Prompt-Based Hooks

Use `type: "prompt"` to have an LLM evaluate whether to allow or block an action. Supported events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `TaskCompleted`.

**How it works:**
1. Hook input + your prompt → sent to Claude Haiku (fast model by default)
2. LLM returns a structured JSON decision
3. Claude Code flows the decision automatically

**Configuration:**

| Field | Required | Description |
|:------|:---------|:------------|
| `type` | yes | `"prompt"` |
| `prompt` | yes | Prompt text; use `$ARGUMENTS` for hook input JSON |
| `model` | no | Model to use (defaults to fast model) |
| `timeout` | no | Default: 30s |

**Response schema the LLM must return:**
```json
{
  "ok": true,
  "reason": "Required when ok is false"
}
```

**Example — multi-criteria Stop hook:**
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are evaluating whether Claude should stop working. Context: $ARGUMENTS\n\nAnalyze the conversation and determine if:\n1. All user-requested tasks are complete\n2. Any errors need to be addressed\n3. Follow-up work is needed\n\nRespond with JSON: {\"ok\": true} to allow stopping, or {\"ok\": false, \"reason\": \"your explanation\"} to continue working.",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

---

## Agent-Based Hooks

Use `type: "agent"` for multi-turn verification with tool access (Read, Grep, Glob, etc.). Supports the same events as prompt-based hooks.

**How it works:**
1. Claude Code spawns a subagent with your prompt and hook input
2. Subagent can use tools to investigate (up to 50 turns)
3. Subagent returns `{ "ok": true/false }` decision
4. Claude Code flows the decision same as prompt hooks

**Configuration:**

| Field | Required | Description |
|:------|:---------|:------------|
| `type` | yes | `"agent"` |
| `prompt` | yes | Prompt; use `$ARGUMENTS` for hook input JSON |
| `model` | no | Defaults to fast model |
| `timeout` | no | Default: 60s |

**Example — verify tests pass before Stop:**
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "prompt": "Verify that all unit tests pass. Run the test suite and check the results. $ARGUMENTS",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

---

## Async Hooks

Set `"async": true` on a command hook to run it in the background without blocking Claude. Only available for `type: "command"` hooks.

**Limitations:**
- Cannot block tool calls or return decisions (action already proceeded)
- Output delivered on the next conversation turn
- No deduplication across multiple firings

**Configuration:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/run-tests-async.sh",
            "async": true,
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

**Example async script:**
```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run tests for source files
if [[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.js ]]; then
  exit 0
fi

RESULT=$(npm test 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "{\"systemMessage\": \"Tests passed after editing $FILE_PATH\"}"
else
  echo "{\"systemMessage\": \"Tests failed after editing $FILE_PATH: $RESULT\"}"
fi
```

After the background flow exits, any `systemMessage` or `additionalContext` in the JSON response is delivered to Claude on the next conversation turn.

---

## Security Considerations

> **Warning:** Hooks execute shell commands with your full user permissions. They can modify, delete, or access any files your user account can access. Review and test all hook commands before adding them.

**Best practices:**
- **Validate and sanitize inputs** — never trust input data blindly
- **Always quote shell variables** — use `"$VAR"` not `$VAR`
- **Block path traversal** — check for `..` in file paths
- **Use absolute paths** — specify full paths for scripts using `"$CLAUDE_PROJECT_DIR"`
- **Skip sensitive files** — avoid `.env`, `.git/`, keys, etc.

---

## Debug Hooks

Run `claude --debug` to see hook execution details. Toggle verbose mode with `Ctrl+O`.

```
[DEBUG] Executing hooks for PostToolUse:Write
[DEBUG] Getting matching hook commands for PostToolUse with query: Write
[DEBUG] Found 1 hook matchers in settings
[DEBUG] Matched 1 hooks for query "Write"
[DEBUG] Found 1 hook commands to execute
[DEBUG] Executing hook command: <Your command> with timeout 600000ms
[DEBUG] Hook command completed with status 0: <Your stdout>
```

For troubleshooting (hooks not firing, infinite Stop hook loops, config errors), see the [Hooks Guide](https://code.claude.com/docs/en/hooks-guide).

---

*Captured from [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)*
