# Organization Module Events

## Intents Emitted

**business_unit_created**
- When: Admin creates a new business unit
- Context: business unit name, description, tenant

**business_unit_updated**
- When: Admin modifies business unit (name, description)
- Context: business unit ID, changes made, tenant

**business_unit_deleted**
- When: Admin deletes a business unit
- Context: business unit name, member count, tenant

**user_added_to_business_unit**
- When: Admin adds a user to a business unit
- Context: user ID, business unit ID, tenant

**user_removed_from_business_unit**
- When: Admin removes a user from a business unit
- Context: user ID, business unit ID, tenant

**business_unit_nested**
- When: Admin adds a business unit as a member of another business unit
- Context: parent business unit ID, child business unit ID, tenant

**business_unit_unnested**
- When: Admin removes a nested business unit relationship
- Context: parent business unit ID, child business unit ID, tenant

**bulk_users_added_to_business_unit**
- When: Admin adds multiple users at once (via search + bulk select)
- Context: business unit ID, user count, search criteria used, tenant

## Intents Consumed

None directly. Org module provides services but does not consume intents from other modules.

## Event Integration

**Outbound**
- Business unit management generates admin activity intents
- Membership changes may affect permissions in other modules (comms, badges)
- Other modules subscribe to business unit changes to update their configurations

**Used By**
- **modules/comms** — queries business unit membership for messaging permissions
- **modules/badges** — may query business units for badge eligibility
- **modules/audit** — records all org changes in intent history

## Open Questions

- Are there webhooks or notifications when business unit membership changes?
- Do other modules cache business unit membership or query on-demand?
- Is there an event for "user's business unit membership resolved" (computed with nesting)?
