# Hierarchy: catalog / family-publish / publish-revision / revise-and-publish
#
# Behavioral spec for the family-publish capability — when a tenant admin
# publishes a revision of a catalog family, the platform records the new
# revision number in catalog state and emits a
# StructuredCatalog.FamilyPublished event with cache-invalidation tags.
#
# References:
#   modules/catalog/src/handlers/family-publish.ts (handler)
#   specs/architecture.md I2 (authz precedes execution),
#                         I3 (idempotency before execution),
#                         I5 (correlationId propagation),
#                         I7 (tenant isolation),
#                         I10 (event-driven cache invalidation)
#   packages/schemas/src/generated/badge-family.json (seed payload)

Feature: Publish a revised catalog family

  As a tenant admin
  I want to publish revisions of a product family
  So that downstream projections + caches reflect the new revision
  while older revisions remain in event history.

  Background:
    Given a tenant "acme" with the catalog module enabled
    And the badge-family seed has been applied for tenant "acme"

  @sim
  Scenario: Publishing a revision emits a FamilyPublished event
    Given the admin is authenticated as a principal with role "TenantAdmin"
    When the admin publishes "service_anniversary_badge" at revision 1
    Then a "StructuredCatalog.FamilyPublished" event is emitted with revision 1
    And the event carries the request correlationId
    And the event carries cache invalidation tags including "Tenant:acme" and "SearchIndex:catalog"

  @sim
  Scenario: Republishing the same revision is idempotent (Invariant I3)
    Given the admin is authenticated as a principal with role "TenantAdmin"
    When the admin publishes "service_anniversary_badge" at revision 1
    And the admin re-submits the same publish envelope
    Then exactly one "StructuredCatalog.FamilyPublished" event exists for that idempotency key

  @sim
  Scenario: Authorization denial leaves no side effects (Invariant I2)
    Given the admin is authenticated as a principal with role "Viewer"
    When the admin attempts to publish "service_anniversary_badge" at revision 1
    Then the request is denied with code "UNAUTHORIZED"
    And no "StructuredCatalog.FamilyPublished" event exists in the event store

  @sim
  Scenario: Cross-tenant query isolation (Invariant I7)
    Given a separate tenant "globex" has no catalog data
    And the admin is authenticated as a principal with role "TenantAdmin"
    When the admin queries the family "service_anniversary_badge"
    Then the response describes the "acme" family
    When the admin re-authenticates for tenant "globex"
    And the admin queries the family "service_anniversary_badge"
    Then the response is empty
