# Hierarchy: identity / password
#
# Username + password authentication for tenants that don't use SSO
# (typical for SMB tier or personal accounts on a self-hosted Atlas).
# Argon2id hashing; rate-limit + lockout on failed attempts.

@auth @identity @password
Feature: Username + password authentication

  Background:
    Given a tenant "smb" with the identity module enabled
    And tenant "smb" has password authentication enabled
    And the admin is authenticated as a principal with role "TenantAdmin"

  Scenario: User sets initial password from invite
    Given an InviteToken exists for "alice@smb.com" in tenant "smb"
    When alice opens the magic-link URL
    And submits "/identity/password/set" with token + new password "P@ssw0rd-2026!"
    Then a User entity is created with passwordHash (Argon2id) on the entity attrs
    And the InviteToken status flips to "consumed"
    And an "Identity.PasswordSet" event is emitted (no plaintext, never)
    And a Membership is created with the role from the InviteToken

  Scenario: Successful password login
    Given user "alice@smb.com" has password set
    When alice POSTs "/identity/login" with email + password
    Then the password is verified against the stored hash
    And an AuthSession is created with status "active"
    And a session cookie is set with HttpOnly + Secure + SameSite=Strict
    And an "Identity.LoginSucceeded" event records method="password"

  Scenario: Wrong password — rate limited
    Given alice's account exists
    When 5 consecutive wrong-password POSTs land within 1 minute from the same IP
    Then the 6th attempt returns 429
    And the rate-limit window is 15 minutes
    And an "Identity.LoginRejected" event records reason "rate_limited"

  Scenario: Account lockout after sustained failures
    Given alice's account exists
    When 20 wrong-password attempts land within 1 hour
    Then alice's User entity attrs.lockedUntil is set 30 minutes in the future
    And further attempts return 423 Locked
    And alice receives an account-lockout email
    And an "Identity.AccountLocked" event is emitted

  Scenario: Forgot-password flow
    When alice POSTs "/identity/password/reset-request" with her email
    Then a ResetToken entity is created with 1-hour expiry
    And alice receives a reset email with a single-use link
    And an "Identity.PasswordResetRequested" event is emitted

  Scenario: Reset password using a valid token
    Given a ResetToken exists for "alice@smb.com" not yet expired
    When alice POSTs "/identity/password/reset" with token + new password
    Then alice's passwordHash is updated
    And the ResetToken status flips to "consumed"
    And every existing AuthSession for alice is revoked
    And an "Identity.PasswordChanged" event is emitted

  Scenario: Reject reset with expired token
    Given a ResetToken for "alice@smb.com" expired 5 minutes ago
    When alice POSTs the reset
    Then the response status is 410
    And reason is "reset_token_expired"

  Scenario: Password complexity rejected at set-time
    When a user submits a password "abc" via either set or reset
    Then the response status is 400
    And the error message lists the failing rules
    And no entity is mutated
