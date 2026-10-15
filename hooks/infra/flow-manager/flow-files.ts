// Shared by the flow schemas and the views: the shape of a flow file and the allowed statuses.

export type Doc = Record<string, any> // a flow, log or memory file: plain JSON, so fields the script does not know survive a write
export type Result = Record<string, any> & { status: 'ok' | 'error' }

export const STEP_STATUSES = ['pending', 'in_progress', 'completed', 'skipped', 'awaiting_approval', 'blocked']
export const FLOW_STATUSES = ['running', 'completed', 'failed', 'paused']

export class ToolError extends Error {}
export const fail = (message: string): never => { throw new ToolError(message) }
export const ok = (...files: string[]): Result => ({ status: 'ok', files_written: files })
