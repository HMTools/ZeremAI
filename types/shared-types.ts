/**
 * Shared utility types used across all flow type definitions.
 * 
 * These types provide semantic meaning to primitive types and ensure
 * consistency across the codebase.
 */

/**
 * UUID identifier for a flow instance.
 * Format: Standard UUID v4 (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export type FlowId = string;

/**
 * UUID identifier for a step within a flow.
 * Format: Standard UUID v4
 */
export type StepId = string;

/**
 * ISO 8601 timestamp string.
 * Format: "2026-01-31T14:30:00.000Z"
 */
export type ISOTimestamp = string;

/**
 * Absolute path to a flow directory.
 * Example: "~/.claude/zeremai/active/flow-abc123-a1b2c3"
 */
export type FlowPath = string;

/**
 * UUID of a step definition file. Used as the authoritative identifier
 * for cross-referencing step definitions across templates and flows.
 * Format: Standard UUID v4
 */
export type StepDefinitionId = string;

/**
 * UUID of a flow template file. Used as the authoritative identifier
 * for cross-referencing templates (e.g., in subFlowTrigger.template
 * and references.relatedTemplates).
 * Format: Standard UUID v4
 */
export type TemplateId = string;

/**
 * Reference to a step definition.
 * Format: UUID of the step definition, or null for orchestrator steps.
 * All steps (including framework steps) use plain UUIDs.
 */
export type StepRef = string;

/**
 * Sync point for child flow coordination.
 * References a StepId - the parent will wait for the child after this step completes.
 */
export type SyncPoint = StepId;
