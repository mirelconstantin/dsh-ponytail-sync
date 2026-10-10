/**
 * The system-prompt section that tells every model the mode is on.
 *
 * Without this the rules exist but nothing says so: a model that never loads
 * the skill works as if ponytail were not installed, and a user who has written
 * the level into their settings sees no effect and concludes it is broken.
 *
 * The section is a PROVIDER, not a string. A static section is injected into
 * every assembly, so it would follow a model into a scope where the skill
 * registry has been filtered away — a preset's `tools.restrict({ allow: [...] })`,
 * a `subagent` call's `toolFilter`, or a disabled `ponytail-skill` row — and
 * tell it to load a skill it cannot reach. Evaluated per assembly against the
 * scope it is for, it contributes nothing there and the full text elsewhere.
 *
 * @module dsh-ponytail-sync/prompt
 */

import { isActive, levelOf } from './runtime.js'

/**
 * The skill names this guidance is written about.
 *
 * Declared here rather than imported from `./skills.js` so this module keeps no
 * dependency on the skill registry: the section provider needs the names in a
 * scope where the skills themselves may have been filtered away.
 *
 * @type {readonly string[]}
 */
export const PONYTAIL_SKILL_NAMES = Object.freeze(['ponytail'])

/**
 * Whether the ponytail skill is visible in one scope.
 *
 * Resolved through `ctx.get('skills')`, never the `ctx.skills` property: the
 * section's `text` provider runs during a prompt assembly on a different fiber,
 * where a direct property read can fail through a traceable shadow and throw
 * `cannot get property "skills" without inject`. `ctx.get` is
 * topology-independent and returns `undefined` while the registry is absent or
 * loading, which is the correct answer for a visibility check.
 *
 * `skills.get(name, scope)` is the documented visibility resolver — the same
 * call the tools registry answers — and returns `undefined` for a name a
 * restriction has filtered away. The registry's `list()` is async and returns a
 * promise, so it cannot answer a synchronous prompt-assembly question and is
 * deliberately not used here.
 *
 * A registry that cannot answer is no reason to inject guidance about a skill
 * that may not be there, so every failure path reports false.
 *
 * @param {any} ctx - the Cordis context; `skills` is looked up with `ctx.get`.
 * @param {any} [scope] - the scope key this assembly is resolving.
 * @returns {boolean} whether at least one ponytail skill is visible.
 */
export function ponytailSkillVisible (ctx, scope) {
  let skills
  try {
    skills = typeof ctx?.get === 'function' ? ctx.get('skills') : undefined
  } catch {
    return false
  }
  if (!skills || typeof skills.get !== 'function') return false
  try {
    return PONYTAIL_SKILL_NAMES.some((name) => skills.get(name, scope) !== undefined)
  } catch {
    return false
  }
}

/**
 * Build the section text for the level the assembling session is at.
 *
 * @param {any} runtime - the ponytail runtime.
 * @param {any} ctx - the Cordis context.
 * @param {any} [scope] - the agent the assembly is for; `dsh-system-prompt`
 *   passes the agent as the scope key, which is also how `skills.get` answers.
 * @returns {string} the section text, or the empty string.
 */
export function buildSection (runtime, ctx, scope) {
  if (!runtime?.config?.promptEnabled) return ''
  const sessionId = sessionIdOf(scope)
  const level = levelOf(runtime, sessionId)
  // An off level is a decision, not an absence: publish nothing rather than a
  // section that says the mode is off on every request of every session.
  if (!isActive(level)) return ''
  if (!ponytailSkillVisible(ctx, scope)) return ''
  return runtime.section(sessionId)
}

/**
 * The session id a scope refers to.
 *
 * A prompt assembly's scope is the agent object, and the level is session state,
 * so the session id is what the runtime keys on. An agent whose session is a
 * string id, or a plain string scope, both resolve; anything else yields
 * `undefined`, which makes the runtime fall back to its configured default.
 *
 * @param {any} scope - the agent or scope key the assembly is for.
 * @returns {string | undefined} the session id, when one is reachable.
 */
export function sessionIdOf (scope) {
  if (typeof scope === 'string') return scope
  const session = scope?.session
  if (typeof session === 'string') return session
  if (session && typeof session.id === 'string') return session.id
  const header = session?.header
  if (header && typeof header.id === 'string') return header.id
  return undefined
}
