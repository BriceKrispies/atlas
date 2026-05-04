# Hierarchy: authorization / break-glass
#
# Time-bound emergency access grants. A privileged operator (or
# tenant admin in a compromise scenario) can grant elevated permissions
# to themselves or another principal for a short window, with mandatory
# justification and immutable audit. Auto-expires.

@auth @authorization @break-glass
Feature: Break-glass emergency access

  Background:
    Given a tenant "ledger" with the identity module enabled

  Scenario: Operator issues a break-glass grant during an incident
    Given an operator principal "ops:bob" with role "PlatformSupport"
    And the operator is authenticated
    When the operator submits an "Authorization.BreakGlass.Issue" intent with:
      | tenantId        | ledger                                              |
      | grantedTo       | ops:bob                                             |
      | grantedRoles    | ["TenantAdmin"]                                     |
      | justification   | P0 incident — pricing data corruption, INC-9001     |
      | incidentUrl     | https://status.atlas.example/incidents/INC-9001     |
      | maxDurationMin  | 60                                                  |
    Then a "BreakGlassGrant" entity is created
    And the grant requires a second-approver from a separate operator (4-eyes)
    And the grant status is "pending_approval"
    And an "Authorization.BreakGlassIssued" event is emitted
    And the tenant's primary admin AND security@atlas pager receive notifications

  Scenario: Second approver completes the 4-eyes check
    Given a BreakGlassGrant in status "pending_approval"
    And the second approver "ops:carol" with role "PlatformSupport" is online
    When ops:carol submits an "Authorization.BreakGlass.Approve" intent
    Then the grant status flips to "active"
    And ops:bob's principal carries the granted roles for the duration
    And an "Authorization.BreakGlassApproved" event is emitted

  Scenario: Reject self-approval (the same operator cannot be both issuer and approver)
    Given ops:bob issued a grant in "pending_approval"
    When ops:bob tries to approve his own grant
    Then the response status is 403
    And the error code is "BREAK_GLASS_SELF_APPROVAL_FORBIDDEN"

  Scenario: Use the grant during the active window
    Given ops:bob has an active BreakGlassGrant with role "TenantAdmin"
    When ops:bob submits any intent against tenant "ledger"
    Then the principal middleware loads the granted roles (in addition to base)
    And the event envelope carries `breakGlassGrantId: <grantId>`
    And every action emits an "Authorization.BreakGlassAction" audit event
    And the customer audit feed surfaces it prominently

  Scenario: Auto-expiry
    Given a BreakGlassGrant in "active" with maxDurationMin=60
    And 61 minutes have passed
    When ops:bob attempts another action
    Then the granted roles are no longer in the principal
    And the grant status auto-flips to "expired"
    And an "Authorization.BreakGlassExpired" event is emitted

  Scenario: Tenant admin revokes a break-glass grant in flight
    Given an active BreakGlassGrant
    And the admin is authenticated as a principal with role "TenantAdmin"
    When the admin submits an "Authorization.BreakGlass.Revoke" intent
    Then the grant status flips to "revoked"
    And ops:bob's next request without that grant fails authz
    And an "Authorization.BreakGlassRevoked" event is emitted

  Scenario: Reject break-glass without sufficient operator role
    Given a principal "user:eve@third-party" without the "PlatformSupport" role
    When eve attempts to issue a break-glass grant
    Then the response status is 403
    And the error code is "BREAK_GLASS_REQUIRES_OPERATOR"

  Scenario: Reject grant scope above the issuer's authority
    Given ops:bob is "PlatformSupport"
    And tenant policy says PlatformSupport can grant up to "TenantAdmin"
    When ops:bob tries to grant "PlatformOwner"
    Then the response status is 403
    And reason is "grant_exceeds_issuer_authority"

  Scenario: Audit retention for break-glass is the strictest tenant SLA
    When any break-glass event lands
    Then its retention tag is "break-glass:10y"
    And the audit pipeline routes it to immutable long-term storage
    And no per-tenant retention policy can shorten it (platform-wide override)
