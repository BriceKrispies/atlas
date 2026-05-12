/**
 * EditorAPI — the public, imperative surface for mutating a page.
 *
 * Exposed as `contentPageEl.editor` whenever the element is in edit mode
 * (or whenever `canEdit=true`, even in view mode — agents shouldn't need
 * to flip the UI on to make changes).
 */

import type {
  ApplyResult,
  EditorAction,
  EditorController,
  EditorReason,
  EntrySnapshot,
  Position,
} from './editor-controller.ts';
import type { PageDocument } from '../page-store.ts';

export interface AddArgs {
  widgetId: string;
  region: string;
  /** defaults to append */
  index?: number;
  /** auto-generated if omitted */
  instanceId?: string;
  /** defaults to {} */
  config?: Record<string, unknown>;
}

export interface MoveArgs {
  instanceId: string;
  /** target region */
  region: string;
  /** defaults to append */
  index?: number;
}

export interface UpdateArgs {
  instanceId: string;
  /** replaces the existing config */
  config: Record<string, unknown>;
}

export interface RemoveArgs {
  instanceId: string;
}

export type ApiReason = EditorReason | 'not-editable' | 'persist-failed';

export interface ApiOkResult {
  ok: true;
  action?: EditorAction;
  noop?: boolean;
  instanceId?: string;
  widgetId?: string;
  from?: Position;
  to?: Position;
}

export interface ApiFailResult {
  ok: false;
  reason: ApiReason;
  message?: string;
}

export type ApiResult = ApiOkResult | ApiFailResult;

export interface GetResult {
  instanceId: string;
  widgetId: string;
  region: string;
  index: number;
  config: Record<string, unknown>;
}

export interface CommitPatch {
  instanceId?: string;
  widgetId?: string;
  from: Position | null;
  to: Position | null;
}

export interface CommitRecord {
  surfaceId: string;
  intent: string;
  patch: CommitPatch | Record<string, unknown>;
  at: number;
}

export interface EditorSnapshot {
  surfaceId: string;
  document: PageDocument;
  entries: EntrySnapshot[];
  dirty: boolean;
  lastCommit: CommitRecord | null;
}

export interface CommitInfo {
  action: EditorAction;
  instanceId?: string;
  widgetId?: string;
  from?: Position;
  to?: Position;
}

export interface EditorAPIOptions {
  controller: EditorController;
  onCommit?: (nextDoc: PageDocument, info: CommitInfo) => Promise<void>;
  onTelemetry?: (event: string, payload: Record<string, unknown>) => void;
  announce?: (msg: string) => void;
  /** gate; returns false to reject every mutation with reason 'not-editable'. Defaults to always true. */
  isEditable?: () => boolean;
  /** surface id for commit envelopes. */
  surfaceId?: string;
}

/**
 * Build a fresh instanceId for a widget. Not cryptographically unique — just
 * uncollidable in practice and readable in the DOM / telemetry.
 */
export function freshInstanceId(widgetId: string | null | undefined): string {
  const prefix = String(widgetId ?? 'w').split('.').pop() || 'w';
  const rand = Math.random().toString(36).slice(2, 8);
  const stamp = Date.now().toString(36);
  return `w-${prefix}-${stamp}-${rand}`;
}

/**
 * Extract top-level property defaults from a JSON Schema (draft-07) object.
 * Only reads `properties[key].default` — nested defaults and `$ref`s are
 * out of scope; widget schemas in this repo are flat.
 */
function schemaDefaults(schema: unknown): Record<string, unknown> {
  if (schema === null || typeof schema !== 'object' || !('properties' in schema)) {
    return {};
  }
  const props: unknown = schema.properties;
  if (props === null || typeof props !== 'object') return {};
  const out: Record<string, unknown> = {};
  // `props` is an unknown object; index reads via Reflect.get keep the
  // value typed as `unknown` (avoids both `as Record<…>` casts and the
  // implicit `any` from Object.entries on an `object`).
  for (const key of Object.keys(props)) {
    const prop: unknown = Reflect.get(props, key);
    if (prop !== null && typeof prop === 'object' && 'default' in prop) {
      const def: unknown = prop.default;
      out[key] = def;
    }
  }
  return out;
}

export type ApiOp = 'add' | 'move' | 'update' | 'remove';

export class EditorAPI {
  private _controller: EditorController;
  private _commit: (nextDoc: PageDocument, info: CommitInfo) => Promise<void>;
  private _telemetry: (event: string, payload: Record<string, unknown>) => void;
  private _announce: (msg: string) => void;
  private _isEditable: () => boolean;
  private _surfaceId: string;
  private _lastCommit: CommitRecord | null = null;
  private _dirty = false;

  constructor({
    controller,
    onCommit,
    onTelemetry,
    announce,
    isEditable,
    surfaceId,
  }: EditorAPIOptions) {
    this._controller = controller;
    this._commit = typeof onCommit === 'function' ? onCommit : async () => {};
    this._telemetry = typeof onTelemetry === 'function' ? onTelemetry : () => {};
    this._announce = typeof announce === 'function' ? announce : () => {};
    this._isEditable = typeof isEditable === 'function' ? isEditable : () => true;
    this._surfaceId = surfaceId ?? 'editor';
  }

  /**
   * Snapshot of the editor's externally-observable state. Used by the
   * `@atlas/test-state` registry (see interaction-contracts.md).
   */
  getSnapshot(): EditorSnapshot {
    return {
      surfaceId: this._surfaceId,
      document: this._controller.doc,
      entries: this._controller.listEntries(),
      dirty: this._dirty,
      lastCommit: this._lastCommit,
    };
  }

  get lastCommit(): CommitRecord | null {
    return this._lastCommit;
  }

  // ---- introspection (synchronous) ----

  /**
   * Snapshot of every widget entry on the page, as positional records.
   * Stable across calls (always reflects the latest committed doc).
   */
  list(): EntrySnapshot[] {
    return this._controller.listEntries();
  }

  /**
   * Fetch a single entry by instanceId. Returns null if the instance is
   * unknown.
   */
  get(instanceId: string): GetResult | null {
    const found = this._controller.findInstance(instanceId);
    if (!found) return null;
    return {
      instanceId,
      widgetId: found.entry.widgetId,
      region: found.region,
      index: found.index,
      config: found.entry.config ?? {},
    };
  }

  /**
   * Pure validation — would this call succeed right now? Handy for
   * highlighting drop zones without performing the mutation.
   *
   * Overloads bind each `op` literal to its matching args shape, so the
   * call site is type-checked. The implementation routes through the
   * already-typed `add` / `move` / `update` / `remove` paths without
   * persisting (rolls back after each dry-run).
   */
  can(op: 'add', args: AddArgs): ApiResult;
  can(op: 'move', args: MoveArgs): ApiResult;
  can(op: 'update', args: UpdateArgs): ApiResult;
  can(op: 'remove', args: RemoveArgs): ApiResult;
  can(op: ApiOp, args: AddArgs | MoveArgs | UpdateArgs | RemoveArgs): ApiResult {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    const preDoc = this._controller.doc;
    const result = this._dryRun(op, args);
    if (result === null) return { ok: false, reason: 'invalid-entry' };
    if (result.ok) this._controller.setDoc(preDoc); // roll back dry-run
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  /**
   * Apply the matching controller primitive without rolling back. The
   * caller (`can`) handles the rollback. Args are routed by `op` using
   * `in` narrowing on the discriminating fields so no `as` casts are
   * needed; if the op/args pair doesn't fit any branch we return null
   * and the caller maps that to `invalid-entry`.
   */
  private _dryRun(
    op: ApiOp,
    args: AddArgs | MoveArgs | UpdateArgs | RemoveArgs,
  ): ApplyResult | null {
    switch (op) {
      case 'add':
        if (!('widgetId' in args) || !('region' in args)) return null;
        return this._controller.applyAdd({
          entry: {
            widgetId: args.widgetId,
            instanceId: args.instanceId ?? freshInstanceId(args.widgetId),
            config: args.config ?? {},
          },
          region: args.region,
          ...(args.index !== undefined ? { index: args.index } : {}),
        });
      case 'move':
        if (!('instanceId' in args) || !('region' in args)) return null;
        return this._controller.applyMove({
          instanceId: args.instanceId,
          region: args.region,
          ...(args.index !== undefined ? { index: args.index } : {}),
        });
      case 'update':
        if (!('instanceId' in args) || !('config' in args)) return null;
        return this._controller.applyUpdate({
          instanceId: args.instanceId,
          config: args.config,
        });
      case 'remove':
        if (!('instanceId' in args)) return null;
        return this._controller.applyRemove({ instanceId: args.instanceId });
      default:
        return null;
    }
  }

  // ---- mutations (async) ----

  async add(args: AddArgs): Promise<ApiResult> {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    if (!args || !args.widgetId || !args.region) {
      return { ok: false, reason: 'invalid-entry' };
    }
    const schema = this._controller.getSchema?.(args.widgetId) ?? null;
    const defaults = schemaDefaults(schema);
    const entry = {
      widgetId: args.widgetId,
      instanceId: args.instanceId ?? freshInstanceId(args.widgetId),
      config: { ...defaults, ...(args.config ?? {}) },
    };
    const result = this._controller.applyAdd({
      entry,
      region: args.region,
      ...(args.index !== undefined ? { index: args.index } : {}),
    });
    return this._finalize(result);
  }

  async move(args: MoveArgs): Promise<ApiResult> {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    if (!args || !args.instanceId || !args.region) {
      return { ok: false, reason: 'invalid-entry' };
    }
    const result = this._controller.applyMove(args);
    return this._finalize(result);
  }

  async update(args: UpdateArgs): Promise<ApiResult> {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    if (!args || !args.instanceId) {
      return { ok: false, reason: 'invalid-entry' };
    }
    const result = this._controller.applyUpdate(args);
    return this._finalize(result);
  }

  async remove(args: RemoveArgs): Promise<ApiResult> {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    if (!args || !args.instanceId) {
      return { ok: false, reason: 'invalid-entry' };
    }
    const result = this._controller.applyRemove(args);
    return this._finalize(result);
  }

  // ---- internal ----

  private async _finalize(result: ApplyResult): Promise<ApiResult> {
    if (!result.ok) {
      this._announce(`${result.reason.replace(/-/g, ' ')}.`);
      this._telemetry('atlas.content-page.edit.rejected', {
        reason: result.reason,
        action: result.action,
      });
      return { ok: false, reason: result.reason };
    }
    if (result.noop) {
      // Valid but nothing changed — skip persistence.
      this._telemetry('atlas.content-page.edit.noop', {
        action: result.action,
        instanceId: result.instanceId,
      });
      return {
        ok: true,
        noop: true,
        action: result.action,
        ...(result.instanceId !== undefined ? { instanceId: result.instanceId } : {}),
        ...(result.widgetId !== undefined ? { widgetId: result.widgetId } : {}),
        ...(result.from !== undefined ? { from: result.from } : {}),
        ...(result.to !== undefined ? { to: result.to } : {}),
      };
    }
    try {
      await this._commit(result.nextDoc, {
        action: result.action,
        ...(result.instanceId !== undefined ? { instanceId: result.instanceId } : {}),
        ...(result.widgetId !== undefined ? { widgetId: result.widgetId } : {}),
        ...(result.from !== undefined ? { from: result.from } : {}),
        ...(result.to !== undefined ? { to: result.to } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._announce(`Save failed: ${message}`);
      this._telemetry('atlas.content-page.save.error', { message });
      return { ok: false, reason: 'persist-failed', message };
    }
    this._telemetry('atlas.content-page.edit', {
      action: result.action,
      instanceId: result.instanceId,
      widgetId: result.widgetId,
      fromRegion: result.from?.region,
      fromIndex: result.from?.index,
      toRegion: result.to?.region,
      toIndex: result.to?.index,
    });
    this._recordCommit(result);
    return {
      ok: true,
      action: result.action,
      ...(result.instanceId !== undefined ? { instanceId: result.instanceId } : {}),
      ...(result.widgetId !== undefined ? { widgetId: result.widgetId } : {}),
      ...(result.from !== undefined ? { from: result.from } : {}),
      ...(result.to !== undefined ? { to: result.to } : {}),
    };
  }

  private _recordCommit(result: ApplyResult & { ok: true }): void {
    this._lastCommit = {
      surfaceId: this._surfaceId,
      intent: result.action,
      patch: {
        ...(result.instanceId !== undefined ? { instanceId: result.instanceId } : {}),
        ...(result.widgetId !== undefined ? { widgetId: result.widgetId } : {}),
        from: result.from ?? null,
        to: result.to ?? null,
      },
      at: Date.now(),
    };
    this._dirty = true;
  }

  /**
   * Reset the dirty flag (e.g. after an external save). Does not affect
   * `lastCommit` — tests can still inspect the most recent intent.
   */
  markClean(): void {
    this._dirty = false;
  }

  /**
   * Record a commit for an intent that didn't flow through the apply*
   * primitives (e.g. DnD drops that wrap a move, resize gestures).
   */
  recordExternalCommit(intent: string, patch: Record<string, unknown>): void {
    this._lastCommit = {
      surfaceId: this._surfaceId,
      intent,
      patch: patch ?? {},
      at: Date.now(),
    };
  }
}
