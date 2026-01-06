# Points Module Schema

## Module Overview

The points module owns the point system: user point balances, point transactions, and point system configuration.

**Data Ownership:**
- Owns: Point system configuration, user point balances, point transactions
- References: Users (external to these specs)

**Purpose:**
Track user-accumulated points with tenant-defined monetary value, providing an API for awarding points and querying balances.

## Entities

### PointSystemConfig

**Description:**
Tenant-wide configuration for the point system, defining the monetary value per point.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when tenant is provisioned (or first configured)
- Updated by tenant admin
- Mutable configuration entity

**Key Fields:**
- config_id — unique identifier (likely one per tenant)
- tenant_id — owning tenant
- monetary_value_per_point — default: 0.50 (1 point ≈ 50 cents)
- created_at — creation timestamp
- updated_at — last modification timestamp

**Invariants:**
- One configuration per tenant
- Default value is 1 point ≈ $0.50
- Value can be changed by admin and applies tenant-wide
- Configuration changes do not retroactively alter earned points

---

### UserPointBalance

**Description:**
Current point balance for a user within a tenant. Represents the sum of all point transactions for that user.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when user first receives points
- Updated whenever points are awarded or deducted
- Mutable (balance changes as transactions occur)

**Key Fields:**
- balance_id — unique identifier
- user_id — reference to user
- tenant_id — owning tenant
- balance — current point balance (integer or decimal)
- updated_at — last balance change timestamp

**Invariants:**
- One balance record per user per tenant
- Balance is non-negative (unless deductions are supported, which is unclear)
- Balance is the sum of all PointTransaction amounts for the user

---

### PointTransaction

**Description:**
An immutable record of a single point award or deduction. Provides audit trail and history for all point changes.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when points are awarded or deducted
- Never updated or deleted
- Append-only / immutable

**Key Fields:**
- transaction_id — unique identifier
- user_id — user receiving or losing points
- tenant_id — owning tenant
- amount — point amount (positive for award, negative for deduction)
- reason — human-readable description of why points were awarded/deducted
- source — which module or process triggered the transaction (e.g., 'badges', 'import', 'manual')
- timestamp — when transaction occurred
- created_at — record creation timestamp

**Invariants:**
- All point transactions must be logged
- Transactions are immutable (never edited or deleted)
- UserPointBalance.balance must equal sum of all PointTransaction.amount for that user

## Relationships

### Internal Relationships

**UserPointBalance → PointTransaction**
- Cardinality: One-to-many (one balance has many transactions)
- Directionality: PointTransaction contributes to UserPointBalance
- Notes: Balance is derived from sum of transactions

**PointSystemConfig → UserPointBalance**
- Cardinality: One-to-many (one config applies to many balances in the tenant)
- Directionality: Config defines monetary value for all balances
- Notes: Relationship is implicit (config applies tenant-wide)

### Cross-Module Relationships

**UserPointBalance → (referenced by) → TokenDefinition (modules/tokens)**
- Cardinality: Many-to-one (dynamic tokens query balance)
- Directionality: Referenced by (tokens read balance at evaluation time)
- Notes: Dynamic tokens like `[current_user_points]` query UserPointBalance

**PointTransaction → (created by) → BadgeAward (modules/badges)**
- Cardinality: One-to-one or many-to-one (badge award triggers point transaction)
- Directionality: PointTransaction is created as result of badge award
- Notes: Badges module calls points API to award points

**PointTransaction → (created by) → Import (modules/import)**
- Cardinality: Many-to-one (bulk import creates many transactions)
- Directionality: PointTransaction is created as result of import commit
- Notes: Spreadsheet uploader can bulk award points

**UserPointBalance → (queried by) → User (external)**
- Cardinality: One-to-one (one user has one balance per tenant)
- Directionality: References user directory
- Notes: user_id must exist in user management system

## Derived / Computed Concepts

**User Point Balance:**
- UserPointBalance.balance is derived from sum of PointTransaction.amount
- May be maintained as a materialized view or denormalized field for performance
- Must be kept in sync with transactions

**Monetary Value of Balance:**
- Computed on-demand: UserPointBalance.balance × PointSystemConfig.monetary_value_per_point
- Not stored separately
- Changes when config is updated, but point balance remains constant

**Point Leaderboard:**
- Spec mentions "top 10 point earners"
- Derived by querying UserPointBalance ordered by balance descending
- Not stored as separate entity

**Total Points Awarded:**
- Aggregate statistic: sum of all PointTransaction.amount where amount > 0
- Computed on-demand for admin statistics
- Not stored separately

## Events & Audit Implications

**Intents Emitted:**
- `points_configuration_updated` — admin changes monetary value (mutable admin activity)
- `points_awarded` — points added to user balance (immutable event)
- `points_deducted` — points removed from user balance (if supported, immutable event)
- `manual_points_adjustment` — admin manually awards/deducts points (immutable event)
- `points_balance_queried` (possibly) — balance queried by token or UI (high-volume, may not be tracked)

**Immutability:**
- PointSystemConfig is mutable
- UserPointBalance is mutable (balance updates)
- PointTransaction is immutable (append-only)

**Audit Dependency:**
- All point transactions and configuration changes are consumed by modules/audit for history tracking
- PointTransaction provides secondary audit trail for point awards/deductions

## Open Questions

### Point Deductions
- Can points be deducted, or only awarded?
- If deducted, can balance go negative?
- What triggers deductions? (redemption, manual adjustment, penalties?)

### Manual Point Adjustments
- Can admins manually award or deduct points via the UI?
- If so, is there approval workflow or audit trail beyond the intent?
- Can admins bulk-adjust points for multiple users?

### Point Redemption
- Is there a redemption mechanism (spend points)?
- If so, what can points be redeemed for?
- Is redemption tracked separately from deductions?

### Point Expiration
- Are there point expiration policies?
- Can points expire after a certain time period?
- If expired, are they deducted via PointTransaction?

### Point Types or Categories
- Can points have different "types" or categories? (e.g., loyalty points vs. performance points)
- Or is there a single global point balance per user per tenant?

### Monetary Value
- Is the monetary value purely informational (display only) or tied to actual payouts?
- Are there payout mechanisms for converting points to currency?
- How granular is the monetary value? (cents only, or fractional cents?)

### Point Transaction Source Tracking
- What values are allowed for PointTransaction.source? (free-form text, enum, module ID?)
- Is source used for reporting or filtering (e.g., "show all badge-awarded points")?

### Balance Synchronization
- How is UserPointBalance kept in sync with PointTransaction sum?
- Is it updated transactionally with each transaction?
- Or is it periodically recalculated from transactions?
- What happens if balance and transaction sum diverge (data corruption)?

### Point Balance Queries
- Should point balance queries be logged as intents? (Could be very high-volume)
- Are there performance metrics on balance query latency or throughput?
- Is balance cached or always queried from database?

### Point Statistics and Analytics
- Are there reports on point distribution, trends, or analytics?
- Can admins see aggregate point statistics (total awarded, average per user, etc.)?
- Are these computed on-demand or pre-aggregated?

### Point Archival or Reset
- Can points be archived or reset (e.g., yearly reset)?
- If reset, what happens to historical balances and transactions?
