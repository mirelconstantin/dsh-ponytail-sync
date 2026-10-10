/**
 * Loader entry that publishes the ponytail rules into the system prompt.
 *
 * This is what makes ponytail something every model knows about rather than a
 * skill it never loads: the section names the active level, states the one
 * behavioural difference between levels, and tells the model to load the skill.
 *
 * The layer carries no configuration of its own, so a settings reload can move
 * the default level underneath without ever taking the guidance out of the
 * prompt.
 *
 * @module dsh-ponytail-sync/entry-prompt
 */

import { SERVICE } from './runtime.js'
import { buildSection } from './prompt.js'

/** Loader identity. */
export const name = 'dsh-ponytail-sync-prompt'

/**
 * Required services: system-prompt assembly and our own runtime.
 *
 * `skills` is deliberately NOT injected — see `index.js` for the full reason.
 *
 * @type {string[]}
 */
export const inject = ['systemPrompt', SERVICE]

/**
 * Publish the guidance section.
 *
 * @param {any} ctx - Cordis context.
 * @returns {() => void} the section disposer.
 */
export function apply (ctx) {
  const runtime = ctx.get(SERVICE)
  return ctx.systemPrompt.section({
    name: 'ponytail:guide',
    // Just after the plain web-fetch guidance, so the model reads "there is a
    // mode that keeps your change small" alongside the other tool blocks.
    order: resolveOrder(ctx),
    // Literal text: the section names commands and uses quotes that must not be
    // treated as prompt variables.
    interpolate: false,
    text: (context) => buildSection(runtime, ctx, context?.scope),
  })
}

/**
 * Resolve where this section belongs in the assembled prompt.
 *
 * @param {any} ctx - Cordis context exposing `systemPrompt`.
 * @returns {number} the section order.
 */
function resolveOrder (ctx) {
  try {
    const resolved = typeof ctx.systemPrompt.getSectionOrder === 'function'
      ? ctx.systemPrompt.getSectionOrder('TOOL_WEB_FETCH')
      : null
    if (Number.isFinite(resolved)) return resolved + 20
  } catch {
    // An unknown anchor in one release is not a reason to drop the section.
  }
  return 2130
}
