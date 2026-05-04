# Billing

**Platform:** Commerce
**Status:** Stub — domain shape committed, content TBD.

## Purpose

Invoices, subscriptions, payments, usage, receipts. Two scopes (planned, in this order):

1. **Atlas billing tenants** — platform-level subscription metering, invoice generation, payment collection from tenants who use Atlas.
2. **Tenants billing end users** — white-label commerce: tenant-configured products, pricing, checkout for *their* end users.

These share the same primitives (subscriptions, line items, payment processors, tax rules) and live as separate capabilities under one domain — keep the seam clean from day one so (2) doesn't require a re-architecture when it lands.

## Capabilities

TBD. List capabilities here as they're scoped. Capabilities are the agent
ownership unit — one capability ≈ one agent.

Initial split:
- `platform-billing` — Atlas → tenant
- `tenant-billing` — tenant → end-user (later)

## Cross-references

(no legacy mapping)
