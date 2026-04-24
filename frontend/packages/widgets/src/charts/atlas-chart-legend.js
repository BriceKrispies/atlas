import { AtlasElement, effect } from '@atlas/core';

/**
 * <atlas-chart-legend> — legend row. When used inside an
 * `<atlas-chart-card>` it reads series from the card's store and
 * toggles visibility via `commit('toggleSeries', ...)`. Each row is an
 * `<atlas-button>` with `name="series" key={seriesId}` so its testid is
 * auto-generated (`{surfaceId}.series.{seriesId}`).
 *
 * When used standalone (outside a card), callers can still set
 * `entries = [{ label, color, id }]` imperatively for a non-interactive
 * flat legend — used by radial charts in `atlas-chart`.
 */
class AtlasChartLegend extends AtlasElement {
  constructor() {
    super();
    this._entries = [];
    this._effectDispose = null;
  }

  static get observedAttributes() { return []; }

  get entries() { return this._entries.slice(); }
  set entries(list) {
    this._entries = Array.isArray(list) ? list.slice() : [];
    this._standalone = true;
    this._renderFlat();
  }

  get _card() {
    return this.closest('atlas-chart-card');
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'list');

    const card = this._card;
    if (card && card.store) {
      this._effectDispose = effect(() => this._renderFromStore(card.store));
    } else if (this._entries.length) {
      this._renderFlat();
    }
  }

  disconnectedCallback() {
    this._effectDispose?.();
    this._effectDispose = null;
    super.disconnectedCallback?.();
  }

  _renderFromStore(store) {
    const data = store.data;
    const hidden = new Set(store.hiddenSeries);
    const entries = [];
    if (data?.series) {
      data.series.forEach((s) => {
        const id = s.id ?? s.name;
        entries.push({ id, label: s.name, color: s.color, hidden: hidden.has(id), interactive: true });
      });
    } else if (data?.slices) {
      data.slices.forEach((s) => {
        entries.push({ id: s.label, label: s.label, color: s.color, hidden: false, interactive: false });
      });
    }
    this._renderEntries(entries);
  }

  _renderFlat() {
    this._renderEntries(
      this._entries.map((e) => ({
        id: e.id ?? e.label,
        label: e.label,
        color: e.color,
        hidden: false,
        interactive: false,
      })),
    );
  }

  _renderEntries(entries) {
    this.textContent = '';
    const store = this._card?.store;

    for (const e of entries) {
      if (e.interactive) {
        const btn = document.createElement('atlas-button');
        btn.setAttribute('variant', 'ghost');
        btn.setAttribute('size', 'sm');
        btn.setAttribute('name', 'series');
        btn.setAttribute('key', String(e.id));
        btn.setAttribute('role', 'listitem');
        btn.setAttribute('aria-pressed', e.hidden ? 'false' : 'true');
        if (e.hidden) btn.dataset.hidden = 'true';
        btn.dataset.seriesId = e.id;
        btn.addEventListener('click', () => {
          store?.commit('toggleSeries', { seriesId: e.id, hidden: !e.hidden });
        });

        const swatch = document.createElement('span');
        swatch.setAttribute('aria-hidden', 'true');
        swatch.dataset.role = 'swatch';
        if (e.color) swatch.style.background = e.color;
        btn.appendChild(swatch);
        btn.appendChild(document.createTextNode(e.label ?? ''));
        this.appendChild(btn);
      } else {
        const row = document.createElement('span');
        row.setAttribute('role', 'listitem');
        row.dataset.role = 'item';
        row.dataset.seriesId = e.id;
        const swatch = document.createElement('span');
        swatch.setAttribute('aria-hidden', 'true');
        swatch.dataset.role = 'swatch';
        if (e.color) swatch.style.background = e.color;
        row.appendChild(swatch);
        row.appendChild(document.createTextNode(e.label ?? ''));
        this.appendChild(row);
      }
    }
  }
}

AtlasElement.define('atlas-chart-legend', AtlasChartLegend);
