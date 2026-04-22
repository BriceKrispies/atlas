/**
 * dnd/commit.js — the commit boundary.
 *
 * This is the ONLY place where a finalized drag result mutates application
 * state. Pointer movement, overlay positioning, and projection are visual-
 * only; the commit layer is called exactly once per drag, on drop, and
 * only if a valid target exists.
 *
 * The commit layer is responsible for:
 *   - Resolving payload + target into a typed command the app understands.
 *   - Invoking the application handler (e.g. EditorAPI.move / add).
 *   - Returning a result the controller can announce / report.
 *
 * Keep this layer synchronous-ish (it may await the app handler, but it
 * MUST NOT perform DOM measurements, schedule animations, or run any
 * high-frequency work).
 */

/**
 * @typedef {object} CommitHandlers
 * @property {(args: {
 *   payload: import('./types.js').DragPayload,
 *   target: import('./types.js').DropTarget,
 * }) => Promise<{ ok: boolean, reason?: string, [k: string]: any }>} onDrop
 */

export class CommitBoundary {
  /** @param {CommitHandlers} handlers */
  constructor(handlers) {
    this._onDrop = handlers?.onDrop;
  }

  /**
   * @param {{
   *   payload: import('./types.js').DragPayload,
   *   target: import('./types.js').DropTarget,
   * }} args
   */
  async commit(args) {
    if (typeof this._onDrop !== 'function') {
      return { ok: false, reason: 'no-commit-handler' };
    }
    try {
      const result = await this._onDrop(args);
      return result ?? { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: 'commit-threw',
        message: err?.message ?? String(err),
      };
    }
  }
}
