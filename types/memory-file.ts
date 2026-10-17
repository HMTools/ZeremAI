/**
 * Schema for memory topic files in flow instances (~/.claude/zeremai/active/[id]/memory/<topic>.json)
 * and cross-references (~/.claude/zeremai/active/[id]/memory/_cross-references.json)
 *
 * Topic-based memory architecture: each concern gets its own file in the memory/ directory.
 * Steps read/write only the topic files declared in their memoryFileUsage.
 */

import { StepId, ISOTimestamp } from './shared-types'

/**
 * Entry for a single step's contribution to a topic file
 */
export interface MemoryTopicEntry {
  /** Step name (for display purposes) */
  stepName: string

  /** Information produced during this step for this topic */
  informationProduced: Record<string, unknown>

  /** Decisions made during this step relevant to this topic */
  decisionsMade: string[]

  /** Files modified or created during this step */
  filesModifiedCreated: string[]

  /** When this entry was last updated (ISO 8601) */
  updatedAt?: ISOTimestamp

  /** Additional notes */
  notes?: string
}

/**
 * A single topic file: memory/<topic>.json
 */
export interface MemoryTopicFile {
  /** Discriminator field - always "memory-topic-file" */
  type: 'memory-topic-file'

  /** Topic name (matches filename without extension) */
  topic: string

  /** Last updated timestamp (ISO 8601) */
  lastUpdated: ISOTimestamp

  /** Entries keyed by step ID */
  entries: Record<StepId, MemoryTopicEntry>
}

/**
 * Cross-references file: memory/_cross-references.json
 * Aggregated data across all topic files for quick lookup.
 */
export interface MemoryCrossReferences {
  /** Discriminator field - always "memory-cross-references" */
  type: 'memory-cross-references'

  /** Key decisions made during flow (aggregated from all topics) */
  keyDecisions: string[]

  /** Files modified during flow (aggregated) */
  filesModified?: string[]

  /** Files created during flow (aggregated) */
  filesCreated?: string[]

  /** Custom domain-specific references */
  custom?: Record<string, unknown>
}
