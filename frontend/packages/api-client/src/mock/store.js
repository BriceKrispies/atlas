/**
 * In-memory data store for mock backend.
 *
 * Provides CRUD operations with simulated latency and event emission.
 * When a mutation occurs, subscribers are notified (simulating SSE).
 */

import { pages as seedPages } from './data/pages.js';

/** @type {Map<string, Array<Object>>} */
const collections = new Map();

/** @type {Map<string, Set<(event: Object) => void>>} */
const listeners = new Map();

// Initialize with seed data
collections.set('pages', [...seedPages]);

/**
 * Simulate network latency (50-200ms).
 * @returns {Promise<void>}
 */
function delay() {
  return new Promise((resolve) =>
    setTimeout(resolve, 50 + Math.random() * 150)
  );
}

/**
 * Emit an event to all subscribers of a given event type.
 * @param {string} eventType
 * @param {Object} payload
 */
function emitEvent(eventType, payload) {
  const subs = listeners.get(eventType);
  if (subs) {
    for (const callback of subs) {
      // Async to simulate SSE delivery
      setTimeout(() => callback(payload), 10);
    }
  }
}

/**
 * List all items in a collection.
 * @param {string} collection
 * @returns {Promise<Object[]>}
 */
export async function list(collection) {
  await delay();
  return [...(collections.get(collection) ?? [])];
}

/**
 * Get a single item by ID.
 * @param {string} collection
 * @param {string} id
 * @param {string} [idField='pageId']
 * @returns {Promise<Object | null>}
 */
export async function getById(collection, id, idField = 'pageId') {
  await delay();
  const items = collections.get(collection) ?? [];
  return items.find((item) => item[idField] === id) ?? null;
}

/**
 * Create a new item in a collection.
 * @param {string} collection
 * @param {Object} item
 * @returns {Promise<Object>}
 */
export async function create(collection, item) {
  await delay();
  const items = collections.get(collection) ?? [];
  items.push(item);
  collections.set(collection, items);

  emitEvent('projection.updated', {
    eventType: 'projection.updated',
    resourceType: collection.replace(/s$/, ''),
    resourceId: item.pageId ?? item.id,
    occurredAt: new Date().toISOString(),
  });

  return item;
}

/**
 * Delete an item from a collection by ID.
 * @param {string} collection
 * @param {string} id
 * @param {string} [idField='pageId']
 * @returns {Promise<boolean>}
 */
export async function remove(collection, id, idField = 'pageId') {
  await delay();
  const items = collections.get(collection) ?? [];
  const index = items.findIndex((item) => item[idField] === id);
  if (index === -1) return false;

  items.splice(index, 1);

  emitEvent('projection.updated', {
    eventType: 'projection.updated',
    resourceType: collection.replace(/s$/, ''),
    resourceId: id,
    occurredAt: new Date().toISOString(),
  });

  return true;
}

/**
 * Subscribe to events.
 * @param {string} eventType
 * @param {(event: Object) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribe(eventType, callback) {
  if (!listeners.has(eventType)) {
    listeners.set(eventType, new Set());
  }
  listeners.get(eventType).add(callback);
  return () => listeners.get(eventType)?.delete(callback);
}
