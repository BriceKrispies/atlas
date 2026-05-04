# Hierarchy: identity / magic-link
#
# Passwordless email authentication — single-use tokens delivered by
# email, exchanged for an AuthSession on click. Used both for the
# first-admin bootstrap and for ongoing passwordless login when the
# tenant enables it.

@auth @identity @magic-link
Feature: Magic-link email authentication

  Background:
    Given a tenant "scribe" with the identity module enabled

  @phase-a2
  # AuthMethod entity + tenant identity-config land alongside the rest
  # of the per-tenant auth-policy machinery in Phase A2.
  Scenario: Tenant admin enables magic-link login
    Given the admin is authenticated as a principal with role "TenantAdmin"
    When the admin submits an "Identity.AuthMethod.Enable" intent with method="magic_link"
    Then the tenant's identity config has magic_link in enabledMethods
    And an "Identity.AuthMethodEnabled" event is emitted

  @phase-a2
  # MagicLinkToken (distinct from InviteToken) + email delivery + the
  # request/redeem route pair are Phase A2.
  Scenario: User requests a magic link
    Given user "alice@scribe.com" has a Membership in tenant "scribe"
    When alice POSTs "/identity/magic-link/request" with email="alice@scribe.com"
    Then a MagicLinkToken entity is created with expiry 15 minutes from now
    And the token is single-use (status="pending")
    And alice receives an email with the link
    And an "Identity.MagicLinkRequested" event is emitted

  @phase-a2
  Scenario: Magic-link click logs the user in
    Given a pending MagicLinkToken exists for "alice@scribe.com"
    When alice opens the link in her browser
    Then the token is validated (not expired, not consumed)
    And an AuthSession is created with status "active"
    And the session cookie is set
    And the token status flips to "consumed"
    And an "Identity.LoginSucceeded" event records method="magic_link"

  @phase-a2
  Scenario: Reject expired magic link
    Given a MagicLinkToken expired 1 minute ago
    When the link is opened
    Then the response status is 410
    And reason is "link_expired"
    And the user is shown a "request a new link" CTA

  @phase-a2
  Scenario: Reject reused magic link
    Given a MagicLinkToken was consumed 5 minutes ago
    When the same link is clicked again
    Then the response status is 410
    And reason is "link_already_used"
    And an "Identity.MagicLinkReplayDetected" event is emitted (security signal)

  @phase-a2
  Scenario: Throttle repeated requests for the same email
    Given alice has requested 3 magic links in the last 5 minutes
    When she requests a 4th
    Then the response status is 429
    And no email is sent
    And the response surfaces the next-allowed-at timestamp

  @phase-a2
  Scenario: Email-not-found does not leak account existence
    When a stranger requests a magic link for "ghost@nowhere.com"
    Then the response status is 200 (timing-safe)
    And no email is dispatched
    And an "Identity.MagicLinkRequested" event is emitted with status="no_account"

  @phase-a1
  # InviteToken-based bootstrap. `atlasctl` shipping as the
  # `pnpm tenant:add-admin` script in Phase A1; full HTTP atlasctl
  # binary is later polish.
  Scenario: First-admin bootstrap (special-case magic link via atlasctl)
    Given tenant "scribe" was just provisioned with no users
    When the operator runs "atlasctl tenant add-admin scribe admin@scribe.com"
    Then an InviteToken is created (also a MagicLinkToken under the hood)
    And the magic-link URL is printed to operator stdout
    And on click, both User+Membership are created with role "TenantAdmin"
