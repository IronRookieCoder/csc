import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../commands.js'
import type { ToolUseContext } from '../Tool.js'

const securityReview: Command = {
  type: 'prompt',
  name: 'security-review',
  description: 'Complete a security review of the pending changes on the current branch',
  progressMessage: 'analyzing code changes for security risks',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args, _context): Promise<ContentBlockParam[]> {
    return [{ type: 'text', text: args }]
  },
}

export default securityReview
