import type { Flow } from '../flow-types/flow-types'

// The pure parts of the step brief: which step a subagent works, what the orchestrator wrote as corrections,
// and how a subagent's result block is read. The mod hooks that use them are in ../../on-step-brief.

export const briefedKey = (agentId: string) => `briefed:${agentId}`
export const fixesKey = (agentId: string) => `fixes:${agentId}`
export type StepRef = { flowDir: string; stepId: string }

export const stepInProgress = (flow: Flow | undefined) => flow?.steps?.find(s => s.status === 'in_progress')

// The orchestrator writes "User corrections: <words>" for a re-run. Any other prompt (for example "Run the step.") is a first run.
export const correctionsOf = (prompt: string): string | undefined => /^\s*User corrections:\s*([\s\S]*\S)\s*$/i.exec(prompt)?.[1]

export type StepResult = {
  summary: string
  memory: { topic: string; info?: Record<string, unknown>; decisions?: string[]; files?: string[] }[]
  log: Record<string, string[]>
}
const LOG_KEYS = ['actions', 'reasoning', 'filesModified', 'problems', 'decisions', 'performanceNotes']
const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// The result block is the last ```json fence of the subagent's answer. A block that does not match gives undefined.
export function readResultBlock(text: string): StepResult | undefined {
  const fences = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
  let raw: unknown
  try { raw = JSON.parse(fences.at(-1)?.[1] ?? '') } catch { return }
  if (!isObject(raw) || typeof raw.summary !== 'string' || !raw.summary.trim()) return
  const memory = raw.memory === undefined ? [] : raw.memory
  if (!Array.isArray(memory)) return
  const entries: StepResult['memory'] = []
  for (const m of memory) {
    if (!isObject(m) || typeof m.topic !== 'string' || !m.topic) return
    if (m.info !== undefined && !isObject(m.info)) return
    if ((m.decisions !== undefined && !isList(m.decisions)) || (m.files !== undefined && !isList(m.files))) return
    entries.push({ topic: m.topic, info: m.info as Record<string, unknown> | undefined, decisions: m.decisions as string[] | undefined, files: m.files as string[] | undefined })
  }
  const log: Record<string, string[]> = {}
  if (raw.log !== undefined) {
    if (!isObject(raw.log)) return
    for (const key of LOG_KEYS) {
      const value = raw.log[key]
      if (value === undefined) continue
      if (!isList(value)) return
      log[key] = value
    }
  }
  return { summary: raw.summary.trim(), memory: entries, log }
}

export const FIX_MESSAGE =
  'Your result block is missing or wrong. End your answer again with one ```json block with "summary" (text), ' +
  '"memory" (a list of {topic, info, decisions, files}) and "log" (lists: actions, reasoning, filesModified, problems, decisions, performanceNotes).'
