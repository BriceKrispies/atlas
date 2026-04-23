import { AtlasElement } from '@atlas/core';

/**
 * <atlas-chart-tooltip> — tiny absolutely-positioned tooltip.
 *
 * Not wired to any specific chart. Consumers call `tooltip.show(x, y, content)`
 * and `tooltip.hide()`. Positioning assumes the tooltip is a sibling of the
 * chart's SVG inside a common relative-positioned wrapper.
 */
class AtlasChartTooltip extends AtlasElement {
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'tooltip');
    this.setAttribute('aria-hidden', 'true');
    this.dataset.visible = 'false';
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string | Node} content
   */
  show(x, y, content) {
    this.style.left = `${x}px`;
    this.style.top = `${y}px`;
    this.style.transform = 'translate(-50%, calc(-100% - 8px))';
    if (typeof content === 'string') this.textContent = content;
    else if (content instanceof Node) {
      this.textContent = '';
      this.appendChild(content);
    }
    this.dataset.visible = 'true';
    this.setAttribute('aria-hidden', 'false');
  }

  hide() {
    this.dataset.visible = 'false';
    this.setAttribute('aria-hidden', 'true');
  }
}

AtlasElement.define('atlas-chart-tooltip', AtlasChartTooltip);
