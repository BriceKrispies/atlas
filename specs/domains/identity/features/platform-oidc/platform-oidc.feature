# Hierarchy: identity / platform-oidc
#
# Atlas's built-in OIDC IDP. Used by tenants who don't bring their own
# SSO. Each tenant gets a dedicated realm (or claim-mapped group within
# a shared realm); JWTs validate against the platform JWKS.
#
# References:
#   apps/server/src/middleware/principal.ts (JWT verification, today)
#   modules/identity/src/  (Phase A1 entities — User, Membership, InviteToken)
#   specs/architecture.md I2, I5, I7

@auth @identity
Feature: Login via Atlas's built-in OIDC IDP

  Background:
    Given a tenant "acme" with the identity module enabled
    And the platform OIDC realm "acme" is provisioned

  Scenario: First-admin bootstrap mints an InviteToken
    Given tenant "acme" has no users
    When the operator runs "atlasctl tenant add-admin acme admin@example.com"
    Then an "InviteToken" entity exists for "admin@example.com" with role "TenantAdmin"
    And the InviteToken status is "pending"
    And the magic-link URL is returned to the operator
    And no Membership exists yet

  Scenario: Invitee completes first login
    Given an InviteToken exists for "admin@example.com" in tenant "acme"
    When the invitee opens the magic-link URL
    And authenticates against the platform IDP for the first time
    Then a "User" entity is created with primaryIdpSubject from the JWT "sub" claim
    And a "Membership" entity is created linking the user to "acme" with role "TenantAdmin"
    And the InviteToken status flips to "consumed"
    And an "Identity.UserCreated" event is emitted with the request correlationId
    And an "Identity.MembershipCreated" event is emitted

  Scenario: Returning user authenticates
    Given user "alice@acme.com" has an active Membership in "acme" with role "Author"
    When alice presents a valid OIDC JWT signed by the platform IDP
    Then the principal middleware resolves her User by primaryIdpSubject
    And the principal carries roles ["Author"]
    And an "Identity.LoginSucceeded" event is emitted with cache tags ["Tenant:acme", "User:alice"]
    And an "AuthSession" entity is created with status "active"

  Scenario: User without Membership is rejected (Invariant I7)
    Given a valid OIDC JWT for "stranger@elsewhere.com" exists
    And no Membership for "stranger@elsewhere.com" in tenant "acme"
    When the request hits "/api/v1/intents" with that JWT
    Then the response status is 403
    And the error code is "PRINCIPAL_INVALID"
    And an "Identity.LoginRejected" event is emitted with reason "no_membership"
    And no User entity is created (membership-required JIT)

  Scenario: Tenant claim mismatch with Host (custom-domains gate)
    Given tenant "acme" has primary custom domain "community.acme.example"
    And an OIDC JWT has tenant_id claim "globex"
    When the request arrives with Host "community.acme.example" and that JWT
    Then the response status is 403
    And the error message mentions Host
    And an "Identity.LoginRejected" event is emitted with reason "tenant_host_mismatch"

  Scenario: Expired JWT rejected
    Given a JWT for "alice@acme.com" expired 60 seconds ago
    When the request presents the expired JWT
    Then the response status is 401
    And no User or Membership lookup is attempted
    And an "Identity.LoginRejected" event is emitted with reason "token_expired"

  Scenario: Suspended Membership blocks login
    Given user "fired@acme.com" has a Membership in "acme" with status "suspended"
    When fired presents a valid OIDC JWT
    Then the response status is 403
    And the error code is "PRINCIPAL_INVALID"
    And an "Identity.LoginRejected" event is emitted with reason "membership_suspended"
