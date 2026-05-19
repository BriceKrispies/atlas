@server
Feature: Atlas admin approves a public signup request
  # Spec: specs/domains/tenancy/capabilities/public-signup/README.md
  #
  # Drives the full anonymous-submit -> admin-approve -> tenant-provision
  # -> magic-link-email loop against real apps/server + Postgres +
  # smtp4dev. Asserts via structured logs, control_plane.email_log,
  # smtp4dev REST, and direct Postgres queries on control_plane.tenants
  # + the new tenant's per-tenant DB.
  #
  # Tagged @server so the @sim hooks (IDB snapshot) don't fire and the
  # playwright.bdd.server.config.ts webServer block brings up the real
  # stack. The After('@server', ...) hook in tests/bdd/support/hooks.ts
  # cleans up signup_requests / tenants / custom_domains / email_log
  # rows for this run on scenario exit.
  #
  # Mailer event name: 'Mailer.Send.Success' (Domain.Verb.Outcome) —
  # the SMTP adapter (adapters/node/src/mailer-smtp.ts:135) already
  # emits this. Slice 5 renames StdoutEventMailer's 'mailer.sent' to
  # match; this scenario runs MAILER_MODE=smtp so it sees the canonical
  # name today.

  Scenario: anonymous user signs up, platform-admin approves, magic link arrives
    Given the Atlas stack is running with smtp4dev wired
    And the seeded platform-admin exists in the _platform tenant
    And the control-plane signup tables are clean for this run

    When an anonymous user submits a signup request
    Then the response is 202 with a correlationId
    And the signup row is queued with status "pending"

    When the platform-admin lists pending signups
    Then the listed signup matches this run

    When the platform-admin approves the signup
    Then a tenant row for this run exists in control_plane.tenants
    And the per-tenant entities table exists in the new tenant DB
    And the structured log records a "Mailer.Send.Success" event tagged with this run's correlationId
    And the Tenancy.SignupApproved event carries cache invalidation tags for this tenant and signup
    And control_plane.email_log carries the magic-link URL for this run
    And smtp4dev has received exactly one message for this run
    And the signup row is "approved"
