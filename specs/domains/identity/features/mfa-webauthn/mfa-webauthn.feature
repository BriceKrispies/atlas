# Hierarchy: identity / mfa-webauthn
#
# WebAuthn / FIDO2 as a SECOND factor (companion to mfa-totp). Stronger
# than TOTP because credentials are hardware-bound and phishing-resistant.
# Distinct from primary-factor passkey (see passkey.feature) — same
# protocol, different role in the auth flow.

@auth @identity @mfa @mfa-webauthn @webauthn
Feature: WebAuthn second-factor authentication

  Background:
    Given a tenant "fortress" with mfaRequired=true
    And user "alice@fortress.com" has an active Membership
    And alice is logged in (primary factor complete)

  Scenario: User enrolls a WebAuthn second factor (security key)
    When alice POSTs "/identity/mfa/webauthn/enroll/begin"
    Then the response returns a PublicKeyCredentialCreationOptions with userVerification="required" and authenticatorAttachment="cross-platform"
    And a server-side challenge is persisted (5 min TTL)
    When alice's authenticator returns an attestation
    And alice POSTs "/identity/mfa/webauthn/enroll/finish"
    Then attestation is verified
    And an "AuthFactor" entity is created with kind="webauthn_mfa", credentialId, publicKey
    And an "Identity.AuthFactorEnrolled" event is emitted with factor="webauthn_mfa"

  Scenario: WebAuthn challenge on login
    Given alice has a WebAuthn second-factor AuthFactor enrolled
    And alice's primary factor just succeeded; AuthSession status="mfa_pending"
    When the server returns PublicKeyCredentialRequestOptions
    Then the allowCredentials list includes alice's enrolled credentialId
    When alice's authenticator returns an assertion
    And alice POSTs "/identity/mfa/webauthn/finish"
    Then the assertion's signature is verified
    And the credential's signCount is greater than the persisted last value
    And the AuthSession status flips to "active"
    And an "Identity.MfaChallengeSucceeded" event is emitted with method="webauthn"

  Scenario: Multiple WebAuthn factors (laptop biometric + YubiKey)
    Given alice has 2 WebAuthn second-factor credentials enrolled
    When alice's MFA challenge begins
    Then the allowCredentials list includes both credentialIds
    And whichever the browser/user picks is verified independently

  Scenario: Reject signCount regression (cloned authenticator detection)
    Given alice's stored signCount is 42
    When an assertion arrives with signCount 30
    Then the response status is 401
    And reason is "signcount_regression"
    And an "Identity.MfaAnomaly" event is emitted (potential clone signal)

  Scenario: Reject assertion if userVerification flag is missing
    Given the tenant policy requires userVerification on WebAuthn MFA
    When an assertion arrives with the UV flag clear
    Then the response status is 401
    And reason is "user_verification_required"

  Scenario: Revoke a WebAuthn second factor
    Given alice has 2 WebAuthn factors enrolled
    When alice submits an "Identity.AuthFactor.Revoke" intent for credentialId X
    Then the corresponding AuthFactor status flips to "revoked"
    And subsequent assertions with that credentialId are rejected
    And alice still has 1 active WebAuthn factor (must keep at least one in MFA-required mode)

  Scenario: Cannot revoke last MFA factor while MFA required
    Given alice has only 1 WebAuthn factor + no TOTP, and tenant mfaRequired=true
    When alice tries to revoke that factor
    Then the response status is 409
    And the error code is "MFA_FACTOR_REQUIRED"
    And alice must enroll a replacement first (or admin must remove the requirement)
