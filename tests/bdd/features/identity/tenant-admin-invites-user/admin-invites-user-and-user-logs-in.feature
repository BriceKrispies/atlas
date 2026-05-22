@server
Feature: Tenant admin invites a user and the new user logs in with a real password
  # Spec:   specs/domains/identity/capabilities/tenant-admin-invites-user/README.md
  # Ticket: tickets/identity/tenant-admin-invites-user.md
  #
  # First end-to-end feature against a real tenant (acme), and the first
  # I20 zero-restart demonstration. Per the ticket Scope:
  #
  #   1. The seeded TenantAdmin for `acme` logs into acme.localhost:3000
  #      with a REAL password (not X-Debug-Principal — see sdet
  #      pushback #1; the BDD must witness the password-login path
  #      because that's part of "real login" in the user's stated goal).
  #   2. Tenant-admin opens the Users surface; sees the existing admin
  #      membership; clicks Invite User; submits an invite for
  #      invitee@example.com with role Viewer. Issues Identity.Invite.Issue
  #      scoped to `acme` with cacheInvalidationTags
  #      ['Tenant:acme', 'Invite:<id>'].
  #   3. SmtpMailer dispatches the magic link via smtp4dev; the BDD polls
  #      `/api/Messages` for the message (deadline-bounded, see sdet
  #      pushback #2) AND asserts the email_log row exists with the
  #      magic-link URL embedded.
  #   4. A second browser context (the invitee) opens the magic link,
  #      lands on /invite/accept?token=…, which issues
  #      Identity.Invite.Accept (creates the User + Membership for acme).
  #   5. The invitee is redirected to /invite/set-password, sets a
  #      password (Identity.User.SetPassword), then redirected to /login,
  #      and submits email + password — Identity.Login.Password +
  #      Identity.AuthSession.Issue set the session cookie. Final state:
  #      invitee lands on the tenant home as an authenticated Viewer.
  #   6. The admin's original context refreshes Users; the new membership
  #      is now visible.
  #
  # Tagged @server so the @sim IDB-snapshot hooks don't fire. Runs under
  # playwright.bdd.server.config.ts — see sdet pushback note re: that
  # config's feature glob (currently `features/tenancy/**` only; must be
  # broadened to include `features/identity/**` before this scenario can
  # execute under `pnpm bdd:server`).
  #
  # Invariants asserted explicitly:
  #   I2  — non-TenantAdmin invite attempt: 403, no event emitted
  #          (sibling scenario below).
  #   I5  — every step's structured log line carries the same
  #          correlationId we pin via X-Correlation-Id at submit-time.
  #   I10 — every event in the loop carries cacheInvalidationTags with
  #          Tenant:acme plus the per-resource tag.
  #   I18 — every new surface returns a getSurfaceSnapshot() snapshot
  #          via /api/v1/surfaces; the BDD asserts on snapshot.state at
  #          every step rather than DOM scraping.
  #   I20 — apps/server boot identity (bootId + startedAt) captured in
  #          the Background and re-asserted at scenario end; any
  #          mid-flight restart fails the scenario.

  Background:
    # I20 zero-restart probe — capture the server's bootId once at the
    # start of the scenario and re-assert it at the end. Requires a
    # readiness response or admin probe that returns a per-boot identity
    # (uuid generated in bootstrap.ts, stable across the process
    # lifetime). See sdet pushback #6 for the assertion shape.
    Given the Atlas stack is running with smtp4dev wired
    And I capture the apps/server bootId for the I20 zero-restart probe
    And the seeded TenantAdmin for tenant "acme" exists in control-plane
    And the control-plane identity tables are clean for this run

  Scenario: tenant admin invites a viewer, viewer sets a password, viewer logs in
    # ─────────────────────────────────────────────────────────────────
    # Step 1 — Tenant admin signs in with a REAL password.
    # ─────────────────────────────────────────────────────────────────
    When the tenant admin opens the Login surface at acme.localhost
    Then the Login surface snapshot has state "ready" and surfaceId "identity.login"
    And the Login surface snapshot exposes the "submit" action

    When the tenant admin submits email and password to the Login surface
    Then the Login surface snapshot has state "submitting" then "success"
    And the response sets a session cookie scoped to ".acme.localhost"
    And the Identity.Login.Password event carries cacheInvalidationTags ["Tenant:acme", "User:<adminUserId>"]
    And the Identity.AuthSession.Issue event carries cacheInvalidationTags ["Tenant:acme", "User:<adminUserId>", "Session:<sessionId>"]
    And the structured log records "Identity.AuthSession.Issue" tagged with this run's correlationId

    # ─────────────────────────────────────────────────────────────────
    # Step 2 — Admin opens Users surface; lists existing memberships.
    # ─────────────────────────────────────────────────────────────────
    When the tenant admin opens the Users surface at acme.localhost
    Then the Users surface snapshot has state "loading" then "success"
    And the Users surface snapshot data lists exactly 1 membership for tenant "acme"
    And the Users surface snapshot exposes the "invite" action

    # ─────────────────────────────────────────────────────────────────
    # Step 3 — Admin opens Invite Form, submits invite for a viewer.
    # ─────────────────────────────────────────────────────────────────
    When the tenant admin opens the Invite Form surface
    Then the Invite Form surface snapshot has state "ready" and surfaceId "identity.invite-form"
    And the Invite Form surface snapshot exposes the "submit" and "cancel" actions

    When the tenant admin submits the invite for "invitee@example.com" with role "Viewer"
    Then the Invite Form surface snapshot has state "submitting" then "success"
    And the Identity.Invite.Issue event carries cacheInvalidationTags ["Tenant:acme", "Invite:<inviteId>"]
    And control_plane.email_log carries the magic-link URL for "invitee@example.com" for this run
    And smtp4dev has received exactly one message for "invitee@example.com"
    And the message body contains the role "Viewer"
    And the structured log records "Identity.Invite.Issue" tagged with this run's correlationId

    # ─────────────────────────────────────────────────────────────────
    # Step 4 — Switch to invitee context; click magic link.
    # ─────────────────────────────────────────────────────────────────
    When the invitee opens the magic link in a second browser context
    Then the Accept Invite surface snapshot has state "loading" then "success"
    And the Accept Invite surface snapshot has surfaceId "identity.accept-invite"
    And the Identity.Invite.Accept event carries cacheInvalidationTags ["Tenant:acme", "Invite:<inviteId>", "User:<inviteeUserId>", "Membership:<membershipId>"]
    And the structured log records "Identity.Invite.Accept" tagged with this run's correlationId

    # ─────────────────────────────────────────────────────────────────
    # Step 5 — Invitee sets a password.
    # ─────────────────────────────────────────────────────────────────
    Then the invitee is redirected to the Set Password surface
    And the Set Password surface snapshot has state "ready" and surfaceId "identity.set-password"
    And the Set Password surface snapshot exposes the "submit" action

    When the invitee submits a valid password to the Set Password surface
    Then the Set Password surface snapshot has state "submitting" then "success"
    And the Identity.User.SetPassword event carries cacheInvalidationTags ["Tenant:acme", "User:<inviteeUserId>"]
    And the structured log records "Identity.User.SetPassword" tagged with this run's correlationId

    # ─────────────────────────────────────────────────────────────────
    # Step 6 — Invitee logs in with the password they just set.
    # ─────────────────────────────────────────────────────────────────
    Then the invitee is redirected to the Login surface
    When the invitee submits email and password to the Login surface
    Then the Login surface snapshot has state "submitting" then "success"
    And the response sets a session cookie scoped to ".acme.localhost"
    And the Identity.Login.Password event carries cacheInvalidationTags ["Tenant:acme", "User:<inviteeUserId>"]
    And the Identity.AuthSession.Issue event carries cacheInvalidationTags ["Tenant:acme", "User:<inviteeUserId>", "Session:<inviteeSessionId>"]
    And the invitee lands on the tenant home as authenticated "Viewer"
    And the structured log records "Identity.AuthSession.Issue" tagged with this run's correlationId

    # ─────────────────────────────────────────────────────────────────
    # Step 7 — Switch back to admin context; refresh; see new member.
    # ─────────────────────────────────────────────────────────────────
    When the tenant admin's original browser context refreshes the Users surface
    Then the Users surface snapshot has state "loading" then "success"
    And the Users surface snapshot data lists exactly 2 memberships for tenant "acme"
    And the Users surface snapshot data contains a membership for "invitee@example.com" with role "Viewer"

    # ─────────────────────────────────────────────────────────────────
    # I20 zero-restart check — apps/server has not restarted.
    # ─────────────────────────────────────────────────────────────────
    Then the apps/server bootId matches the value captured in the Background

  Scenario: I2 negative — a non-TenantAdmin issuing an invite to `acme` is denied with no side effects
    # Sibling scenario rather than a separate file: it tests the same
    # capability (`Identity.Invite.Issue` scoped to `acme`), and keeping
    # it adjacent makes the deny-path obvious to anyone reading the
    # feature. Asserts I2 directly: 403 + zero events appended to the
    # tenant's event store for this attempt.
    Given the Atlas stack is running with smtp4dev wired
    And the seeded TenantAdmin for tenant "acme" exists in control-plane
    And a non-TenantAdmin user "stranger@example.com" exists with no membership in "acme"
    And the control-plane identity tables are clean for this run

    When "stranger@example.com" submits Identity.Invite.Issue scoped to tenant "acme" with email "outsider@example.com"
    Then the response status is 403
    And the response body carries error code "authorization.denied"
    And no Identity.InviteIssued event was appended to tenant "acme"'s event store
    And no Identity.Invite.Issue cache row was written for tenant "acme"
    And smtp4dev has received exactly 0 messages for "outsider@example.com"
    And the structured log records "Authorization.Deny" tagged with this run's correlationId
