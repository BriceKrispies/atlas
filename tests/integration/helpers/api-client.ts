/**
 * Direct HTTP client for seeding test data and making assertions against the backend.
 * Bypasses the browser — talks straight to ingress.
 */

export interface EventEnvelope<TPayload = unknown> {
  eventId: string;
  eventType: string;
  schemaId: string;
  schemaVersion: number;
  occurredAt: string;
  tenantId: string;
  correlationId: string;
  idempotencyKey: string;
  payload: TPayload;
}

export interface CreatePagePayload {
  actionId: string;
  resourceType: string;
  pageId: string;
  title: string;
  slug: string;
}

export interface SeededPage {
  pageId: string;
  title: string;
  slug: string;
}

export class ApiClient {
  readonly baseUrl: string;
  readonly tenantId: string;
  readonly headers: Record<string, string>;

  constructor(
    baseUrl: string = 'http://localhost:3000',
    tenantId: string = 'tenant-itest-001'
  ) {
    this.baseUrl = baseUrl;
    this.tenantId = tenantId;
    this.headers = {
      'Content-Type': 'application/json',
      'X-Debug-Principal': `user:admin:${tenantId}`,
    };
  }

  /** Generate a short unique ID */
  private _uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Wrap a payload in an EventEnvelope */
  private _wrapEnvelope<TPayload>(
    payload: TPayload,
    eventType: string
  ): EventEnvelope<TPayload> {
    return {
      eventId: `evt-${this._uid()}`,
      eventType,
      schemaId: 'ui.contentpages.page.create.v1',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      tenantId: this.tenantId,
      correlationId: `corr-${this._uid()}`,
      idempotencyKey: `idem-${this._uid()}`,
      payload,
    };
  }

  /** POST an EventEnvelope to /api/v1/intents */
  async submitIntent<TPayload>(envelope: EventEnvelope<TPayload>): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/v1/intents`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Intent failed (${res.status}): ${body}`);
    }
    return res.json();
  }

  /** GET a single page by ID */
  async queryPage(pageId: string): Promise<unknown | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/pages/${pageId}`, {
      headers: this.headers,
    });
    if (!res.ok) return null;
    return res.json();
  }

  /** GET all pages */
  async queryPages(): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/v1/pages`, {
      headers: this.headers,
    });
    if (!res.ok) {
      throw new Error(`Query pages failed (${res.status})`);
    }
    return res.json();
  }

  /** Seed a page via intent and return the page info */
  async seedPage(title: string, slug: string): Promise<SeededPage> {
    const pageId = `pg_itest_${this._uid()}`;
    const payload: CreatePagePayload = {
      actionId: 'ContentPages.Page.Create',
      resourceType: 'Page',
      pageId,
      title,
      slug,
    };
    const envelope = this._wrapEnvelope(payload, 'ContentPages.PageCreateRequested');
    await this.submitIntent(envelope);
    return { pageId, title, slug };
  }

  /** Health check */
  async healthCheck(): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/healthz`);
    return res.ok;
  }
}
