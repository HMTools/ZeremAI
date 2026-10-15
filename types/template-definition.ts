/**
 * Schema for template definition files (~/.claude/zeremai/templates/flows/[id]/*.json)
 *
 * Defines the enriched JSON structure for agent guidance in the JSON-First
 * Agent Architecture. This type represents the SOURCE OF TRUTH for template
 * execution guidance - agents read this JSON for instructions.
 *
 * Note: This is different from FlowInstance which tracks runtime state
 * of a running flow created from a template.
 */

import { StepRef, TemplateId, StepDefinitionId } from "./shared-types";
import { EmbeddedStepDefinition } from "./step-definition";

export interface TemplateDefinition {
  /** Discriminator field - always "template" */
  type: 'template';

  /** Unique identifier (UUID v4) — stable across renames and reorganizations */
  id: TemplateId;

  /** Template identifier (e.g., "develop-user-story", "set-concept") */
  name: string;

  /** Category folder name (e.g., "development", "infrastructure", "testing") */
  category: string;

  /** Template metadata */
  metadata: {
    /** Human-readable title */
    title: string;
    /** When and why to use this template */
    purposeAndUsage: string;
    /** Last updated date (YYYY-MM-DD) */
    lastUpdated: string;
  };

  /** Template parameters */
  parameters: {
    /** Required parameter names */
    required: string[];
    /** Optional parameter names */
    optional: string[];
    /** Parameter definitions with descriptions, types, and examples */
    definitions: Record<string, {
      /** What this parameter is for */
      description: string;
      /** Parameter type (string, number, etc.) */
      type: string;
      /** Example value (always as string for display) */
      example: string;
      /** A fixed list. The form shows a dropdown and the value must be one of them. */
      options?: string[];
      /** With options: also let the user type another value. */
      allowOther?: boolean;
    }>;
    /** Additional notes about parameters */
    notes?: string;
    /** Default values for parameters */
    defaults?: Record<string, unknown>;
  };

  /** Complete step definitions with full agent guidance */
  steps: Array<{
    /** Step number */
    number: number;
    /** Step name */
    name: string;
    /** Optional group name shown on the template page (for example "Design"). A step without it is grouped by its approvals. */
    phase?: string;
    /** Reference to step definition UUID — primary cross-reference, used for resolution */
    stepRef: StepRef;
    /** Human-readable companion name for stepRef (display-only, never used for resolution) */
    stepRefName?: string;
    /** Full description of what this step does in this template's context */
    description?: string;
    /** Context variables passed to the step */
    context?: Record<string, string>;
    /** Expected output from this step (optional -- lives in step file) */
    output?: string;
    /** Whether user must approve before proceeding */
    approvalRequired?: boolean;
    /** Actions to take after approval */
    postApprovalActions?: string[];
    /** Additional notes */
    notes?: string;
    /** Conditional execution description */
    conditional?: string;
    /** Step name to loop back to when loopCondition is met */
    loopBackTo?: string;
    /** Condition expression for looping back */
    loopCondition?: string;
    /** Maximum number of loop iterations */
    maxIterations?: number;
    /** Sub-flow triggering configuration */
    subFlowTrigger?: {
      condition?: string;
      /** Template UUID — primary cross-reference, used for resolution */
      template: string;
      /** Human-readable companion name for template (display-only, never used for resolution) */
      templateName?: string;
      parameters?: Record<string, string>;
      forEach?: string;
      syncPoint: string;
    };
    /** Sub-flow configuration */
    subFlowConfig?: {
      template: string;
      sync: string;
      iterateOver?: string;
      parameterMapping?: Record<string, string>;
    };
    /** Fallback behavior */
    fallback?: string;
    /** Embedded step definition with full execution guidance (optional -- resolved at flow creation time from step subfolders) */
    stepDefinition?: EmbeddedStepDefinition;
  }>;

  /** Dynamic step generation rules (if applicable) */
  dynamicSteps?: {
    /** Description of how dynamic steps are generated */
    description: string;
    /** What the steps are derived from */
    derivedFrom: string;
    /** Step references for dynamic steps, keyed by step type */
    stepRefs?: Record<string, StepRef>;
  };

  /** Memory file structure for this template */
  memoryFileStructure?: {
    /** Section names in memory */
    sections: string[];
    /** Key fields to track */
    keyFields: string[];
  };

  /** References to related resources */
  references: {
    /** Step definition UUIDs used by this template */
    steps: StepDefinitionId[];
    /** Related template UUIDs */
    relatedTemplates: TemplateId[];
    /** Dependencies */
    dependencies: string[];
  };

  /** Template-specific guidance for agent execution (per-step context) */
  guidance?: Record<string, {
    description?: string;
    actions?: string[];
    [key: string]: unknown;
  }>;

  /** Per-step memory file usage (alternative to memoryFileStructure) */
  memoryFileUsage?: Record<string, {
    informationProduced?: string[];
    decisionsMade?: string[];
  }>;
}
