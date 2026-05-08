/**
 * ID minters for the repository module.
 *
 * `repo-` and `rev-` prefixes mirror the convention used elsewhere in the
 * codebase (`signup-`, `event-`, `audit-`). The values are tenant-scoped
 * opaque strings — adapters never parse them.
 */

export function newRepoId(): string {
  return `repo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newRevisionId(): string {
  return `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mint a repository-scoped event id. Mirrors the prefix convention used by
 * the tenancy + identity modules so cross-module event-store dumps stay
 * visually consistent.
 */
export function newEventId(): string {
  return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
