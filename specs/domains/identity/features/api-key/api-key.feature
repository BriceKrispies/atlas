# Hierarchy: identity / api-key
#
# Bearer API keys for programmatic access. Tenant-scoped, optionally
# principal-scoped (acts as a specific service account), with declared
# scopes that constrain which actions the key can invoke. Rotatable
# and revocable.

@auth @identity @api-key
Feature: API key issuance + use

  Background:
    Given a tenant "ops" with the identity module enabled
    And the admin is authenticated as a principal with role "TenantAdmin"

  Scenario: Admin creates an API key tied to a service principal
    Given a ServicePrincipal entity "deploybot" exists in tenant "ops"
    When the admin submits an "Identity.ApiKey.Create" intent with:
      | servicePrincipalId | sp-deploybot                     |
      | scopes             | ["catalog.read", "events.append"] |
      | expiresAt          | 2027-01-01T00:00:00Z              |
    Then an "ApiKey" entity is created
    And the response payload contains the raw secret EXACTLY ONCE
    And the persisted entity stores only the secret's hash (Argon2id)
    And an "Identity.ApiKeyCreated" event is emitted with the key id

  Scenario: Use API key on a request
    Given an active ApiKey for ServicePrincipal "deploybot" in "ops"
    When a request hits "/api/v1/intents" with header "Authorization: Bearer atlas_<keyId>_<secret>"
    Then the secret is verified against the stored hash
    And the request principal is the ServicePrincipal "deploybot"
    And the principal carries the key's declared scopes
    And the ApiKey's lastUsedAt is updated
    And an "Identity.ApiKeyUsed" event is emitted (sampled, see config)

  Scenario: Scope enforcement
    Given an ApiKey scoped to ["catalog.read"]
    When the key is used to submit a "Catalog.Family.Publish" intent (write)
    Then the response status is 403
    And the error code is "INSUFFICIENT_SCOPE"
    And an "Identity.ApiKeyDenied" event is emitted with required vs granted scopes

  Scenario: Reject expired ApiKey
    Given an ApiKey whose expiresAt is in the past
    When the key is used
    Then the response status is 401
    And reason is "key_expired"

  Scenario: Rotate an ApiKey (zero-downtime)
    Given an active ApiKey for "deploybot"
    When the admin submits an "Identity.ApiKey.Rotate" intent with overlapWindowSeconds=86400
    Then a new secret is generated and returned EXACTLY ONCE
    And both the old hash and the new hash are accepted for the overlap window
    And an "Identity.ApiKeyRotated" event is emitted
    When the overlap window elapses
    Then the old hash is removed from the entity attrs

  Scenario: Revoke an ApiKey immediately
    Given an active ApiKey
    When the admin submits an "Identity.ApiKey.Revoke" intent
    Then the ApiKey status flips to "revoked"
    And the next request using the key returns 401
    And reason is "key_revoked"
    And an "Identity.ApiKeyRevoked" event is emitted

  Scenario: Bulk audit — list all ApiKeys for a tenant
    Given tenant "ops" has 12 active ApiKeys, 3 revoked, 1 expired
    When the admin GETs "/api/v1/identity/api-keys?status=*"
    Then the response lists all 16 keys
    And each entry includes id, scopes, status, lastUsedAt — never the secret

  Scenario: Wrong-tenant key is rejected (Invariant I7)
    Given an ApiKey belongs to tenant "globex"
    When a request to tenant "ops" uses the key
    Then the response status is 401
    And reason is "key_tenant_mismatch"
    And an "Identity.ApiKeyAnomaly" event is emitted
