/**
 * dnd/commit.ts — the commit boundary.
 *
 * This is the ONLY place where a finalized drag result mutates application
 * state. Pointer movement, overlay positioning, and projection are visual-
 * only; the commit layer is called exactly once per drag, on drop, and
 * only if a valid target exists.
 */

import type { CommitResult, DragPayload, DropTarget } from './types.ts';

export interface CommitArgs {
  payload: DragPayload;
  target: DropTarget;
}

export interface CommitHandlers {
  onDrop?: (args: CommitArgs) => Promise<CommitResult> | CommitResult;
}

export class CommitBoundary {
  private _onDrop: CommitHandlers['onDrop'];

  constructor(handlers: CommitHandlers | undefined) {
    this._onDrop = handlers?.onDrop;
  }

  async commit(args: CommitArgs): Promise<CommitResult> {
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
        message: (err as Error | undefined)?.message ?? String(err),
      };
    }
  }
}
