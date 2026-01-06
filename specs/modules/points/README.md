# Points Module

## Purpose

Manages a configurable point system where users accumulate points for activities, with points having a tenant-defined monetary value.

## Responsibilities

- Define point system configuration (monetary value per point)
- Track user point balances
- Award points to users (via badges or other mechanisms)
- Deduct points (if applicable)
- Provide point balance query API for other modules
- Maintain point transaction history

## Owned Data

**Point System Configuration**
- Monetary value per point (default: 1 point ≈ 50 cents)
- Tenant scope

**User Point Balances**
- Per-user current point balance
- Tenant scope

**Point Transactions**
- Transaction log: user, amount, reason, timestamp, source module
- Supports auditing and history

## Dependencies

### Consumed Services
- None directly

### Consumed By
- **modules/tokens** — dynamic tokens like `[current_user_points]` query this module
- **modules/badges** — awards points when badges are earned
- **modules/import** — spreadsheet uploader can bulk award points
- Any feature that rewards or consumes points

## Runtime Behavior

**Point Award Flow**
1. External module (badges, import, etc.) requests point award
2. Points module validates request
3. Adds points to user's balance
4. Records transaction in point history
5. Returns success confirmation

**Point Query Flow**
1. External module (tokens, UI) requests user's current point balance
2. Points module returns balance from database

**Configuration Update**
1. Admin changes monetary value per point
2. Configuration updated tenant-wide
3. Does not retroactively affect earned points, only future valuation

## Integration Points

- Point balance API for tokens and UI components
- Point award API for badges and import modules
- Point transaction history for audit and reporting

## Open Questions

- Can points be deducted or only awarded?
- Is there a redemption mechanism (spend points)?
- Are there point expiration policies?
- Can points have different "types" or categories?
- Is the monetary value purely informational, or are there actual payouts?
- Can admins manually adjust user point balances?
- Are there point leaderboards or rankings?
