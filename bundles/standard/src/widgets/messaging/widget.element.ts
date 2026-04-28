/**
 * MessagingWidget — stub. Real implementation pending.
 */

import { AtlasSurface, html } from '@atlas/core';

export class MessagingWidget extends AtlasSurface {
  static override surfaceId = 'widget.comms.messaging';
  static override empty = null;

  override onMount(): void {
    this.setState('success');
  }

  override render(): DocumentFragment {
    return html`
      <atlas-box padding="md">
        <atlas-text name="stub-label" variant="muted">Messaging not implemented yet (stub).</atlas-text>
      </atlas-box>
    `;
  }
}

AtlasSurface.define('widget-messaging', MessagingWidget);
