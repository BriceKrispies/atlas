/**
 * In-memory data store for mock backend.
 *
 * Provides CRUD operations with simulated latency and event emission.
 * When a mutation occurs, subscribers are notified (simulating SSE).
 */

import { pages as seedPages } from './data/pages.ts';
import type { BackendEventCallback, Unsubscribe } from '../backend.ts';

type CollectionItem = Record<string, unknown>;

const collections: Map<string, CollectionItem[]> = new Map();

const listeners: Map<string, Set<BackendEventCallback>> = new Map();

// Initialize with seed data
collections.set('pages', [...seedPages]);

/**
 * Simulate network latency (50-200ms).
 */
function delay(): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, 50 + Math.random() * 150)
  );
}

/**
 * Emit an event to all subscribers of a given event type.
 */
function emitEvent(eventType: string, payload: unknown): void {
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
 */
export async function list(collection: string): Promise<CollectionItem[]> {
  await delay();
  return [...(collections.get(collection) ?? [])];
}

/**
 * Get a single item by ID.
 */
export async function getById(
  collection: string,
  id: string,
  idField: string = 'pageId'
): Promise<CollectionItem | null> {
  await delay();
  const items = collections.get(collection) ?? [];
  return items.find((item) => item[idField] === id) ?? null;
}

/**
 * Create a new item in a collection.
 */
export async function create(
  collection: string,
  item: CollectionItem
): Promise<CollectionItem> {
  await delay();
  const items = collections.get(collection) ?? [];
  items.push(item);
  collections.set(collection, items);

  emitEvent('projection.updated', {
    eventType: 'projection.updated',
    resourceType: collection.replace(/s$/, ''),
    resourceId: item['pageId'] ?? item['id'],
    occurredAt: new Date().toISOString(),
  });

  return item;
}

/**
 * Delete an item from a collection by ID.
 */
export async function remove(
  collection: string,
  id: string,
  idField: string = 'pageId'
): Promise<boolean> {
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
 */
export function subscribe(
  eventType: string,
  callback: BackendEventCallback
): Unsubscribe {
  if (!listeners.has(eventType)) {
    listeners.set(eventType, new Set());
  }
  listeners.get(eventType)!.add(callback);
  return () => {
    listeners.get(eventType)?.delete(callback);
  };
}
