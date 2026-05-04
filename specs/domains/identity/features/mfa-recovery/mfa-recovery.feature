# Hierarchy: identity / mfa-recovery
#
# Single-use recovery codes generated at MFA enrollment. Used when the
# primary MFA factor (TOTP, WebAuthn) is unavailable — phone lost,
# hardware key broken, etc. Each code is hashed at rest; using a code
# burns it.

@auth @identity @mfa @mfa-recovery
Feature: MFA recovery codes

  Background:
    Given a tenant "secure" with mfaRequired=true
    And user "alice@secure.com" has an active Membership

  Scenario: Recovery codes generated at MFA enrollment
    Given alice has just enrolled a TOTP factor
    When the enrollment-finish handler runs
    Then 10 single-use RecoveryCode entities are created
    And each code is shown to alice EXACTLY ONCE in the response
    And persisted entities store only Argon2id hashes
    And alice is prompted to save them somewhere safe
    And an "Identity.RecoveryCodesGenerated" event is emitted

  Scenario: Use a recovery code at MFA challenge
    Given alice has 10 unused recovery codes
    And alice's primary factor just completed; AuthSession status="mfa_pending"
    When alice submits a recovery code instead of the primary MFA factor
    Then the code is verified against the stored hashes
    And the matched RecoveryCode status flips to "consumed"
    And the AuthSession status flips to "active"
    And an "Identity.MfaChallengeSucceeded" event records method="recovery_code"
    And alice receives an email warning that a recovery code was used
    And the response surfaces a prominent "you have N codes left" warning

  Scenario: Reject reused recovery code
    Given alice used recovery code "ABCD-EFGH" 5 minutes ago
    When she tries the same code again
    Then the response status is 401
    And reason is "recovery_code_used"
    And an "Identity.MfaAnomaly" event is emitted (security signal)

  Scenario: Out of recovery codes — locked out
    Given alice has 0 unused recovery codes
    And alice has lost her TOTP device and her WebAuthn key
    When alice tries to log in
    Then she sees a "contact your tenant admin" support page
    And no AuthSession is created
    And an "Identity.MfaLockout" event is emitted

  Scenario: Regenerate recovery codes (invalidates the old set)
    Given alice has 4 unused codes from a previous batch
    When alice POSTs "/identity/mfa/recovery/regenerate" with current MFA confirmation
    Then the 4 old RecoveryCodes status flips to "invalidated"
    And 10 fresh codes are issued (shown EXACTLY ONCE)
    And an "Identity.RecoveryCodesRegenerated" event is emitted

  Scenario: Tenant admin generates a one-shot bypass for a locked user
    Given alice is fully locked out (no MFA, no recovery codes)
    And the admin is authenticated as a principal with role "TenantAdmin"
    When the admin submits an "Identity.MfaBypass.Issue" intent for alice
    Then a 5-minute one-shot bypass token is created
    And the admin can deliver it to alice out-of-band
    And usage emits "Identity.MfaBypassUsed" with the issuing admin's principalId
    And the bypass auto-expires whether used or not

  Scenario: Reject recovery-code attempt without a primary-factor handshake
    Given no AuthSession in status "mfa_pending" exists for alice
    When someone tries to redeem a recovery code directly
    Then the response status is 400
    And reason is "no_pending_mfa_challenge"
