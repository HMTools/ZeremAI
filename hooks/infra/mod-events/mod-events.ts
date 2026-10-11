export const isMainAgentAnswer = (e: { agentId?: string; reason?: string }) => !e.agentId && e.reason === 'answer'
export const isPromptFromPlugin = (e: { origin?: { kind?: string } }) => e.origin?.kind === 'plugin'

// The tools of this plugin are named `mcp__<plugin>__<tool>`.
export const TOOL_PREFIX = 'mcp__zeremai__'
