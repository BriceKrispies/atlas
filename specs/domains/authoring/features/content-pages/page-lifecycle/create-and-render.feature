# Hierarchy: authoring / content-pages / page-lifecycle / create-and-render
#
# Behavioral spec for the page-lifecycle capability on the L3 substrate —
# when a tenant admin creates, lists, updates, or deletes a content page,
# the platform persists the canonical Page entity and links its render
# tree via the `page.render-tree` relation. Reads come back through
# EntityStore + RelationStore.
#
# References:
#   modules/content-pages/src/handlers/page-create.ts (handler)
#   modules/content-pages/src/queries.ts (read path)
#   modules/content-pages/src/entities/page.ts (entity helpers)
#   specs/architecture.md I2 (authz precedes execution),
#                         I5 (correlationId propagation),
#                         I7 (tenant isolation),
#                         I9 (cache keys include tenantId),
#                         I10 (event-driven cache invalidation)
#   packages/schemas/src/generated/content_pages.page.create.v1.schema.json
#   packages/schemas/src/generated/content_pages.page.update.v1.schema.json
#   packages/schemas/src/generated/content_pages.page.delete.v1.schema.json

Feature: Page lifecycle on the L3 substrate

  As a tenant admin
  I want to create, list, update, and delete content pages
  So that the canonical Page entity and its render tree stay in sync
  with reads coming back through EntityStore + RelationStore.

  Background:
    Given a tenant "acme" with the content-pages module enabled
    And the admin is authenticated as a principal with role "TenantAdmin"

  @sim
  Scenario: Creating a page persists the entity and links its render tree
    When the admin creates a page "home" with title "Home" and slug "home"
    Then the page "home" exists with title "Home" and status "draft"
    And the render tree for page "home" is the default tree

  @sim
  Scenario: Listing pages returns the created page
    Given the admin has created a page "about" with title "About" and slug "about"
    When the admin lists all pages
    Then the listing contains a page with id "about" titled "About"

  @sim
  Scenario: Updating a page preserves createdAt and bumps updatedAt
    Given the admin has created a page "blog" with title "Old" and slug "blog"
    When the admin updates page "blog" to title "New"
    Then the page "blog" has title "New"
    And the page "blog" updatedAt is later than its createdAt

  @sim
  Scenario: Deleting a page removes it from queries
    Given the admin has created a page "tmp" with title "Temp" and slug "tmp"
    When the admin deletes page "tmp"
    Then the page "tmp" is null
    And the listing does not contain a page with id "tmp"
