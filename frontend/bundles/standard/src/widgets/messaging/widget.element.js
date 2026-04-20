/**
 * MessagingWidget — stub. Real implementation pending.
 */

import { AtlasSurface, html } from '@atlas/core';

export class MessagingWidget extends AtlasSurface {
  static surfaceId = 'widget.comms.messaging';
  static empty = null;

  onMount() {
    this.setState('success');
  }

  render() {
    return html`
      <atlas-box padding="md">
        <atlas-text name="stub-label" variant="muted">Messaging not implemented yet (stub).</atlas-text>
      </atlas-box>
    `;
  }
}

AtlasSurface.define('widget-messaging', MessagingWidget);
