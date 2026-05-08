-- Tenancy signup queue + email log (Phase: first vertical slice).
--
-- `signup_requests` is the projection backing the public-signup → admin-
-- approval flow. Lives in the control plane because tenants don't exist
-- yet at submission time. On approval the tenancy dispatcher inserts a
-- `control_plane.tenants` row, registers a custom domain, mints an
-- invite in the new tenant's DB, and flips this row to `'approved'`.
--
-- `email_log` is the read side of the dev/sim Mailer. Production
-- mailers (SMTP / SES) skip this table; the stdout adapter writes here
-- so the in-app mailbox panel can tail recent sends.
--
-- Both tables are control-plane scoped — neither is per-tenant.

SET search_path TO control_plane, public;

CREATE TABLE control_plane.signup_requests (
    signup_id           TEXT PRIMARY KEY,
    email               TEXT NOT NULL,
    tenant_slug         TEXT NOT NULL,
    organization_name   TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'denied')),
    approved_tenant_id  TEXT,
    denied_reason       TEXT,
    correlation_id      TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency on resubmit: same email + slug returns the existing row
-- rather than minting another pending request.
CREATE UNIQUE INDEX uniq_signup_requests_email_slug
    ON control_plane.signup_requests(email, tenant_slug);

-- Admin queue lookup is "give me the pending ones, oldest first."
CREATE INDEX idx_signup_requests_status_created
    ON control_plane.signup_requests(status, created_at);

CREATE TABLE control_plane.email_log (
    message_id      TEXT PRIMARY KEY,
    to_address      TEXT NOT NULL,
    subject         TEXT NOT NULL,
    body            TEXT NOT NULL,
    tenant_id       TEXT,
    correlation_id  TEXT,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tags            JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Mailbox panel filters by recipient; ordering is newest-first there.
CREATE INDEX idx_email_log_to_sent
    ON control_plane.email_log(to_address, sent_at DESC);
