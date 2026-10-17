/**
 * Schema for step definition files (templates/flows/{category}/{template}/{stepRef}/{stepRef}.json)
 *
 * Defines the enriched JSON structure for agent guidance in the JSON-First
 * Agent Architecture. This type represents the SOURCE OF TRUTH for step
 * execution guidance - agents read this JSON for instructions.
 *
 * Note: This is different from FlowStep which tracks runtime state
 * of a step within a running flow instance.
 */

import { StepRef, StepDefinitionId } from './shared-types'

export interface StepDefinition {
  /** Discriminator field - always "step" */
  type: 'step'

  /** Unique identifier (UUID v4) — stable across renames and reorganizations */
  id: StepDefinitionId

  /** Step identifier (e.g., "understand-context", "apply-changes") */
  name: string

  /** Category folder name (e.g., "planning", "investigation", "common") */
  category: string

  /** Step metadata */
  metadata: {
    /** Human-readable title */
    title: string
    /** When and why to use this step */
    purposeAndUsage: string
    /** Last updated date (YYYY-MM-DD) */
    lastUpdated: string
  }

  /** What this step produces */
  output: {
    /** Description of the output */
    description: string
    /** Files or artifacts created */
    artifacts: string[]
    /** Fields updated in memory topic files */
    memoryUpdates: string[]
  }

  /** Agent execution guidance - the core of JSON-first architecture */
  guidance: {
    /** What must be true before starting this step */
    prerequisites: string[]
    /** Specific actions the agent should take */
    specificActions: string[]
    /** Files the step works with */
    files: {
      /** Files to read */
      read: string[]
      /** Files to create */
      create: string[]
      /** Files to update */
      update: string[]
    }
    /** Tools required for this step */
    tools: string[]
    /** Best practices to follow */
    bestPractices: string[]
  }

  /** Detailed substeps with full descriptions and actions */
  substeps: Array<{
    /** Substep number (1-based) */
    number: number
    /** Substep name */
    name: string
    /** Full description of what this substep accomplishes */
    description: string
    /** Specific actions to take in this substep */
    actions: string[]
    /** Condition description - when provided, substep only runs if condition is met */
    conditional?: string
  }>

  /** Flow information for documentation */
  flow: {
    /** Textual description of the flow (mermaid diagram stays in MD) */
    description: string
  }

  /** How this step uses the memory topic files */
  memoryFileUsage: {
    /** Topic files this step reads from (e.g., ["context.json", "identified-files.json"]) */
    readFrom: string[]
    /** Topic files this step writes to (e.g., ["findings.json"]) */
    writeTo: string[]
    /** Descriptive fields documenting what data is produced */
    fields: string[]
  }

  /** Dependencies and requirements */
  dependencies: {
    /** Component files required */
    requiredComponents: string[]
    /** Files that must exist */
    requiredFiles: string[]
    /** Tools needed */
    requiredTools: string[]
  }

  /** References to related resources */
  references: {
    /** Related step names */
    relatedSteps: string[]
    /** Templates that use this step */
    usedInTemplates: string[]
  }

  // ============================================
  // Optional step-specific fields
  // ============================================

  /** Step-specific parameters (for configurable steps like identify-files, review-verify-document) */
  parameters?: {
    required?: string[]
    optional?: string[]
    defaults?: Record<string, unknown>
    definitions?: Record<
      string,
      {
        type: string
        description: string
        enum?: string[]
        default?: string | boolean
        example?: unknown
      }
    >
  }

  /** Search modes configuration (for identify-files step) */
  searchModes?: Array<{
    mode: string
    default: boolean
    description: string
  }>

  /** Capture types configuration (for capture-test-failure step) */
  captureTypes?: Array<{
    type: string
    capture: string
  }>

  /** Change proposal format specification (for design-implementation-plan step) */
  changeProposalFormat?: {
    modification: {
      prefix: string
      fields: string[]
    }
    newFile: {
      prefix: string
      fields: string[]
    }
  }

  /** Whether this step requires approval when used standalone */
  approvalRequired?: boolean
}

/**
 * Embedded step definition — the execution-relevant subset of StepDefinition
 * that gets included inline within flow templates and flow instances.
 *
 * Excludes catalog/template concerns: type, name, category, metadata, references, dependencies.
 * Retains stepRef on the parent FlowStep as provenance.
 */
export interface EmbeddedStepDefinition {
  output?: {
    description: string
    artifacts: string[]
    memoryUpdates: string[]
  }

  guidance: {
    prerequisites: string[]
    specificActions: string[]
    files: {
      read: string[]
      create: string[]
      update: string[]
    }
    tools: string[]
    bestPractices: string[]
  }

  substeps: Array<{
    number: number
    name: string
    description: string
    actions: string[]
    conditional?: string
  }>

  flow?: {
    description: string
  }

  memoryFileUsage?: {
    readFrom: string[]
    writeTo: string[]
    fields: string[]
  }

  parameters?: {
    required?: string[]
    optional?: string[]
    defaults?: Record<string, unknown>
    definitions?: Record<
      string,
      {
        type: string
        description: string
        enum?: string[]
        default?: string | boolean
        example?: unknown
      }
    >
  }

  [key: string]: unknown
}
