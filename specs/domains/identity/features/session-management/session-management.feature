# Hierarchy: identity / session-management
#
# AuthSession lifecycle: refresh, revocation, concurrent limits, idle
# timeout. Browser flows use cookie-based sessions with refresh tokens;
# API flows use bearer access tokens. Both back into the same
# `AuthSession` entity for revocation and audit.

@auth @identity @session
Feature: AuthSession management

  Background:
    Given a tenant "active" with the identity module enabled
    And user "alice@active.com" has an active Membership
    And alice has a logged-in AuthSession with refresh token

  Scenario: Refresh-token rotation on access-token renewal
    Given alice's access_token expires in 5 seconds
    When the browser POSTs "/identity/session/refresh" with the refresh_token cookie
    Then a new access_token is issued (1 hour TTL)
    And a new refresh_token is issued (the old one is invalidated)
    And the AuthSession.lastRefreshedAt is updated
    And an "Identity.SessionRefreshed" event is emitted

  Scenario: Reject reused refresh token (rotation-detection breach signal)
    Given alice's refresh_token was already rotated 30 seconds ago
    When the old (rotated) refresh_token is presented again
    Then the response status is 401
    And reason is "refresh_token_reuse"
    And ALL of alice's active sessions are revoked (defensive — possible token theft)
    And alice receives an "unusual activity" email
    And an "Identity.SessionAnomaly" event is emitted

  Scenario: User logs out
    When alice POSTs "/identity/session/logout"
    Then her AuthSession status flips to "ended"
    And the session cookie is cleared (Set-Cookie expires=0)
    And the refresh_token is invalidated
    And an "Identity.SessionEnded" event is emitted with reason "user_logout"

  Scenario: Admin revokes a specific session
    Given the admin is authenticated as a principal with role "TenantAdmin"
    And alice has 3 active AuthSessions (laptop, phone, tablet)
    When the admin submits an "Identity.AuthSession.Revoke" intent for the tablet session
    Then that AuthSession status flips to "revoked"
    And the next API call from the tablet returns 401
    And alice receives a "session ended" notification
    And an "Identity.SessionEnded" event records reason "admin_revoke"

  Scenario: Admin revokes ALL sessions for a user
    Given alice has 3 active sessions
    When the admin submits an "Identity.AuthSession.RevokeAllForUser" intent for alice
    Then all 3 AuthSessions status flip to "revoked"
    And alice is forced to re-authenticate everywhere

  Scenario: Concurrent-session limit enforcement
    Given tenant "active" has a maxConcurrentSessions=3 policy
    And alice already has 3 active AuthSessions
    When alice logs in from a 4th device
    Then the OLDEST active AuthSession is revoked first
    And the new login succeeds with the 3-active count preserved
    And an "Identity.SessionEvictedForLimit" event is emitted on the old session

  Scenario: Idle timeout
    Given alice has an AuthSession with idleTimeoutMinutes=30
    And no activity has occurred for 31 minutes
    When alice attempts to use her access_token
    Then the access_token validates (still within its 1-hour TTL)
    But the session middleware checks idleness and rejects with 401
    And reason is "session_idle"
    And the AuthSession status flips to "expired"

  Scenario: Hard timeout (absolute lifetime)
    Given alice's AuthSession was created 25 hours ago
    And the tenant policy is hardTimeoutHours=24
    When alice's refresh_token is used
    Then the response status is 401
    And reason is "session_hard_timeout"
    And alice must re-authenticate from scratch (full primary + MFA)

  Scenario: Inspect own sessions
    When alice GETs "/identity/sessions"
    Then the response lists all her active AuthSessions with:
      | sessionId | createdAt | lastSeenAt | ip | userAgent |
    And alice can revoke any of them via UI

  Scenario: Tenant-wide forced re-login (after policy change)
    Given the admin updates the password policy with a stricter complexity requirement
    When the admin opts to "force re-login on all sessions"
    Then every AuthSession across the tenant is marked status="revoked"
    And the next request from each session returns 401
