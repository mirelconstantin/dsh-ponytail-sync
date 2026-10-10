/**
 * The runtime skill registration.
 *
 * A skill rather than a prompt-only block, for three reasons. It is loadable on
 * demand rather than paid for on every request; it carries the description that
 * routes it, so the model knows when the mode applies; and it is one file a
 * user can read and edit, which the prompt section cannot be.
 *
 * Registered through `ctx.skills.register()` rather than a filesystem root. The
 * registry files a runtime registration at its own rank (250), which outranks
 * the `user-agents` copy at 500 — so this bundle wins by default — while a
 * project's own `ponytail` skill at rank 200 still correctly overrides it. That
 * is the behaviour a user editing one repository expects.
 *
 * The registry serves a runtime skill's `content` straight from the registered
 * object and never re-reads it, so the body is read once at registration and a
 * change to the vendored file needs a plugin reload. That is the documented
 * trade for not casting the body to a session event on every load.
 *
 * The read is synchronous on purpose. `ctx.effect` collects a disposer returned
 * by its body, and collects the *awaited* disposer when the body returns a
 * promise — which the real harness does and a synchronous test double does not.
 * Reading the file with `readFileSync` makes the registration itself synchronous,
 * so a hand-mounted check sees the skill appear and dispose exactly as the
 * harness sees it. A missing vendored file is a packaging error, so failing the
 * load here is the correct outcome.
 *
 * @module dsh-ponytail-sync/skills
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The one skill this bundle contributes. */
export const SKILL_NAME = 'ponytail'

/** The provider label the registry records for this contribution. */
export const SKILL_PROVIDER = 'dsh-ponytail-sync'

/** The description the session catalog shows the model. */
export const SKILL_DESCRIPTION = 'Lazy senior dev mode: the smallest change that fully solves the task, and a reply a busy human understands in one read. Use on any coding task (writing, fixing, refactoring, reviewing, choosing dependencies) and when the user says "ponytail", "be lazy", "simplest solution", "yagni", or complains about over-engineering or bloat. Levels: lite, full (default), ultra.'

/** Where the vendored body lives. */
const SKILL_BODY_URL = new URL('../assets/ponytail/SKILL.md', import.meta.url)

/**
 * Read the vendored body.
 *
 * @returns {string} the file contents, frontmatter included.
 */
export function readSkillBody () {
  return readFileSync(SKILL_BODY_URL, 'utf8')
}

/**
 * Where the vendored body lives, for diagnostics and the check script.
 *
 * @returns {string} the absolute path.
 */
export function skillBodyPath () {
  return fileURLToPath(SKILL_BODY_URL)
}

/**
 * Register the ponytail skill on the harness's skill registry.
 *
 * The registration happens inside `ctx.effect` so the registry is clean at
 * unload.
 *
 * @param {any} ctx - Cordis context providing `skills`.
 * @returns {() => void} the registration disposer.
 */
export function registerPonytailSkill (ctx) {
  const skills = typeof ctx?.get === 'function' ? ctx.get('skills') : undefined
  if (!skills || typeof skills.register !== 'function') {
    throw new Error('dsh-ponytail-sync: the skills service is not mounted')
  }
  const content = readSkillBody()
  if (content.length === 0) {
    throw new Error('dsh-ponytail-sync: the vendored skill body is empty or unreadable')
  }
  return ctx.effect(() => skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    invocation: {
      modelInvocable: true,
      userInvocable: true,
    },
    provider: SKILL_PROVIDER,
    source: 'bundled',
    content,
  }), 'ponytail.skill')
}
