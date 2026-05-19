/**
 * StdoutEventMailer — dev/sim adapter for the `Mailer` port.
 *
 * Writes a structured line to stdout for grep-the-server-logs flows AND
 * inserts a row into `control_plane.email_log` so the in-app mailbox
 * panel (a thin SSE/poll client over `EmailLogStore`) can show what was
 * "sent." Production deployments wire SMTP/SES here instead and skip
 * the email_log table.
 *
 * Hostnames + magic-link URLs are NOT constructed here — callers compose
 * the body before calling `send`. This keeps the mailer agnostic to
 * tenant-URL shape (which lives in `@atlas/platform-core/tenant-urls`).
 */

import type postgres from 'postgres';
import type {
  EmailLogEntry,
  EmailLogQuery,
  EmailLogStore,
  EmailMessage,
  Mailer,
  MailerSendResult,
} from '@atlas/ports';

function newMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface EmailLogRow {
  message_id: string;
  to_address: string;
  subject: string;
  body: string;
  tenant_id: string | null;
  correlation_id: string | null;
  sent_at: string;
  tags: string[] | null;
}

function rowToEntry(row: EmailLogRow): EmailLogEntry {
  return {
    messageId: row.message_id,
    to: row.to_address,
    subject: row.subject,
    body: row.body,
    tenantId: row.tenant_id,
    correlationId: row.correlation_id,
    sentAt: row.sent_at,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

export class StdoutEventMailer implements Mailer {
  constructor(private readonly sql: postgres.Sql) {}

  async send(msg: EmailMessage): Promise<MailerSendResult> {
    const messageId = newMessageId();
    const tags = msg.tags ?? [];
    const sentAt = new Date().toISOString();

    // Persist first, then emit the human-readable trace line. If the
    // insert fails the message hasn't been "sent" — surface the error
    // rather than logging a phantom send.
    await this.sql`
      INSERT INTO control_plane.email_log (
        message_id, to_address, subject, body, tenant_id,
        correlation_id, sent_at, tags
      ) VALUES (
        ${messageId},
        ${msg.to.toLowerCase()},
        ${msg.subject},
        ${msg.body},
        ${msg.tenantId},
        ${msg.correlationId},
        ${sentAt},
        ${this.sql.json(tags)}
      )
    `;

    // One JSON line per send so log-streamers (Loki, the in-app log panel)
    // can correlate by `correlationId`. Body is intentionally omitted —
    // magic-link tokens land in body and tokens are credentials per
    // specs/crosscut/logging.md. The full body is in email_log above for
    // the in-app mailbox panel.
    //
    // Direct `console.log` here is the PRODUCT BEHAVIOR of this adapter:
    // `StdoutEventMailer` is the noop/dev mailer driver whose job is to
    // emit the message envelope to stdout for harness inspection. The
    // SMTP adapter routes its equivalent line through `ctx.logger.info`.
    // eslint-disable-next-line no-console -- contract-exempt: stdout mailer's stdout emission IS the side effect (see file header + mailer-stdout.test.ts spies).
    console.log(
      JSON.stringify({
        // Canonical Domain.Verb.Outcome event name per
        // specs/crosscut/logging.md. SmtpMailer emits the same event name
        // through ctx.logger.info — both adapters are now grep-able as one.
        event: 'Mailer.Send.Success',
        messageId,
        to: msg.to,
        subject: msg.subject,
        tenantId: msg.tenantId,
        correlationId: msg.correlationId,
        tags,
        sentAt,
      }),
    );

    return { messageId, sentAt };
  }
}

export class PostgresEmailLogStore implements EmailLogStore {
  constructor(private readonly sql: postgres.Sql) {}

  async list(filter?: EmailLogQuery): Promise<EmailLogEntry[]> {
    const limit = Math.max(1, Math.min(filter?.limit ?? 100, 500));
    const to = filter?.to;
    const since = filter?.sinceMessageId;
    // postgres.js fragments compose cleanly when each branch returns the
    // same shape. Avoids the "build a string" trap that would invite SQL
    // injection.
    const rows = await this.sql<EmailLogRow[]>`
      SELECT message_id, to_address, subject, body, tenant_id,
             correlation_id, sent_at, tags
      FROM control_plane.email_log
      WHERE TRUE
        ${to ? this.sql`AND to_address = ${to.toLowerCase()}` : this.sql``}
        ${since ? this.sql`AND message_id > ${since}` : this.sql``}
      ORDER BY sent_at DESC
      LIMIT ${limit}
    `;
    return rows.map(rowToEntry);
  }
}
