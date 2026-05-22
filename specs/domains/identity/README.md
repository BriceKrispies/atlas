# Identity

**Platform:** Spine
**Status:** Active — content migrated from legacy locations.

## Purpose

Users, principals, sessions, SSO, API keys — who's calling and how the platform knows.

## Capabilities

Capabilities are the agent ownership unit — one capability ≈ one agent.

- [`tenant-admin-invites-user`](./capabilities/tenant-admin-invites-user/README.md) — seeded tenant-admin invites a user by email + role; invitee accepts the magic-link, sets a password, logs in. First I20 zero-restart demonstration (frontend + spec + BDD only).

## Cross-references

- Spec: [./authn.md](./authn.md) — authentication, Principal model, JWT/test-auth
- Spec: [./identity.md](./identity.md) — User entity, lifecycle, profiles
- Spec: [./tokens/](./tokens/) — token registry/evaluation
