import type { Command } from '../../commands.js'

const knowledgeHub = {
  type: 'local-jsx',
  name: 'hub',
  description: 'Enable or disable CoStrict cloud favorite items (auto-download on load)',
  load: () => import('./cloud-enabled.js'),
} satisfies Command

export default knowledgeHub
