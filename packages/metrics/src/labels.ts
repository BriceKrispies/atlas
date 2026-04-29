/**
 * Label validation + serialization helpers.
 *
 * Labels are strict: every metric declares its label names at
 * construction; observe/inc calls must supply EXACTLY that set. Extra
 * keys throw `MetricsLabelError` (typos must fail loud), missing keys
 * throw the same error.
 *
 * Internal encoding for the per-label-combination map: the canonical
 * key is the label values joined in the descriptor's declared order
 * with `` (an unused control char) so two combinations with the
 * same values in different declaration orders cannot collide. Empty
 * label sets collapse to the empty string, which is fine — the map
 * still uses it as a singleton key.
 */

import type { LabelValues } from './types.ts';

export class MetricsLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetricsLabelError';
  }
}

const SEP = '';

/**
 * Validate that `labels` declares exactly the same key set as
 * `labelNames`. Throws on mismatch. Returns nothing on success.
 *
 * `labels` may be undefined when `labelNames` is empty.
 */
export function validateLabels(
  labelNames: readonly string[],
  labels: LabelValues | undefined,
  metricName: string,
): void {
  if (labelNames.length === 0) {
    if (labels !== undefined && Object.keys(labels).length > 0) {
      throw new MetricsLabelError(
        `metric ${metricName} declares no labels, got: ${Object.keys(labels).join(', ')}`,
      );
    }
    return;
  }
  const provided = labels ?? {};
  const providedKeys = Object.keys(provided);
  if (providedKeys.length !== labelNames.length) {
    throw new MetricsLabelError(
      `metric ${metricName} expects labels [${labelNames.join(', ')}], got [${providedKeys.join(', ')}]`,
    );
  }
  for (const name of labelNames) {
    if (!Object.prototype.hasOwnProperty.call(provided, name)) {
      throw new MetricsLabelError(
        `metric ${metricName} missing required label: ${name}`,
      );
    }
    const value = provided[name];
    if (typeof value !== 'string') {
      throw new MetricsLabelError(
        `metric ${metricName} label ${name} must be a string, got ${typeof value}`,
      );
    }
  }
  // No extra keys (length match + every declared key present implies this,
  // but check explicitly to surface a clearer error message on typos).
  for (const key of providedKeys) {
    if (!labelNames.includes(key)) {
      throw new MetricsLabelError(
        `metric ${metricName} got unknown label: ${key} (declared: ${labelNames.join(', ')})`,
      );
    }
  }
}

/**
 * Build the internal map key for a labelled sample. Order is the
 * descriptor's declared label order — callers must have validated.
 */
export function labelKey(
  labelNames: readonly string[],
  labels: LabelValues | undefined,
): string {
  if (labelNames.length === 0) return '';
  const provided = labels ?? {};
  const parts: string[] = [];
  for (const name of labelNames) {
    const value = provided[name] ?? '';
    parts.push(value);
  }
  return parts.join(SEP);
}

/**
 * Recover the label values from an internal key, in the descriptor's
 * declared order, for serialization. Empty `labelNames` returns `{}`.
 */
export function decodeLabelKey(
  labelNames: readonly string[],
  key: string,
): LabelValues {
  if (labelNames.length === 0) return {};
  const parts = key.split(SEP);
  const out: Record<string, string> = {};
  for (let i = 0; i < labelNames.length; i += 1) {
    const name = labelNames[i];
    if (name === undefined) continue;
    out[name] = parts[i] ?? '';
  }
  return out;
}

/**
 * Escape a label value per Prometheus text-format rules:
 * `\` → `\\`, `"` → `\"`, newline → `\n`. Other control chars are
 * left alone (Prometheus allows them, even if they're ugly).
 */
export function escapeLabelValue(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else out += ch;
  }
  return out;
}

/**
 * Render a label set as a Prometheus inline label block (e.g.
 * `{action="x",decision="permit"}`) in declared order. Returns the
 * empty string when there are no labels (Prometheus does not require
 * an empty `{}`).
 *
 * `extra` is appended after the declared labels in iteration order —
 * histograms use this to add the synthetic `le` bucket label.
 */
export function renderLabels(
  labelNames: readonly string[],
  values: LabelValues,
  extra?: ReadonlyArray<readonly [string, string]>,
): string {
  const parts: string[] = [];
  for (const name of labelNames) {
    const value = values[name] ?? '';
    parts.push(`${name}="${escapeLabelValue(value)}"`);
  }
  if (extra) {
    for (const [k, v] of extra) {
      parts.push(`${k}="${escapeLabelValue(v)}"`);
    }
  }
  if (parts.length === 0) return '';
  return `{${parts.join(',')}}`;
}
