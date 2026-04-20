/**
 * WidgetMediator — per-host async pub/sub with per-instance topic permissions.
 *
 * Honors:
 *   INV-WIDGET-02: publish/subscribe on undeclared topics throws UndeclaredTopicError.
 *   INV-WIDGET-05: delivery is always asynchronous (microtask-scheduled).
 *   INV-WIDGET-09: payloads are structured-cloned at delivery to enforce
 *                  JSON-serializable boundary semantics.
 *
 * Scope: one mediator per <widget-host>. Widgets on a sibling host cannot
 * hear each other — there is no global bus.
 */

import { UndeclaredTopicError } from './errors.js';

/**
 * @param {object | undefined} manifest
 * @param {'provides' | 'consumes'} side
 * @returns {Set<string>}
 */
function topicsOf(manifest, side) {
  const list = manifest?.[side]?.topics ?? [];
  return new Set(list);
}

function clonePayload(payload) {
  if (payload === undefined) return undefined;
  try {
    return structuredClone(payload);
  } catch (err) {
    const e = new Error(
      `widget payload is not structured-cloneable: ${err?.message ?? String(err)}`,
    );
    e.cause = err;
    throw e;
  }
}

export class WidgetMediator {
  /**
   * @param {{ onTrace?: (event: object) => void }} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, { provides: Set<string>, consumes: Set<string> }>} */
    this._instances = new Map();
    /** @type {Map<string, Set<{ instanceId: string, handler: Function }>>} */
    this._subs = new Map();
    /** @type {((event: object) => void) | null} */
    this._onTrace = typeof options.onTrace === 'function' ? options.onTrace : null;
  }

  /**
   * @param {object} event
   * @private
   */
  _trace(event) {
    if (!this._onTrace) return;
    try {
      this._onTrace(event);
    } catch (err) {
      // A broken trace hook must not bring down dispatch.
      // eslint-disable-next-line no-console
      console.error('[widget-host] mediator onTrace threw', err);
    }
  }

  /**
   * @param {string} instanceId
   * @param {object} manifest
   */
  registerInstance(instanceId, manifest) {
    this._instances.set(instanceId, {
      provides: topicsOf(manifest, 'provides'),
      consumes: topicsOf(manifest, 'consumes'),
    });
  }

  /** @param {string} instanceId */
  revokeInstance(instanceId) {
    this._instances.delete(instanceId);
    for (const subs of this._subs.values()) {
      for (const sub of [...subs]) {
        if (sub.instanceId === instanceId) subs.delete(sub);
      }
    }
  }

  /**
   * @param {string} instanceId
   * @param {string} topic
   * @param {unknown} payload
   */
  publish(instanceId, topic, payload) {
    const perms = this._instances.get(instanceId);
    if (!perms) {
      throw new UndeclaredTopicError(
        `unknown instance ${instanceId} attempted to publish ${topic}`,
      );
    }
    if (!perms.provides.has(topic)) {
      throw new UndeclaredTopicError(
        `instance ${instanceId} may not publish undeclared topic '${topic}'`,
      );
    }

    const cloned = clonePayload(payload);
    const subs = this._subs.get(topic);
    this._trace({
      kind: 'publish',
      from: instanceId,
      topic,
      payload: cloned,
      subscriberCount: subs ? subs.size : 0,
    });
    if (!subs || subs.size === 0) return;

    // Snapshot to avoid mutation-during-iteration.
    const snapshot = [...subs];
    queueMicrotask(() => {
      for (const sub of snapshot) {
        try {
          // Each subscriber gets its own clone — INV-WIDGET-09 parity.
          const perSubscriber =
            cloned === undefined ? undefined : structuredClone(cloned);
          this._trace({
            kind: 'deliver',
            from: instanceId,
            to: sub.instanceId,
            topic,
            payload: perSubscriber,
          });
          // Fire and forget — swallow errors so one bad subscriber doesn't
          // break dispatch to siblings (INV-WIDGET-07 spirit).
          Promise.resolve()
            .then(() => sub.handler(perSubscriber))
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.error('[widget-host] subscriber threw', {
                topic,
                instanceId: sub.instanceId,
                error: err,
              });
            });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[widget-host] subscriber dispatch failed', {
            topic,
            instanceId: sub.instanceId,
            error: err,
          });
        }
      }
    });
  }

  /**
   * @param {string} instanceId
   * @param {string} topic
   * @param {(payload: unknown) => unknown} handler
   * @returns {() => void} unsubscribe
   */
  subscribe(instanceId, topic, handler) {
    const perms = this._instances.get(instanceId);
    if (!perms) {
      throw new UndeclaredTopicError(
        `unknown instance ${instanceId} attempted to subscribe to ${topic}`,
      );
    }
    if (!perms.consumes.has(topic)) {
      throw new UndeclaredTopicError(
        `instance ${instanceId} may not subscribe to undeclared topic '${topic}'`,
      );
    }
    const entry = { instanceId, handler };
    let subs = this._subs.get(topic);
    if (!subs) {
      subs = new Set();
      this._subs.set(topic, subs);
    }
    subs.add(entry);
    this._trace({ kind: 'subscribe', instanceId, topic });
    return () => {
      subs.delete(entry);
      this._trace({ kind: 'unsubscribe', instanceId, topic });
    };
  }

  /**
   * Ask-style dispatch. Resolves with the first subscriber that returns
   * a non-undefined value; rejects after `timeoutMs` if nothing answers.
   *
   * @param {string} instanceId
   * @param {string} topic
   * @param {unknown} payload
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<unknown>}
   */
  request(instanceId, topic, payload, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 2000;
    const perms = this._instances.get(instanceId);
    if (!perms) {
      return Promise.reject(
        new UndeclaredTopicError(
          `unknown instance ${instanceId} attempted to request ${topic}`,
        ),
      );
    }
    if (!perms.provides.has(topic)) {
      return Promise.reject(
        new UndeclaredTopicError(
          `instance ${instanceId} may not request undeclared topic '${topic}'`,
        ),
      );
    }

    let cloned;
    try {
      cloned = clonePayload(payload);
    } catch (err) {
      return Promise.reject(err);
    }

    const subs = this._subs.get(topic);
    const snapshot = subs ? [...subs] : [];

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `request('${topic}') timed out after ${timeoutMs}ms with no responder`,
          ),
        );
      }, timeoutMs);

      queueMicrotask(async () => {
        for (const sub of snapshot) {
          if (settled) return;
          try {
            const perSubscriber =
              cloned === undefined ? undefined : structuredClone(cloned);
            const result = await sub.handler(perSubscriber);
            if (result !== undefined) {
              settled = true;
              clearTimeout(timer);
              resolve(result);
              return;
            }
          } catch (err) {
            settled = true;
            clearTimeout(timer);
            reject(err);
            return;
          }
        }
        // No subscriber returned a value — keep waiting for timeout,
        // consistent with the spec's "first subscriber's return value"
        // semantics even if a late subscriber arrives.
      });
    });
  }
}
