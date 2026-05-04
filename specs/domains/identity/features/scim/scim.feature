# Hierarchy: identity / scim
#
# SCIM 2.0 — System for Cross-domain Identity Management (RFC 7642/3/4).
# IDP pushes user/group lifecycle events to Atlas's `/scim/v2` endpoint.
# Atlas creates/updates/deprovisions Users + Memberships in response.

@auth @identity @scim
Feature: SCIM 2.0 user and group provisioning

  Background:
    Given a tenant "enterprise" with the identity module enabled
    And the admin is authenticated as a principal with role "TenantAdmin"

  Scenario: Admin enables SCIM and gets a base URL + bearer token
    When the admin submits an "Identity.Scim.Enable" intent
    Then a unique SCIM bearer token is generated (returned EXACTLY ONCE)
    And the SCIM base URL is "https://{tenant-domain}/scim/v2"
    And an "Identity.ScimEnabled" event is emitted
    And the admin can paste the URL + token into the IDP's SCIM connector

  Scenario: SCIM POST /Users creates a User + Membership
    Given the IDP authenticates with the SCIM bearer token
    When the IDP POSTs "/scim/v2/Users" with:
      | userName    | bob@enterprise.com           |
      | active      | true                         |
      | emails[0]   | bob@enterprise.com (primary) |
      | name.given  | Bob                          |
      | name.family | Smith                        |
    Then a User entity is created (status="active")
    And a Membership entity is created (role inferred from default)
    And the response includes the SCIM resource id (the User's entityId)
    And an "Identity.UserCreated" event is emitted with origin="scim"

  Scenario: SCIM PATCH /Users/{id} updates active status
    Given user "bob@enterprise.com" exists with status="active"
    When the IDP PATCHes /Users/{id} with [{ "op": "replace", "path": "active", "value": false }]
    Then the User entity status flips to "suspended"
    And every active AuthSession for bob is revoked
    And an "Identity.UserSuspended" event is emitted with origin="scim"

  Scenario: SCIM DELETE /Users/{id} deprovisions
    Given user "bob@enterprise.com" exists
    When the IDP DELETEs /Users/{id}
    Then the User entity status flips to "deprovisioned"
    And every Membership for bob is set to status="ended"
    And every active AuthSession is revoked
    And an "Identity.UserDeprovisioned" event is emitted

  Scenario: SCIM POST /Groups + group-to-role mapping
    Given a Group mapping rule exists: SCIM group "Engineering" -> Atlas role "Author"
    When the IDP POSTs "/scim/v2/Groups" with:
      | displayName | Engineering                   |
      | members     | [{ "value": "<bob-id>" }]     |
    Then bob's Membership.roles is updated to include "Author"
    And an "Identity.MembershipRolesChanged" event is emitted

  Scenario: SCIM PATCH /Groups removes a member
    Given bob is in SCIM group "Engineering" mapped to "Author"
    When the IDP PATCHes the group to remove bob
    Then bob's Membership.roles loses "Author"
    And if bob has no remaining roles, his Membership status flips to "suspended"

  Scenario: Reject SCIM request with wrong bearer token
    When a request hits "/scim/v2/Users" with a stale or wrong token
    Then the response status is 401
    And the response follows the SCIM error schema (urn:ietf:params:scim:api:messages:2.0:Error)
    And an "Identity.ScimDenied" event is emitted

  Scenario: SCIM /ServiceProviderConfig discovery endpoint
    When the IDP GETs "/scim/v2/ServiceProviderConfig"
    Then the response advertises the supported features (patch=true, filter=true, etc.)
    And documentationUri points at Atlas's SCIM docs
