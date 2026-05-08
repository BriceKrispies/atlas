/**
 * Mailer — outbound email seam.
 *
 * Production deployments wire an SMTP / Sendgrid / SES adapter here. Dev
 * + sim use a stdout adapter that also persists each send to
 * `control_plane.email_log` so an in-app "mailbox" panel can read them
 * back through `EmailLogStore`. The two surfaces are deliberately split:
 * `Mailer` is write-only (the side-effect interface that handlers reach
 * for); `EmailLogStore` is read-only (the projection the demo UI tails).
 *
 * Hostname / link construction is the **caller's** responsibility — the
 * handler that asks for an email knows the tenant's primary domain and
 * the magic-link token. Mailer does not assemble URLs.
 */
export interface EmailMessage {
  /** Recipient address. Lowercased canonical form preferred. */
  to: string;
  subject: string;
  /** Plain-text body. HTML support lands when a real adapter does. */
  body: string;
  /**
   * Tenant the email is *about* (for log filtering + invalidation tags).
   * Set to `null` for control-plane-scoped sends like signup
   * confirmations where no tenant exists yet.
   */
  tenantId: string | null;
  correlationId: string;
  /** Free-form labels for filtering ("magic-link", "signup-approved", …). */
  tags?: string[];
}

export interface MailerSendResult {
  /** Adapter-assigned id; survives round-trips through the email_log read API. */
  messageId: string;
  /** RFC-3339 timestamp the adapter recorded. */
  sentAt: string;
}

export interface Mailer {
  send(msg: EmailMessage): Promise<MailerSendResult>;
  /**
   * Optional. Called by apps during graceful shutdown to release transport
   * resources (SMTP connection pools, etc). Adapters that don't hold
   * long-lived resources can omit.
   */
  close?(): Promise<void>;
}

/** Read-side surface for the in-app mailbox panel. */
export interface EmailLogEntry {
  messageId: string;
  to: string;
  subject: string;
  body: string;
  tenantId: string | null;
  correlationId: string | null;
  sentAt: string;
  tags: string[];
}

export interface EmailLogQuery {
  /** Filter to a single recipient when set. */
  to?: string;
  /** Cap result size; adapters MUST honour this. Default 100. */
  limit?: number;
  /** Return rows whose `messageId` is greater than this watermark. */
  sinceMessageId?: string;
}

export interface EmailLogStore {
  list(filter?: EmailLogQuery): Promise<EmailLogEntry[]>;
}
