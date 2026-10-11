import type { ManagerPorts } from '../ports/ports'
import { locked, ok, readLog, writeJson } from './flow-files'
import type { Doc, Result } from './flow-files'

export type LogEntryArgs = {
  flowDir: string; stepId: string; actions?: string[]; reasoning?: string[]; filesModified?: string[]
  problems?: string[]; decisions?: string[]; performanceNotes?: string[]
}

const LOG_LISTS: [keyof LogEntryArgs, string][] = [
  ['actions', 'actionsTaken'], ['reasoning', 'agentReasoning'], ['filesModified', 'filesModified'],
  ['problems', 'problemsEncountered'], ['decisions', 'decisionsMade'], ['performanceNotes', 'performanceNotes'],
]

// A repeated call must not add the same decision or file twice. Actions and notes can repeat on purpose.
const DEDUPED = ['decisionsMade', 'filesModified']

// The step's timestamp is a string in old logs and { startedAt, updatedAt } now.
const touch = (entry: Doc, now: string) => {
  entry.timestamp = typeof entry.timestamp === 'object' && entry.timestamp !== null ? { ...entry.timestamp, updatedAt: now } : { startedAt: entry.timestamp, updatedAt: now }
}

export const addLogEntry = (ports: ManagerPorts, a: LogEntryArgs): Promise<Result> => locked(a.flowDir, async () => {
  const log = await readLog(ports, a.flowDir)
  const now = ports.now()
  const entry = log.steps[a.stepId]
  if (entry) {
    for (const [arg, field] of LOG_LISTS) {
      const items = a[arg] as string[] | undefined
      if (items?.length) entry[field] = DEDUPED.includes(field) ? [...new Set([...(entry[field] ?? []), ...items])] : [...(entry[field] ?? []), ...items]
    }
    touch(entry, now)
  } else {
    const created: Doc = { timestamp: { startedAt: now } }
    for (const [arg, field] of LOG_LISTS) {
      const items = a[arg] as string[] | undefined
      // The actions list is left out when empty; the other lists keep an empty list that the agent sent.
      if (arg === 'actions' ? items?.length : items !== undefined) created[field] = items
    }
    log.steps[a.stepId] = created
  }
  if (log.executionMetrics) log.executionMetrics.currentStep = a.stepId
  await writeJson(ports, `${a.flowDir}/log.json`, log)
  return ok('log.json')
})

export type InteractionArgs = {
  flowDir: string; stepId: string; request: string; reason: string; response: string
  forImprovement?: boolean; potentialImprovement?: string
}

export const logInteraction = (ports: ManagerPorts, a: InteractionArgs): Promise<Result> => locked(a.flowDir, async () => {
  const log = await readLog(ports, a.flowDir)
  const now = ports.now()
  const interaction: Doc = { request: a.request, reason: a.reason, agentResponse: a.response, timestamp: now }
  if (a.forImprovement) interaction.forImprovementStep = true
  if (a.potentialImprovement != null) interaction.potentialImprovement = a.potentialImprovement
  const entry = log.steps[a.stepId]
  if (entry) {
    entry.userInteractions = [...(entry.userInteractions ?? []), interaction]
    if (typeof entry.timestamp === 'object' && entry.timestamp !== null) entry.timestamp = { ...entry.timestamp, updatedAt: now }
  } else {
    log.steps[a.stepId] = { timestamp: { startedAt: now }, userInteractions: [interaction] }
  }
  await writeJson(ports, `${a.flowDir}/log.json`, log)
  return ok('log.json')
})

export type ObservationsArgs = { flowDir: string; patterns?: string[]; feedback?: string[]; metrics?: Doc; recommendations?: string[] }

export const updateLogObservations = (ports: ManagerPorts, a: ObservationsArgs): Promise<Result> => locked(a.flowDir, async () => {
  const log = await readLog(ports, a.flowDir)
  const wide = (log.flowWideObservations ??= {})
  const extend = (key: string, items?: string[]) => { if (items?.length) wide[key] = [...(wide[key] ?? []), ...items] }
  extend('patternsDetected', a.patterns)
  extend('userFeedbackSummary', a.feedback)
  if (a.metrics && Object.keys(a.metrics).length) wide.efficiencyMetrics = { ...(wide.efficiencyMetrics ?? {}), ...a.metrics }
  extend('recommendationsForFuture', a.recommendations)
  await writeJson(ports, `${a.flowDir}/log.json`, log)
  return ok('log.json')
})
