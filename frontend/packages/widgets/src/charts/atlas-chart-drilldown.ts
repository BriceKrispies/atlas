import { AtlasElement, effect, type EffectCleanup } from '@atlas/core';
import type { AtlasChartCard } from './atlas-chart-card.ts';
import type { ChartStateStore } from './chart-state.ts';

/**
 * <atlas-chart-drilldown> — breadcrumb display of the active drill path.
 *
 * Reads `store.drilldownStack`. Each crumb is an `<atlas-button>` with
 * `name="crumb" key={depth}`. Clicking commits `popDrilldown` to that
 * depth. The first crumb ("Top") pops to depth 0.
 */
class AtlasChartDrilldown extends AtlasElement {
  _effectDispose: EffectCleanup | null = null;

  get _card(): AtlasChartCard | null {
    return this.closest('atlas-chart-card') as AtlasChartCard | null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'navigation');
    const card = this._card;
    if (card?.store) {
      this._effectDispose = effect(() => this._render(card.store));
    } else {
      this._render(null);
    }
  }

  override disconnectedCallback(): void {
    this._effectDispose?.();
    this._effectDispose = null;
    super.disconnectedCallback?.();
  }

  _render(store: ChartStateStore | null): void {
    this.textContent = '';
    const stack = store?.drilldownStack ?? [];

    const crumbs: Array<{ label: string; depth: number }> = [{ label: 'Top', depth: 0 }];
    stack.forEach((frame, i) => {
      crumbs.push({ label: frame.label ?? String(frame.value ?? frame.level), depth: i + 1 });
    });

    crumbs.forEach((crumb, idx) => {
      const isLast = idx === crumbs.length - 1;
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = ' / ';
        this.appendChild(sep);
      }
      if (isLast) {
        const span = document.createElement('span');
        span.textContent = crumb.label;
        span.setAttribute('aria-current', 'true');
        this.appendChild(span);
      } else {
        const btn = document.createElement('atlas-button');
        btn.setAttribute('variant', 'ghost');
        btn.setAttribute('size', 'sm');
        btn.setAttribute('name', 'crumb');
        btn.setAttribute('key', String(crumb.depth));
        btn.textContent = crumb.label;
        btn.addEventListener('click', () => {
          store?.commit('popDrilldown', { toDepth: crumb.depth });
        });
        this.appendChild(btn);
      }
    });
  }
}

AtlasElement.define('atlas-chart-drilldown', AtlasChartDrilldown);
