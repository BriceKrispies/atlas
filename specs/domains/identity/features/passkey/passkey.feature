# Hierarchy: identity / passkey
#
# WebAuthn / FIDO2 passkeys as a primary authentication factor.
# Hardware-bound credentials, phishing-resistant. Supports multiple
# passkeys per user (a phone + a security key, etc.).

@auth @identity @passkey @webauthn
Feature: Passkey (WebAuthn) authentication

  Background:
    Given a tenant "future" with the identity module enabled
    And user "alice@future.com" has an active Membership

  Scenario: Tenant enables passkey as a primary auth method
    Given the admin is authenticated as a principal with role "TenantAdmin"
    When the admin submits an "Identity.AuthMethod.Enable" intent with method="passkey"
    Then the tenant's identity config includes passkey in enabledMethods

  Scenario: User registers a passkey
    Given alice is logged in via another factor
    When she POSTs "/identity/passkey/register/begin"
    Then the server returns a PublicKeyCredentialCreationOptions challenge
    And the challenge is persisted server-side keyed by alice's userId
    When alice's authenticator returns an attestation response
    And she POSTs "/identity/passkey/register/finish" with the attestation
    Then the attestation is verified
    And an "AuthFactor" entity is created with kind="passkey", credentialId, publicKey
    And an "Identity.AuthFactorEnrolled" event records factor="passkey"

  Scenario: Login via passkey
    Given alice has at least one registered passkey
    When alice POSTs "/identity/passkey/login/begin"
    Then the server returns a PublicKeyCredentialRequestOptions challenge
    When alice's authenticator returns an assertion
    And she POSTs "/identity/passkey/login/finish"
    Then the assertion's signature is verified against the stored public key
    And the credential's signCount is greater than the persisted last value (replay defense)
    And an AuthSession is created with status "active"
    And an "Identity.LoginSucceeded" event records method="passkey"

  Scenario: Multiple passkeys — user picks one at login
    Given alice has 3 registered passkeys (laptop TPM, YubiKey, phone)
    When alice begins a passkey login
    Then the challenge response includes all 3 credentialIds in allowCredentials
    And the browser prompts alice to choose
    And whichever she chooses is verified independently

  Scenario: Reject assertion with stale signCount (cloned credential)
    Given alice's passkey signCount is 42 in the AuthFactor entity
    When an assertion arrives with signCount 30
    Then the response status is 401
    And reason is "passkey_signcount_regression"
    And an "Identity.PasskeyAnomaly" event is emitted (potential clone)

  Scenario: Lost-device fallback via recovery code
    Given alice has registered passkeys but lost all devices
    When she falls back to MFA recovery codes (see mfa-recovery.feature)
    And after a successful recovery-code login she registers a new passkey
    Then the old passkey AuthFactor entities can be revoked

  Scenario: Revoke a passkey
    Given alice has 3 registered passkeys
    When she submits an "Identity.AuthFactor.Revoke" intent for credentialId X
    Then the AuthFactor entity status flips to "revoked"
    And subsequent assertions with that credentialId are rejected
    And an "Identity.AuthFactorRevoked" event is emitted
