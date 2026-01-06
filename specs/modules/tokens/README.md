# Tokens Module

## Purpose

Provides a token registry and evaluation system that allows arbitrary text tokens (e.g., `[site_url]`, `[current_user_points]`) to be defined and dynamically substituted at runtime throughout the system.

## Responsibilities

- Define and manage text tokens via admin interface
- Store token definitions (name, evaluation logic)
- Evaluate tokens at runtime when requested by other modules
- Support both static tokens (fixed values) and dynamic tokens (read from system state)
- Provide token registry API for consumption by other modules

## Owned Data

**Token Definitions**
- Token name (e.g., `site_url`, `current_user_points`)
- Token type: static or dynamic
- Value or evaluation logic (how to resolve the token)
- Tenant scope

## Dependencies

### Consumed Services
- **modules/points** — dynamic tokens like `[current_user_points]` read from points system
- **Other system state** — tokens may need to read from various parts of the system (TBD which parts)

### Consumed By
- **modules/comms** — email templates embed tokens that are evaluated when emails are sent
- Potentially any module that displays dynamic text to users

## Runtime Behavior

**Token Evaluation**
1. External module requests token evaluation (e.g., emailer building an email)
2. Token registry receives text containing tokens (e.g., "Visit [site_url] to see your [current_user_points] points")
3. Registry identifies all `[token_name]` placeholders
4. For each token, looks up definition in token registry
5. Evaluates token based on type:
   - Static: returns stored value
   - Dynamic: executes evaluation logic (e.g., query user's current points)
6. Replaces all token placeholders with evaluated values
7. Returns fully evaluated text

## Integration Points

- Provides token substitution API/service for other modules
- May need plugin or hook system for dynamic token evaluation

## Open Questions

- What is the exact syntax for dynamic token evaluation logic? (SQL? scripting language? predefined functions?)
- Can tokens accept parameters? (e.g., `[user_points:user_id]`)
- Are there security restrictions on what dynamic tokens can read?
- Can tokens call external APIs?
- Is there a performance concern with evaluating complex dynamic tokens?
- What happens if a token fails to evaluate? (error message? empty string? keep placeholder?)
- Can tokens be nested? (e.g., `[site_[env]_url]`)
