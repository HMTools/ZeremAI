/**
 * Overall status of a flow instance.
 */
export type FlowStatus = 'running' | 'completed' | 'failed' | 'paused';

/**
 * Status of an individual step within a flow.
 * Unified type used across flow-instance, memory-file, and log-file.
 */
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'awaiting_approval';
