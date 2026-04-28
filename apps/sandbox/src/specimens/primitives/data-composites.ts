import { S } from '../_register.ts';

// Pre-compute timestamps relative to "now" so the timeline always
// reads as a recent event log no matter when the sandbox is opened.
const now = Date.now();
const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();

S({
  id: 'timeline',
  name: 'Timeline',
  tag: 'atlas-timeline',
  variants: [
    {
      name: 'Activity log (5 events, mixed variants)',
      html: `
        <atlas-timeline>
          <atlas-timeline-item timestamp="${iso(2 * 60 * 1000)}" variant="success">
            <atlas-text variant="medium">Deployment succeeded</atlas-text>
            <atlas-text variant="muted" block>Build #482 promoted to production.</atlas-text>
            <span slot="meta">by alice@atlas</span>
          </atlas-timeline-item>
          <atlas-timeline-item timestamp="${iso(15 * 60 * 1000)}" variant="info">
            <atlas-text variant="medium">Page published</atlas-text>
            <atlas-text variant="muted" block>"Welcome" page is now live.</atlas-text>
            <span slot="meta">by carol@atlas</span>
          </atlas-timeline-item>
          <atlas-timeline-item timestamp="${iso(2 * 60 * 60 * 1000)}" variant="warning">
            <atlas-text variant="medium">Quota nearing limit</atlas-text>
            <atlas-text variant="muted" block>Tenant storage at 87% (8.7 GB of 10 GB).</atlas-text>
          </atlas-timeline-item>
          <atlas-timeline-item timestamp="${iso(6 * 60 * 60 * 1000)}" variant="danger">
            <atlas-text variant="medium">Webhook delivery failed</atlas-text>
            <atlas-text variant="muted" block>3 consecutive 5xx responses from billing endpoint.</atlas-text>
            <span slot="meta">retry scheduled</span>
          </atlas-timeline-item>
          <atlas-timeline-item timestamp="${iso(2 * 24 * 60 * 60 * 1000)}">
            <atlas-text variant="medium">Tenant created</atlas-text>
            <atlas-text variant="muted" block>"Acme Corp" provisioned on the EU-1 cluster.</atlas-text>
            <span slot="meta">by system</span>
          </atlas-timeline-item>
        </atlas-timeline>
      `,
    },
  ],
});

S({
  id: 'stat',
  name: 'Stat',
  tag: 'atlas-stat',
  variants: [
    {
      name: '3-up grid (DAU / Error rate / Latency)',
      html: `
        <atlas-grid columns="3" gap="md">
          <atlas-stat
            label="Daily active users"
            value="12,847"
            trend="up"
            trend-label="+8.2% vs last week"
            variant="success"
          ></atlas-stat>
          <atlas-stat
            label="Error rate"
            value="0.42"
            unit="%"
            trend="down"
            trend-label="-0.18 pp vs last week"
            variant="success"
          ></atlas-stat>
          <atlas-stat
            label="P95 latency"
            value="284"
            unit="ms"
            trend="up"
            trend-label="+34 ms vs last week"
            variant="warning"
          ></atlas-stat>
        </atlas-grid>
      `,
    },
    {
      name: 'Sizes (sm / md / lg)',
      html: `
        <atlas-stack gap="md">
          <atlas-stat size="sm" label="Pageviews" value="4.2M" trend="flat" trend-label="No change"></atlas-stat>
          <atlas-stat label="Pageviews" value="4.2M" trend="up" trend-label="+12% w/w"></atlas-stat>
          <atlas-stat size="lg" label="Pageviews" value="4.2M" trend="up" trend-label="+12% w/w" variant="success"></atlas-stat>
        </atlas-stack>
      `,
    },
    {
      name: 'Danger variant',
      html: `
        <atlas-stat
          label="Failed jobs"
          value="284"
          trend="up"
          trend-label="+212 vs yesterday"
          variant="danger"
        ></atlas-stat>
      `,
    },
  ],
});

S({
  id: 'split-button',
  name: 'Split Button',
  tag: 'atlas-split-button',
  variants: [
    {
      name: 'Primary (Save / Save and close, Save as draft)',
      html: `
        <atlas-split-button variant="primary" name="save">
          Save
          <div slot="menu">
            <atlas-stack gap="xs">
              <atlas-button size="sm">Save and close</atlas-button>
              <atlas-button size="sm">Save as draft</atlas-button>
              <atlas-button size="sm">Save as template…</atlas-button>
            </atlas-stack>
          </div>
        </atlas-split-button>
      `,
    },
    {
      name: 'Secondary (Export)',
      html: `
        <atlas-split-button name="export">
          Export
          <div slot="menu">
            <atlas-stack gap="xs">
              <atlas-button size="sm">Export as CSV</atlas-button>
              <atlas-button size="sm">Export as JSON</atlas-button>
              <atlas-button size="sm">Export as PDF</atlas-button>
            </atlas-stack>
          </div>
        </atlas-split-button>
      `,
    },
    {
      name: 'Danger (Delete / Archive / Restore)',
      html: `
        <atlas-split-button variant="danger" name="delete">
          Delete
          <div slot="menu">
            <atlas-stack gap="xs">
              <atlas-button size="sm">Archive instead</atlas-button>
              <atlas-button size="sm">Restore from trash</atlas-button>
            </atlas-stack>
          </div>
        </atlas-split-button>
      `,
    },
    {
      name: 'Disabled',
      html: `
        <atlas-split-button variant="primary" name="save-disabled" disabled>
          Save
          <div slot="menu">
            <atlas-stack gap="xs">
              <atlas-button size="sm">Save and close</atlas-button>
            </atlas-stack>
          </div>
        </atlas-split-button>
      `,
    },
  ],
});

S({
  id: 'toggle-group',
  name: 'Toggle Group',
  tag: 'atlas-toggle-group',
  variants: [
    {
      name: 'Single-select (text alignment)',
      html: `
        <atlas-toggle-group selection="single" name="align" value="left" aria-label="Text alignment">
          <atlas-toggle-group-item value="left" label="Left"></atlas-toggle-group-item>
          <atlas-toggle-group-item value="center" label="Center"></atlas-toggle-group-item>
          <atlas-toggle-group-item value="right" label="Right"></atlas-toggle-group-item>
          <atlas-toggle-group-item value="justify" label="Justify"></atlas-toggle-group-item>
        </atlas-toggle-group>
      `,
    },
    {
      name: 'Multi-select (text formatting)',
      html: `
        <atlas-toggle-group selection="multiple" name="format" value="bold,italic" aria-label="Text formatting">
          <atlas-toggle-group-item value="bold" label="Bold"></atlas-toggle-group-item>
          <atlas-toggle-group-item value="italic" label="Italic"></atlas-toggle-group-item>
          <atlas-toggle-group-item value="underline" label="Underline"></atlas-toggle-group-item>
          <atlas-toggle-group-item value="strike" label="Strike"></atlas-toggle-group-item>
        </atlas-toggle-group>
      `,
    },
    {
      name: 'Sizes (sm / md) and disabled item',
      html: `
        <atlas-stack gap="md">
          <atlas-toggle-group selection="single" size="sm" value="day" aria-label="Range">
            <atlas-toggle-group-item value="day" label="Day"></atlas-toggle-group-item>
            <atlas-toggle-group-item value="week" label="Week"></atlas-toggle-group-item>
            <atlas-toggle-group-item value="month" label="Month"></atlas-toggle-group-item>
            <atlas-toggle-group-item value="year" label="Year" disabled></atlas-toggle-group-item>
          </atlas-toggle-group>
          <atlas-toggle-group selection="multiple" value="email" aria-label="Notify via">
            <atlas-toggle-group-item value="email" label="Email"></atlas-toggle-group-item>
            <atlas-toggle-group-item value="sms" label="SMS"></atlas-toggle-group-item>
            <atlas-toggle-group-item value="push" label="Push"></atlas-toggle-group-item>
            <atlas-toggle-group-item value="webhook" label="Webhook"></atlas-toggle-group-item>
          </atlas-toggle-group>
        </atlas-stack>
      `,
    },
  ],
});
