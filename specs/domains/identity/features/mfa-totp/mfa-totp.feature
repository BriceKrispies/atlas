# Hierarchy: identity / mfa-totp
#
# Time-based one-time passwords (RFC 6238) — phone authenticator apps
# (Google Authenticator, 1Password, Authy). 30-second window with a
# ±1-step skew. Replay-protected via a per-user "lastUsedTotp" record.

@auth @identity @mfa @mfa-totp
Feature: TOTP multi-factor authentication

  Background:
    Given a tenant "secure" with the identity module enabled
    And user "alice@secure.com" has an active Membership
    And alice is logged in (primary factor complete)

  Scenario: Admin enforces MFA for the tenant
    Given the admin is authenticated as a principal with role "TenantAdmin"
    When the admin submits an "Identity.MfaPolicy.Update" intent with required=true
    Then the tenant config has mfaRequired=true
    And users without an enrolled AuthFactor cannot complete login until they enroll

  Scenario: User enrolls TOTP
    When alice POSTs "/identity/mfa/totp/enroll/begin"
    Then the response includes a fresh shared secret + QR-encoded otpauth URI
    And the secret is persisted in a temporary "PendingEnrollment" record (5 min TTL)
    When alice POSTs "/identity/mfa/totp/enroll/finish" with a valid 6-digit code
    Then an AuthFactor entity is created with kind="totp", encryptedSecret
    And the PendingEnrollment is deleted
    And an "Identity.AuthFactorEnrolled" event is emitted with factor="totp"
    And recovery codes are generated (see mfa-recovery.feature)

  Scenario: Reject TOTP enroll with a wrong verification code
    Given a PendingEnrollment exists for alice
    When alice submits a 6-digit code that doesn't match
    Then the response status is 400
    And no AuthFactor is created
    And the PendingEnrollment is preserved (alice can retry within the TTL)

  Scenario: MFA challenge on subsequent login
    Given alice has a TOTP AuthFactor enrolled
    And alice has just authenticated her primary factor
    When the server creates an AuthSession in status "mfa_pending"
    Then the response prompts alice for a TOTP code
    When alice submits a valid 6-digit code
    Then the AuthFactor's TOTP is verified within the 30-second window (±1 step)
    And the AuthSession status flips to "active"
    And an "Identity.MfaChallengeSucceeded" event is emitted

  Scenario: Replay protection — same code rejected twice
    Given alice just used TOTP code "123456" successfully
    When alice tries the same code again within the same window
    Then the response status is 401
    And reason is "totp_replay"
    And an "Identity.MfaAnomaly" event is emitted

  Scenario: Lock account after repeated wrong codes
    Given alice has a TOTP AuthFactor enrolled
    When 6 wrong TOTP codes are submitted in 2 minutes
    Then the AuthFactor status flips to "temporarily_locked" with unlockAt 30 min in future
    And alice can fall back to recovery codes
    And an "Identity.AuthFactorLocked" event is emitted

  Scenario: Disable TOTP (admin-mandated reset)
    Given alice has a TOTP AuthFactor
    When the admin submits an "Identity.AuthFactor.Revoke" intent for that factor
    Then the AuthFactor status flips to "revoked"
    And alice's next login forces re-enrollment if MFA is still required
