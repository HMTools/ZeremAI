/**
 * Schema for log.json files in flow instances (~/.claude/zeremai/active/[id]/log.json)
 *
 * Captures detailed execution history, user interactions, and flow-wide observations.
 */

import { ISOTimestamp, FlowPath, StepId } from './shared-types'

/**
 * Timestamp structure for step entries that track both start and update times.
 * Used as an alternative to simple ISOTimestamp when richer time tracking is needed.
 */
export interface StepTimestamp {
  /** When the step started (ISO 8601) */
  startedAt: ISOTimestamp
  /** When the step was last updated (ISO 8601) */
  updatedAt?: ISOTimestamp
  /** When the step completed (ISO 8601) */
  completedAt?: ISOTimestamp
}

/**
 * A single user interaction record
 */
export interface UserInteraction {
  /** What the user requested */
  request: string

  /** Why the user made this request */
  reason: string

  /** How the agent responded */
  agentResponse: string

  /** When this interaction occurred (ISO 8601) */
  timestamp: ISOTimestamp

  /** Flag indicating this should be reviewed in continuous improvement step */
  forImprovementStep?: boolean

  /** Potential improvement to consider based on this interaction */
  potentialImprovement?: string
}

/**
 * Log entry for a single step
 */
export interface LogStepEntry {
  /**
   * Timestamp for this step entry.
   * Can be either a simple ISO 8601 string (when step started) or
   * a StepTimestamp object for richer time tracking.
   */
  timestamp: ISOTimestamp | StepTimestamp

  /** User interactions during this step */
  userInteractions?: UserInteraction[]

  /** Actions taken during this step */
  actionsTaken?: string[]

  /** Agent reasoning during this step */
  agentReasoning?: string[]

  /** Problems encountered during this step */
  problemsEncountered?: string[]

  /** Files modified during this step */
  filesModified?: string[]

  /** Decisions made during this step */
  decisionsMade?: string[]

  /** Performance notes */
  performanceNotes?: string[]
}

/**
 * Complete log file structure for flow instances
 */
export interface LogFile {
  /** Discriminator field - always "log-file" */
  type: 'log-file'

  /** Flow metadata */
  metadata: {
    /** Flow instance ID */
    flow: string
    /** Template used to create this flow */
    template: string
    /** When flow started (ISO 8601) */
    started: ISOTimestamp
    /** When flow completed (ISO 8601, null if still running) */
    completed: ISOTimestamp | null
    /** Parent flow path (null if top-level flow) */
    parentFlowPath: FlowPath | null
    /** Paths to sub-flows spawned from this flow */
    subFlowPaths: FlowPath[]
  }

  /** Execution metrics (optional) */
  executionMetrics?: {
    /** Total steps in flow */
    totalSteps: number
    /** Steps completed so far */
    stepsCompleted: number
    /** Current step ID */
    currentStep: StepId
  }

  /** Step-by-step log entries (keyed by StepId) */
  steps: Record<StepId, LogStepEntry>

  /** User interactions at flow level (for interactions outside step context) */
  userInteractions?: UserInteraction[]

  /** Flow-wide observations for learning and improvement */
  flowWideObservations: {
    /** Patterns detected during execution */
    patternsDetected: string[]
    /** Summary of user feedback received */
    userFeedbackSummary: string[]
    /** Efficiency metrics collected */
    efficiencyMetrics: Record<string, unknown>
    /** Recommendations for future flow executions */
    recommendationsForFuture: string[]
  }
}
