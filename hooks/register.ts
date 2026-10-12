import type { Register } from 'claude-code'
import { register as onAgentStopping } from './on-agent-stopping/on-agent-stopping'
import { register as onUserPrompt } from './on-user-prompt/on-user-prompt'
import { register as onPendingCheckpoint } from './on-pending-checkpoint/on-pending-checkpoint'
import { register as onTodoTool } from './on-todo-tool/on-todo-tool'
import { register as onApprovalGate } from './on-approval-gate/on-approval-gate'
import { register as onFlowTools } from './on-flow-tools/on-flow-tools'
import { register as onFlowPane } from './on-flow-pane/on-flow-pane'

export const register: Register = (on, options) => {
  onAgentStopping(on, options)
  onUserPrompt(on, options)
  onPendingCheckpoint(on, options)
  onTodoTool(on, options)
  onApprovalGate(on, options)
  onFlowTools(on, options)
  onFlowPane(on, options)
}
