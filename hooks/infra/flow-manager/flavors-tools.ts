import type { Tool } from './tools'

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool => ({ name, description, inputSchema: { type: 'object', properties, required } })

// The flavor tools of the agent, in their own file like the findings tools (the schemas only; the script does the work).
// The agent only proposes: a flavor changes for the steps when the user accepts it on the page. The user's own add, edit, accept and delete are the mod's.
export function flavorsTools(flowDir: unknown, str: (d: string) => unknown): Tool[] {
  return [
    tool('list_flavors', 'List the flavors of the user: one short line each (id, topic, description, status). Use it before you propose a change.', {}, []),
    tool(
      'save_flavor',
      'Propose a flavor, a personal preference of the user. Give targetId to propose a new text for a flavor that exists. It waits for the user to accept it.',
      {
        flowDir,
        topic: str('The area it is about, for example Tests or Git'),
        text: str('One clear sentence'),
        targetId: str('Id of the active flavor this replaces'),
        evidence: str('A few words the user said that led to this, 200 characters at most'),
      },
      ['flowDir', 'topic', 'text'],
    ),
    tool(
      'delete_flavor',
      'Propose to forget a flavor that the user took back. It stays until the user accepts.',
      { flowDir, targetId: str('Id of the active flavor'), evidence: str('A few words the user said that led to this, 200 characters at most') },
      ['flowDir', 'targetId'],
    ),
  ]
}
