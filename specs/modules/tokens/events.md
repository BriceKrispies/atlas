# Tokens Module Events

## Intents Emitted

**token_created**
- When: Admin creates a new token definition
- Context: token name, token type (static/dynamic), tenant

**token_updated**
- When: Admin modifies an existing token definition
- Context: token name, old value/logic, new value/logic, tenant

**token_deleted**
- When: Admin deletes a token definition
- Context: token name, tenant

**token_evaluated**
- When: Token registry evaluates a token at runtime (possibly)
- Context: token name, evaluation result, requesting module, tenant
- Note: May be high-volume; consider whether to record this

## Intents Consumed

None directly. Token evaluation may read state from other modules (e.g., points) but does not consume intents.

## Event Integration

- Token CRUD operations generate audit intents for history tracking
- Token evaluation is a read operation; may not generate intents unless tracking is desired for debugging/analytics
- Failed token evaluations may generate error/warning events for admin visibility

## Open Questions

- Should every token evaluation be recorded as an intent? (Could be high-volume)
- Are there alerts for failed dynamic token evaluations?
- Do we track which tokens are most frequently used?
