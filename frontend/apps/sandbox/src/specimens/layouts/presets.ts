import { S } from '../_register.ts';
import { sandboxLayoutRegistry } from '../_shared.ts';
import { presetLayouts, type LayoutDocument } from '@atlas/page-templates';

// ── Layouts ─────────────────────────────────────────────────────
//
// Data-driven layouts rendered via <atlas-layout>. Each specimen mounts a
// preset layout document and labels each slot inline so you can see the
// grid placement (col/row + span). This is the Phase 1 runtime proof:
// no bespoke template class, no CSS file — just a JSON layout document
// and an <atlas-layout> element that positions sections on a grid.

function mountLayoutPreview(
  demoEl: HTMLElement,
  ctx: { config: Record<string, unknown> },
): () => void {
  const { config } = ctx;
  const layoutId = (config as { layoutId?: string }).layoutId;
  const layoutDoc = layoutId ? sandboxLayoutRegistry.get(layoutId) as LayoutDocument : null;
  const el = document.createElement('atlas-layout') as HTMLElement & { layout: unknown };
  el.layout = layoutDoc;
  demoEl.appendChild(el);
  // Label each section so the slot grid is visible at a glance. These
  // labels live INSIDE the section so they scroll with its overflow; the
  // section itself keeps its fixed footprint regardless.
  if (layoutDoc) {
    for (const slot of layoutDoc.slots) {
      const sec = el.querySelector(`:scope > section[data-slot="${slot.name}"]`);
      if (!sec) continue;
      sec.innerHTML = `
        <atlas-stack gap="xs" padding="md" style="height:100%;justify-content:center;align-items:center;text-align:center">
          <atlas-text variant="medium">${slot.name}</atlas-text>
          <atlas-text variant="muted">
            col ${slot.col} · row ${slot.row} · span ${slot.colSpan}×${slot.rowSpan}
          </atlas-text>
        </atlas-stack>
      `;
    }
  }
  return () => {
    try { el.remove(); } catch { /* already detached */ }
  };
}

for (const layout of presetLayouts as LayoutDocument[]) {
  const shortName = layout.displayName ?? layout.layoutId;
  S({
    id: `layout.${layout.layoutId}`,
    name: shortName,
    tag: 'atlas-layout',
    mount: mountLayoutPreview,
    configVariants: [
      { name: 'Preview', config: { layoutId: layout.layoutId } },
    ],
  });
}
