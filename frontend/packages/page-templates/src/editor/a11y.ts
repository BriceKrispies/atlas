/**
 * a11y.ts — tiny aria-live announcer helper used by the editor.
 *
 * createAnnouncer(host) attaches a <div role="status" aria-live="polite"
 * name="editor-announcer"> inside `host` and returns:
 *   - announce(message): sets textContent to the message.
 *   - clear(): empties the announcer.
 *   - element: the raw <div> (so callers can query/test it).
 *
 * The announcer lives in the content-page's own DOM (SR-friendly) and is
 * visually hidden via CSS. No throttling — the SR queue handles cadence.
 */

export interface Announcer {
  element: HTMLElement;
  announce(message: string): void;
  clear(): void;
}

export function createAnnouncer(host: HTMLElement): Announcer {
  const el = host.ownerDocument
    ? host.ownerDocument.createElement('div')
    : document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.setAttribute('name', 'editor-announcer');
  el.setAttribute('data-editor-announcer', '');
  // Visually-hidden but still announced. Inline so the CSS is guaranteed
  // present even if editor.css failed to load.
  el.setAttribute(
    'style',
    'position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;',
  );
  host.appendChild(el);
  return {
    element: el,
    announce(message: string): void {
      // Re-set textContent even if equal — some SRs re-announce on DOM mutation.
      el.textContent = '';
      el.textContent = String(message ?? '');
    },
    clear(): void {
      el.textContent = '';
    },
  };
}
