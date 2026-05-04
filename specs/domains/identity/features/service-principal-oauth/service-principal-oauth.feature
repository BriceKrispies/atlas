# Hierarchy: identity / service-principal-oauth
#
# OAuth 2.0 client_credentials grant for service-to-service auth.
# Different from API keys: short-lived access tokens (JWT), refreshed
# by re-presenting client_id+client_secret to the token endpoint.
# Useful when a service needs to integrate with Atlas using standard
# OAuth tooling.

@auth @identity @oauth
Feature: OAuth 2.0 client_credentials grant

  Background:
    Given a tenant "platform" with the identity module enabled
    And the admin is authenticated as a principal with role "TenantAdmin"

  Scenario: Admin creates a ServicePrincipal with OAuth credentials
    When the admin submits an "Identity.ServicePrincipal.Create" intent with:
      | name        | inventory-sync                         |
      | description | Pulls catalog data into Inventory App  |
      | scopes      | ["catalog.read", "catalog.search"]     |
    Then a "ServicePrincipal" entity is created
    And a client_id is returned (e.g. "sp_abc123")
    And a client_secret is returned EXACTLY ONCE (Argon2id-hashed at rest)
    And an "Identity.ServicePrincipalCreated" event is emitted

  Scenario: Client_credentials grant returns a JWT
    Given a ServicePrincipal "inventory-sync" exists with valid credentials
    When a service POSTs "/oauth/token" with:
      | grant_type    | client_credentials |
      | client_id     | sp_abc123          |
      | client_secret | <secret>           |
      | scope         | catalog.read       |
    Then the response status is 200
    And the response body contains an access_token (JWT, 1 hour TTL)
    And the JWT's "sub" claim is "sp_abc123"
    And the JWT's "scope" claim is "catalog.read"
    And the JWT's "tenant_id" claim is "platform"
    And an "Identity.OAuthTokenIssued" event is emitted

  Scenario: Use the access token on a downstream request
    Given a fresh access_token for "inventory-sync"
    When the service hits "/api/v1/catalog/families/foo" with Authorization Bearer
    Then the principal middleware verifies the JWT against the platform JWKS
    And the principal carries the token's scopes
    And the request succeeds (assuming Cedar allows)

  Scenario: Reject token request with invalid client_secret
    When a service POSTs to /oauth/token with a wrong secret
    Then the response status is 401
    And the error is "invalid_client" (RFC 6749 standard)
    And an "Identity.OAuthTokenDenied" event is emitted with reason "bad_secret"

  Scenario: Reject scope escalation
    Given a ServicePrincipal scoped to ["catalog.read"]
    When the service requests scope="catalog.write"
    Then the response status is 400
    And the error is "invalid_scope"

  Scenario: Token revocation via /oauth/revoke
    Given a fresh access_token "tok_xyz" for "inventory-sync"
    When the admin POSTs "/oauth/revoke" with token="tok_xyz"
    Then the token's jti is added to the revocation list
    And subsequent requests using "tok_xyz" return 401
    And an "Identity.OAuthTokenRevoked" event is emitted

  Scenario: Reject expired access_token
    Given an access_token whose exp claim is 5 seconds in the past
    When the token is used
    Then the response status is 401
    And the WWW-Authenticate header includes "error=invalid_token, error_description=expired"
