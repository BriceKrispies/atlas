/**
 * SmtpMailer — production / dev SMTP adapter for the `Mailer` port.
 *
 * Sibling to `StdoutEventMailer`. Both implement the same `Mailer`
 * interface and BOTH insert into `control_plane.email_log` so the
 * read-side `EmailLogStore` works regardless of which driver is wired.
 * The difference is purely the side-effect: stdout writes a JSON line,
 * SmtpMailer hands the message to a `nodemailer` transport.
 *
 * In dev/itest the transport points at `smtp4dev`
 * (`infra/compose/compose.smtp4dev.yml`), which captures every send
 * without relaying anywhere. Production deployments wire the same
 * adapter against a real SMTP relay (or replace it with a SaaS-specific
 * adapter when one lands).
 *
 * Hostname / magic-link URL assembly is the **caller's** responsibility
 * (see `ports/src/mailer.ts:11`). This adapter only reads `EmailMessage`
 * fields and ships them.
 */

import type postgres from 'postgres';
import { createTransport, type Transporter } from 'nodemailer';
import type {
  EmailMessage,
  Mailer,
  MailerSendResult,
} from '@atlas/ports';

export interface SmtpMailerConfig {
  host: string;
  port: number;
  /** RFC-5322 From address used for every outbound message. */
  from: string;
}

interface MailRow {
  message_id: string;
  to_address: string;
  subject: string;
  body: string;
  tenant_id: string | null;
  correlation_id: string | null;
  sent_at: string;
  tags: string[];
}

function newMessageId(): string {
  return `smtp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly fromAddress: string;

  constructor(
    private readonly sql: postgres.Sql,
    config: SmtpMailerConfig,
  ) {
    // Transport is owned by the adapter so apps/server doesn't need a
    // direct dependency on `nodemailer`. Pool=true keeps a small set of
    // long-lived TCP connections to the relay, which is what we want
    // for a server that sends a steady trickle of magic-link mail.
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      pool: true,
    });
    this.fromAddress = config.from;
  }

  async send(msg: EmailMessage): Promise<MailerSendResult> {
    const tags = msg.tags ?? [];
    const sentAt = new Date().toISOString();

    // 1. Hand the message off to SMTP first. If the relay refuses,
    //    the email "did not send" — surface the error rather than
    //    record a phantom row in email_log.
    const info = await this.transport.sendMail({
      from: this.fromAddress,
      to: msg.to,
      subject: msg.subject,
      text: msg.body,
      headers: {
        'X-Atlas-Correlation-Id': msg.correlationId,
        ...(msg.tenantId ? { 'X-Atlas-Tenant-Id': msg.tenantId } : {}),
      },
    });

    // 2. Use the SMTP-supplied messageId when available so log entries
    //    correlate with the receiving server's records. Fall back to
    //    a locally-minted id (matches `StdoutEventMailer` shape).
    const messageId = (info.messageId as string | undefined) ?? newMessageId();

    // 3. Persist for the in-app mailbox panel + audit. Same column
    //    shape as StdoutEventMailer.
    const row: MailRow = {
      message_id: messageId,
      to_address: msg.to.toLowerCase(),
      subject: msg.subject,
      body: msg.body,
      tenant_id: msg.tenantId,
      correlation_id: msg.correlationId,
      sent_at: sentAt,
      tags,
    };
    await this.sql`
      INSERT INTO control_plane.email_log (
        message_id, to_address, subject, body, tenant_id,
        correlation_id, sent_at, tags
      ) VALUES (
        ${row.message_id},
        ${row.to_address},
        ${row.subject},
        ${row.body},
        ${row.tenant_id},
        ${row.correlation_id},
        ${row.sent_at},
        ${this.sql.json(row.tags)}
      )
    `;

    // 4. One JSON line per send so log-streamers (Loki, in-app log
    //    panel) can correlate by `correlationId`. Mirrors stdout adapter.
    console.log(
      JSON.stringify({
        event: 'mailer.sent',
        driver: 'smtp',
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

  /**
   * Release the pooled SMTP transport. Wrapped so a misbehaving relay
   * can't block process shutdown — log and move on.
   */
  async close(): Promise<void> {
    try {
      this.transport.close();
    } catch (e) {
      console.log(
        JSON.stringify({
          event: 'mailer.close.error',
          driver: 'smtp',
          error: (e as Error).message,
        }),
      );
    }
  }
}
