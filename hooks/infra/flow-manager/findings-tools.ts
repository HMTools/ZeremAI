import type { Tool } from './tools'

const FINDING_STATUSES = ['applied', 'rejected', 'deferred']
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool => ({ name, description, inputSchema: { type: 'object', properties, required } })

// The improvement findings tools, in their own file to keep tools.ts short (the schemas only; the script does the work).
export function findingsTools(flowDir: unknown, str: (d: string) => unknown, list: (d: string) => unknown): Tool[] {
  return [
    tool(
      'write_finding',
      'Save one improvement finding of this flow to the store that apply-improvements reads.',
      {
        flowDir,
        category: str('Category'),
        title: str('Title'),
        what: str('What to change'),
        why: str('Why'),
        impact: str('Impact'),
        scope: list('Target file paths'),
      },
      ['flowDir', 'category', 'title', 'what', 'why', 'impact'],
    ),
    tool(
      'list_findings',
      'List improvement findings of every flow, optionally for one status or one template.',
      {
        status: { type: 'string', enum: ['open', ...FINDING_STATUSES] },
        templateId: str('Only this template'),
      },
      [],
    ),
    tool(
      'update_finding_status',
      'Record the outcome of a finding.',
      {
        flowId: str('Flow id'),
        findingId: str('Finding id'),
        status: { type: 'string', enum: FINDING_STATUSES },
        notes: str('Notes'),
        filesModified: list('Files modified'),
      },
      ['flowId', 'findingId', 'status'],
    ),
  ]
}
