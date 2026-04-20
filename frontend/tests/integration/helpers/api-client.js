/**
 * Direct HTTP client for seeding test data and making assertions against the backend.
 * Bypasses the browser — talks straight to ingress.
 */
export class ApiClient {
  constructor(baseUrl = 'http://localhost:3000', tenantId = 'tenant-itest-001') {
    this.baseUrl = baseUrl;
    this.tenantId = tenantId;
    this.headers = {
      'Content-Type': 'application/json',
      'X-Debug-Principal': `user:admin:${tenantId}`,
    };
  }

  /** Generate a short unique ID */
  _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Wrap a payload in an EventEnvelope */
  _wrapEnvelope(payload, eventType) {
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
  async submitIntent(envelope) {
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
  async queryPage(pageId) {
    const res = await fetch(`${this.baseUrl}/api/v1/pages/${pageId}`, {
      headers: this.headers,
    });
    if (!res.ok) return null;
    return res.json();
  }

  /** GET all pages */
  async queryPages() {
    const res = await fetch(`${this.baseUrl}/api/v1/pages`, {
      headers: this.headers,
    });
    if (!res.ok) {
      throw new Error(`Query pages failed (${res.status})`);
    }
    return res.json();
  }

  /** Seed a page via intent and return the page info */
  async seedPage(title, slug) {
    const pageId = `pg_itest_${this._uid()}`;
    const payload = {
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
  async healthCheck() {
    const res = await fetch(`${this.baseUrl}/healthz`);
    return res.ok;
  }
}
