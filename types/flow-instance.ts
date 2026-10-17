import { ChildFlowRef } from './child-flow-ref'
import { FlowStatus, StepStatus } from './flow-status'
import { FlowId, StepId, StepRef, FlowPath, ISOTimestamp } from './shared-types'
import { EmbeddedStepDefinition } from './step-definition'

/**
 * Complete flow instance as stored in flow.json.
 *
 * This is the main type that represents a running, completed, or failed flow.
 * The flow.json file is generated when a flow is created and updated
 * whenever the flow state changes.
 *
 * @example
 * ```json
 * {
 *   "type": "flow-instance",
 *   "id": "550e8400-e29b-41d4-a716-446655440000",
 *   "name": "User Authentication",
 *   "metadata": {
 *     "template": "develop-user-story",
 *     "templateCategory": "development",
 *     "created": "2026-01-20T14:30:22.000Z",
 *     "lastUpdated": "2026-01-20T15:45:00.000Z",
 *     "projectPaths": ["C:/Projects/MyApp"],
 *     "flowPath": "~/.claude/zeremai/active/flow-550e8400-a1b2c3"
 *   },
 *   "status": "running",
 *   "parameters": {
 *     "userStoryTitle": "User Authentication",
 *     "userStoryDescription": "Implement login functionality"
 *   },
 *   "currentState": {
 *     "activeStep": {
 *       "id": "a1b2c3d4-...",
 *       "name": "Create detailed step plans",
 *       "actionSummary": "Generating implementation plan",
 *       "actionDetails": "Analyzing high-level plan to create detailed steps",
 *       "totalSubsteps": 10,
 *       "currentSubstep": {
 *         "number": 3,
 *         "name": "Clarify Requirements"
 *       }
 *     }
 *   },
 *   "steps": [...]
 * }
 * ```
 */
export interface FlowInstance {
  /** Discriminator field - always "flow-instance" */
  type: 'flow-instance'

  /** Unique identifier for this flow instance (UUID) */
  id: FlowId

  /** Human-readable name of the flow */
  name: string

  /** Metadata about the flow (template, timestamps, paths) */
  metadata: FlowMetadata

  /** Current overall status of the flow */
  status: FlowStatus

  /** Parameters that were provided when creating this flow from a template */
  parameters: Record<string, string>

  /** Current execution state (active step, current action) */
  currentState: FlowCurrentState

  /** All steps in this flow with their current status */
  steps: FlowStep[]

  /** Sub-flow relationship information (optional, only present if flow has parent or children) */
  subFlowState?: SubFlowState
}

/**
 * Metadata about the flow instance.
 */
export interface FlowMetadata {
  /** Name of the template used to create this flow (e.g., "develop-user-story") */
  template: string

  /** Category of the template (e.g., "development", "testing", "infrastructure") - optional for backward compatibility */
  templateCategory?: string

  /** ISO 8601 timestamp when the flow was created */
  created: ISOTimestamp

  /** ISO 8601 timestamp when the flow was last updated */
  lastUpdated: ISOTimestamp

  /** Absolute paths to the project root directories this flow operates on */
  projectPaths?: string[]

  /** Absolute path to the flow folder (e.g., ~/.claude/zeremai/active/flow-name-YYYYMMDD-shortid) */
  flowPath?: FlowPath

  /**
   * @deprecated Session binding moved to the mod store, key `session:<id>`: the folders the session bound,
   * oldest first. The tools `create_flow` and `bind_flow` write it, and the hooks read it
   * instead of grepping flow.json. This field is no longer used.
   */
  sessionId?: string
}

/**
 * Tracks which substep is currently executing within the active step.
 * Only the cursor position is stored; completed/pending status is derived at render time.
 */
export interface ActiveStepSubstep {
  /** 1-based substep number within the step */
  number: number
  /** Name of the substep (e.g., "Gather Flow Parameters") */
  name: string
}

/**
 * Structured representation of the currently active step and its progress.
 * Consolidates the former flat fields (activeStepId, activeStepName, actionSummary, actionDetails)
 * into a single object and adds substep-level tracking.
 */
export interface ActiveStep {
  /** UUID of the currently active step (was: activeStepId) */
  id: StepId
  /** Name of the current step (was: activeStepName) */
  name: string
  /** Brief summary of current action for UI status bars (was: actionSummary) */
  actionSummary: string
  /** Extended details about the current action for tooltips/logs (was: actionDetails) */
  actionDetails?: string
  /** Total number of substeps in this step (derived from stepDefinition.substeps) */
  totalSubsteps: number
  /** Currently executing substep cursor (absent if step just started or has no substeps) */
  currentSubstep?: ActiveStepSubstep
}

/**
 * Current state of the flow execution.
 */
export interface FlowCurrentState {
  /** Structured active step with progress tracking */
  activeStep: ActiveStep
}

/**
 * Represents an individual step within a flow.
 */
export interface FlowStep {
  /** Unique identifier for this step (UUID) */
  id: StepId

  /** Step number (for ordering and display) */
  number: number

  /** Human-readable name of the step */
  name: string

  /** Current status of this step */
  status: StepStatus

  /** Reference to the step definition UUID (provenance — stepDefinition is already embedded) */
  stepRef: StepRef

  /** Human-readable companion name for stepRef (display-only, never used for resolution) */
  stepRefName?: string

  /** Sub-flow triggering configuration */
  subFlowTrigger?: {
    condition?: string
    /** Template UUID — primary cross-reference */
    template: string
    /** Human-readable companion name for template (display-only) */
    templateName?: string
    parameters?: Record<string, string>
    forEach?: string
    syncPoint: string
  }

  /** Step name to loop back to when loopCondition is met */
  loopBackTo?: string

  /** Condition expression for looping back */
  loopCondition?: string

  /** Maximum number of loop iterations */
  maxIterations?: number

  /** ISO 8601 timestamp when the step was started */
  startedAt?: ISOTimestamp

  /** ISO 8601 timestamp when the step was completed */
  completedAt?: ISOTimestamp

  /** Whether this step requires explicit user approval before proceeding */
  approvalRequired?: boolean

  /** Whether user approval has been granted (only relevant if approvalRequired is true) */
  approved?: boolean

  /** Only while status is blocked: what the user must do. Any other status clears it. */
  blocked?: { reason: string; command?: string; since: ISOTimestamp }

  /** Embedded step definition with full execution guidance */
  stepDefinition: EmbeddedStepDefinition
}

/**
 * Reference to a parent flow that spawned this sub-flow.
 */
export interface ParentFlowRef {
  /** Unique identifier of the parent flow (UUID) */
  id: FlowId

  /** Human-readable name of the parent flow */
  name: string

  /** Absolute path to the parent flow folder */
  flowPath: FlowPath

  /** Step ID in the parent flow to return to after this sub-flow completes */
  returnToStep: StepId
}

/**
 * State information for sub-flow relationships.
 */
export interface SubFlowState {
  /** Reference to the parent flow, or null if this is a root flow */
  parentFlow: ParentFlowRef | null

  /** List of child sub-flows spawned by this flow */
  childFlows: ChildFlowRef[]

  /** Next sync point where parent will wait for children (StepId) */
  nextSyncPoint?: StepId
}
