# Hierarchy: identity / federated-oidc
#
# Per-tenant OIDC federation — tenants bring their own IDP (Okta,
# Auth0, Google Workspace, Azure AD, etc.). Each tenant has an
# `IdentityProvider` entity recording the issuer URL, JWKS endpoint,
# audience, and claim mappings. Ingress validates JWTs against the
# tenant's JWKS, not a global one.

@auth @identity @federated
Feature: Federated OIDC — bring your own IDP

  Background:
    Given a tenant "globex" with the identity module enabled
    And the admin is authenticated as a principal with role "TenantAdmin"

  Scenario: Admin configures the tenant's OIDC IDP
    When the admin submits an "Identity.IdentityProvider.Create" intent with:
      | issuerUrl       | https://login.globex.com/                |
      | discoveryUrl    | https://login.globex.com/.well-known/oidc |
      | audience        | atlas-globex                              |
      | subjectClaim    | sub                                       |
      | emailClaim      | email                                     |
      | groupsClaim     | groups                                    |
    Then an "IdentityProvider" entity is created with kind="oidc"
    And the IDP status is "pending_validation"
    And an "Identity.IdentityProviderConfigured" event is emitted
    And the discovery document is fetched once and the JWKS URL is cached

  Scenario: Admin promotes the IDP to active after validation
    Given an IdentityProvider exists for "globex" in status "pending_validation"
    And the admin has completed a successful test login against the IDP
    When the admin submits an "Identity.IdentityProvider.Activate" intent
    Then the IDP status is "active"
    And subsequent JWTs for "globex" must validate against this IDP's JWKS

  Scenario: Federated user logs in via JIT (just-in-time) provisioning
    Given tenant "globex" has an active federated IdentityProvider
    And no User exists yet for "alice@globex.com"
    When alice presents a valid OIDC JWT signed by Globex's IDP
    Then a "User" entity is JIT-created with primaryIdpSubject from sub
    And a "Membership" entity is created with role inferred from the IDP's groups claim
    And an "Identity.UserCreated" event is emitted with idpRef="globex-okta"
    And an "Identity.LoginSucceeded" event is emitted

  Scenario: JIT provisioning honors the tenant's role-mapping rules
    Given tenant "globex" maps IDP group "Engineering" to Atlas role "Author"
    And tenant "globex" maps IDP group "Admins" to Atlas role "TenantAdmin"
    When alice presents a JWT with groups=["Engineering","Sales"]
    Then her Membership is created with roles=["Author"]
    And the unmapped group "Sales" is recorded on the Membership audit log

  Scenario: JWT signed by the wrong IDP is rejected
    Given tenant "globex" expects JWTs from issuer "https://login.globex.com/"
    And a JWT has issuer "https://attacker.com/"
    When the request presents that JWT
    Then the response status is 401
    And the error code is "PRINCIPAL_INVALID"
    And an "Identity.LoginRejected" event is emitted with reason "issuer_mismatch"

  Scenario: IDP rotation — admin replaces the JWKS URL
    Given tenant "globex" has IdentityProvider id "idp-1" active
    When the admin submits an "Identity.IdentityProvider.RotateJwks" intent with new jwksUrl
    Then the cached JWKS is invalidated
    And subsequent JWTs validate against the new URL
    And an "Identity.IdentityProviderRotated" event is emitted

  Scenario: IDP revocation
    Given tenant "globex" has an active IdentityProvider
    When the admin submits an "Identity.IdentityProvider.Disable" intent
    Then the IDP status is "disabled"
    And new logins via this IDP are rejected with reason "idp_disabled"
    And existing AuthSessions remain valid until their natural expiry
