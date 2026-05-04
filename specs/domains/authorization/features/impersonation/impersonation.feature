# Hierarchy: authorization / impersonation
#
# Operator-as-tenant access for support workflows. An ops engineer (a
# "platform principal") assumes a user's identity within a tenant
# temporarily, with mandatory audit emit on every action. The
# ImpersonationSession entity tracks the assumption window; every
# request during the window carries an `impersonatedBy` field on the
# audit envelope.

@auth @authorization @impersonation
Feature: Operator impersonation with mandatory audit

  Background:
    Given a tenant "customer" with a user "alice@customer.com"
    And an operator principal "ops:bob" with role "PlatformSupport"

  Scenario: Operator starts an impersonation session
    Given the operator is authenticated against the platform
    When the operator submits an "Authorization.Impersonation.Start" intent with:
      | tenantId        | customer                                        |
      | targetUserId    | alice@customer.com                              |
      | reason          | Investigating ticket SUP-1234                   |
      | ticketUrl       | https://support.atlas.example/tickets/SUP-1234  |
      | maxDurationMin  | 30                                              |
    Then an "ImpersonationSession" entity is created
    And the operator gets an impersonation token (JWT with both subjects: ops:bob impersonating alice)
    And an "Authorization.ImpersonationStarted" event is emitted
    And the customer tenant's primary admin receives a notification email
    And the impersonation appears in the customer's audit feed

  Scenario: Reject impersonation without a reason / ticket
    When the operator submits an Impersonation.Start with empty reason
    Then the response status is 400
    And the error code is "IMPERSONATION_REASON_REQUIRED"
    And no session is created
    And no notification is sent

  Scenario: Every action under impersonation emits an audit event
    Given operator "ops:bob" has an active ImpersonationSession for alice
    When ops:bob submits any intent on behalf of alice
    Then the event envelope carries `impersonatedBy: "ops:bob"`
    And an "Authorization.ImpersonationAction" event is emitted alongside the regular event
    And both are visible in the customer's audit feed
    And the customer's audit feed cannot be filtered to hide impersonation events

  Scenario: Impersonation auto-expires
    Given an ImpersonationSession with maxDurationMin=30 created 31 minutes ago
    When ops:bob tries to use the impersonation token
    Then the response status is 401
    And reason is "impersonation_expired"
    And an "Authorization.ImpersonationEnded" event records reason "auto_expired"

  Scenario: Operator ends impersonation explicitly
    Given an active ImpersonationSession
    When ops:bob submits an "Authorization.Impersonation.End" intent
    Then the ImpersonationSession status flips to "ended"
    And the impersonation token is invalidated
    And an "Authorization.ImpersonationEnded" event records reason "operator_ended"

  Scenario: Tenant admin revokes an active impersonation
    Given an active ImpersonationSession for alice
    And the admin is authenticated as a principal with role "TenantAdmin"
    When the admin submits an "Authorization.Impersonation.Revoke" intent
    Then the session status flips to "revoked"
    And ops:bob's next request returns 403
    And reason is "impersonation_revoked_by_tenant"
    And an "Authorization.ImpersonationEnded" event records reason "tenant_revoked"
    And ops engineer is notified out-of-band

  Scenario: Impersonation cannot be used for write actions on highly-sensitive resources
    Given an active ImpersonationSession
    And tenant "customer" has classified "Membership" as impersonation-readonly
    When ops:bob tries to submit a Membership-mutating intent
    Then the response status is 403
    And the error code is "IMPERSONATION_FORBIDDEN_FOR_RESOURCE"

  Scenario: Impersonation audit retention
    Given the tenant audit retention policy is 7 years for impersonation events
    When an "Authorization.ImpersonationStarted" event lands
    Then the event's retention tag is "impersonation:7y"
    And the audit pipeline routes it to long-term storage
    And the regular per-tenant retention policy does not shorten it
