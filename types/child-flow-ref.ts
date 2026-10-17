import { FlowStatus } from './flow-status'
import { FlowId, StepId, SyncPoint, FlowPath } from './shared-types'

/**
 * Reference to a child sub-flow spawned by a parent flow.
 */
export interface ChildFlowRef {
  /** Unique identifier of the child flow (UUID) */
  id: FlowId

  /** Human-readable name of the child flow */
  name: string

  /** Current status of the child flow */
  status: FlowStatus

  /** Step ID in the parent flow where this child was spawned */
  spawnedAtStep: StepId

  /** Step ID after which the parent should wait for this child to complete */
  syncPoint: SyncPoint

  /** Absolute path to the child flow folder */
  flowPath: FlowPath
}
