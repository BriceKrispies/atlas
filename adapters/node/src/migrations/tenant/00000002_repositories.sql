-- Per-tenant tables for the code/repository upload-tarball capability.
--
-- Capability spec: specs/domains/code/repository/capabilities/upload-tarball/README.md
--
-- Phase 1: bytes live in BYTEA on the per-tenant DB. When object-storage lands,
-- the RepositoryRevisionStore adapter migrates to object-storage; the port
-- surface stays the same (see capability spec, "What's NOT in scope").

CREATE TABLE repositories (
    repo_id        TEXT PRIMARY KEY,
    repo_slug      TEXT NOT NULL,
    name           TEXT NOT NULL,
    description    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     TEXT NOT NULL,
    UNIQUE (repo_slug)
);

CREATE TABLE repository_revisions (
    revision_id    TEXT PRIMARY KEY,
    repo_id        TEXT NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
    byte_count     INTEGER NOT NULL,
    content_hash   TEXT NOT NULL,           -- sha256 of the tarball, hex
    bytes          BYTEA NOT NULL,
    pushed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    pushed_by      TEXT NOT NULL,
    correlation_id TEXT NOT NULL
);

CREATE INDEX repository_revisions_by_repo
    ON repository_revisions (repo_id, pushed_at DESC);
