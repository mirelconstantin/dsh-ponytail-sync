/**
 * Loader entry that registers the ponytail skill.
 *
 * Kept separate from the prompt row so a configuration reload of the guidance
 * does not have to unregister and re-register the skill — which would invalidate
 * the skill catalog every model step reads.
 *
 * @module dsh-ponytail-sync/entry-skill
 */

import { registerPonytailSkill } from './skills.js'

/** Loader identity. */
export const name = 'dsh-ponytail-sync-skill'

/** Required services: the skill registry. */
export const inject = ['skills']

/**
 * Register the ponytail skill.
 *
 * @param {any} ctx - Cordis context.
 * @returns {(() => void) | undefined} the registration disposer.
 */
export function apply (ctx) {
  return registerPonytailSkill(ctx)
}
