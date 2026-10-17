import type { Flow } from '../flow-types/flow-types'

// The pure parts of the step brief: which step a subagent works, what the orchestrator wrote as corrections,
// and how a subagent's result block is read. The mod hooks that use them are in ../../on-step-brief.

export const briefedKey = (agentId: string) => `briefed:${agentId}`
export const fixesKey = (agentId: string) => `fixes:${agentId}`
export type StepRef = { flowDir: string; stepId: string; maxFixes: number }

// How many times the mod asks the subagent to fix its result or its failed checks. A step can set it with `maxFixes`.
export const DEFAULT_FIXES = 2
export const fixLimit = (step: { stepDefinition?: { maxFixes?: number } } | undefined) => {
  const n = step?.stepDefinition?.maxFixes
  return Number.isInteger(n) && n! >= 0 && n! <= 5 ? n! : DEFAULT_FIXES
}

export const stepInProgress = (flow: Flow | undefined) => flow?.steps?.find(s => s.status === 'in_progress')

// The orchestrator writes "User corrections: <words>" for a re-run. Any other prompt (for example "Run the step.") is a first run.
export const correctionsOf = (prompt: string): string | undefined => /^\s*User corrections:\s*([\s\S]*\S)\s*$/i.exec(prompt)?.[1]

export type StepResult = {
  summary: string
  memory: { topic: string; info?: Record<string, unknown>; decisions?: string[]; files?: string[] }[]
  log: Record<string, string[]>
  blocked?: { reason: string; command?: string } // a retry cannot help: the user must act
}
const LOG_KEYS = ['actions', 'reasoning', 'filesModified', 'problems', 'decisions', 'performanceNotes']
const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// The result block is the last ```json fence of the subagent's answer. A block that does not match gives undefined.
export function readResultBlock(text: string): StepResult | undefined {
  const fences = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
  let raw: unknown
  try {
    raw = JSON.parse(fences.at(-1)?.[1] ?? '')
  } catch {
    return
  }
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
  let blocked: StepResult['blocked']
  if (raw.blocked !== undefined) {
    const b = raw.blocked
    if (!isObject(b) || typeof b.reason !== 'string' || !b.reason.trim() || (b.command !== undefined && typeof b.command !== 'string')) return
    blocked = { reason: b.reason.trim(), ...(typeof b.command === 'string' && b.command.trim() ? { command: b.command.trim() } : {}) }
  }
  return { summary: raw.summary.trim(), memory: entries, log, ...(blocked ? { blocked } : {}) }
}

export const FIX_MESSAGE =
  'Your result block is missing or wrong. End your answer again with one ```json block with "summary" (text), ' +
  '"memory" (a list of {topic, info, decisions, files}) and "log" (lists: actions, reasoning, filesModified, problems, decisions, performanceNotes). ' +
  'If you added "blocked", it is {reason (text), command (text, optional)}.'

export type Check = { name: string; passed: boolean; message?: string }
// The answer of the run-verifiers command: the script never fails it, so anything else is a fault of the script itself.
export function readVerifierRun(out: Record<string, unknown>): { result: 'pass' | 'fail'; checks: Check[] } | undefined {
  if (out.status !== 'ok' || (out.result !== 'pass' && out.result !== 'fail') || !Array.isArray(out.checks)) return
  return { result: out.result, checks: out.checks as Check[] }
}

export const failedLines = (checks: Check[]) =>
  checks
    .filter(c => !c.passed)
    .map(c => `- ${c.name}${c.message ? `: ${c.message}` : ''}`)
    .join('\n')
export const failedChecksMessage = (checks: Check[]) => `Your work failed these checks:\n${failedLines(checks)}\nFix the work. Then end your answer again with the result block.`
