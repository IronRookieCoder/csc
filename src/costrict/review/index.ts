/**
 * CoStrict Review Module
 *
 * Provides builtin review skills that are embedded in the binary
 * and registered as bundled skills via registerBundledSkill().
 */

export * as SkillBuiltin from './skill/builtin.js'
export {
  REVIEW_AGENTS,
  AGENT_VERSIONS,
  PRIMARY_REVIEW_AGENT,
  SUB_REVIEW_AGENT,
} from './agent/builtin.js'
