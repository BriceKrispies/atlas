# Hierarchy: identity / saml
#
# SAML 2.0 federation — built in-house per the user's full-build
# decision. Both SP-initiated (user starts at Atlas, redirects to IdP)
# and IdP-initiated (user starts at IdP's app catalog) flows.
#
# References:
#   modules/identity/src/saml/ (Phase A6 — XML signature validation,
#   assertion parsing, NameID handling, RelayState)

@auth @identity @saml
Feature: SAML 2.0 federation

  Background:
    Given a tenant "wayne" with the identity module enabled
    And the admin is authenticated as a principal with role "TenantAdmin"

  Scenario: Admin uploads IdP metadata XML
    When the admin submits an "Identity.IdentityProvider.Create" intent with:
      | kind          | saml                                          |
      | metadataXml   | <md:EntityDescriptor entityID="https://...">  |
      | nameIdFormat  | urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress |
    Then an "IdentityProvider" entity is created with kind="saml"
    And the IdP's signing certificate is parsed and stored
    And Atlas exposes its SP metadata at "/sso/saml/wayne/metadata.xml"
    And an "Identity.IdentityProviderConfigured" event is emitted

  Scenario: Admin configures attribute mapping
    Given a SAML IdentityProvider exists for "wayne"
    When the admin submits an "Identity.IdentityProvider.MapAttributes" intent with:
      | emailAttribute  | http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress |
      | groupsAttribute | http://schemas.xmlsoap.org/claims/Group                            |
      | roleMappings    | { "Atlas-Admin": "TenantAdmin", "Atlas-Author": "Author" }         |
    Then the mappings are persisted on the IdentityProvider entity

  Scenario: SP-initiated login redirects, returns, creates session
    Given tenant "wayne" has an active SAML IdentityProvider
    When alice navigates to "/sso/saml/wayne/login"
    Then Atlas builds an AuthnRequest, signs it, and redirects to the IdP's SSO URL
    And the AuthnRequest carries a fresh RelayState token persisted server-side

  Scenario: IdP returns a signed SAML Response — happy path
    Given a pending RelayState exists for an in-flight login
    When the IdP POSTs a signed Response to "/sso/saml/wayne/acs"
    Then the XML signature is verified against the IdP's stored cert
    And the assertion's NotOnOrAfter is in the future
    And the Audience matches Atlas's SP entityID
    And a User is JIT-created (or matched by NameID)
    And a Membership is created with roles from the Group attribute mapping
    And an AuthSession is issued
    And the user is redirected to the post-login URL recorded in RelayState

  Scenario: IdP-initiated login (unsolicited Response)
    Given tenant "wayne" allows IdP-initiated logins (admin opt-in)
    When the IdP POSTs an unsolicited signed Response to "/sso/saml/wayne/acs"
    Then Atlas validates the signature + audience + timestamps
    And the user lands on the tenant's default surface
    And an "Identity.LoginSucceeded" event records flow="idp_initiated"

  Scenario: Reject Response with invalid signature
    Given an attacker forges a SAML Response with a tampered signature
    When the forged Response is POSTed to "/sso/saml/wayne/acs"
    Then the response status is 401
    And the error code is "PRINCIPAL_INVALID"
    And an "Identity.LoginRejected" event records reason "signature_invalid"
    And the forged certificate fingerprint is captured in the audit event

  Scenario: Reject expired assertion (clock skew protection)
    Given a SAML Response whose assertion expired 10 minutes ago
    When the Response is POSTed
    Then the response status is 401
    And reason is "assertion_expired"

  Scenario: Reject replay (same assertion ID twice)
    Given a SAML Response was successfully consumed 5 minutes ago
    When the same Response is replayed
    Then the response status is 401
    And reason is "replay_detected"
    And the assertion ID is recorded in the replay-protection store
