import { S } from '../_register.ts';
import type { MediaItem } from '@atlas/design';

S({
  id: 'color-picker',
  name: 'ColorPicker',
  tag: 'atlas-color-picker',
  variants: [
    {
      name: 'Default (hex output)',
      html: `<atlas-color-picker label="Brand colour" value="#0f62fe"></atlas-color-picker>`,
    },
    {
      name: 'With preset swatches',
      html: `
        <atlas-color-picker
          label="Accent"
          value="#36b37e"
          swatches="#0f62fe,#36b37e,#ff5630,#ffab00,#6554c0,#172b4d,#ffffff,#000000"
        ></atlas-color-picker>
      `,
    },
    {
      name: 'With alpha channel',
      html: `<atlas-color-picker label="Overlay" value="#0f62fe" alpha></atlas-color-picker>`,
    },
    {
      name: 'HSL output mode',
      html: `<atlas-color-picker label="Theme primary" value="#7c3aed" format="hsl"></atlas-color-picker>`,
    },
  ],
});

// ── Mock catalogue used by every media-picker specimen variant. ────────
// Keep it self-contained: data-uri SVG placeholders mean the specimen
// never reaches out to a network and renders deterministically in CI.

function svgDataUri(label: string, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">` +
    `<rect width="200" height="200" fill="hsl(${hue}, 60%, 78%)"/>` +
    `<rect x="0" y="140" width="200" height="60" fill="hsl(${hue}, 60%, 64%)"/>` +
    `<circle cx="60" cy="80" r="28" fill="hsl(${hue}, 60%, 88%)"/>` +
    `<text x="100" y="178" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#1a1a1a">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const MOCK_ITEMS: MediaItem[] = [
  { id: 'm1',  kind: 'image', name: 'Hero — sunrise',     src: svgDataUri('Sunrise', 30) },
  { id: 'm2',  kind: 'image', name: 'Logo mark',          src: svgDataUri('Logo', 215) },
  { id: 'm3',  kind: 'image', name: 'Team retreat',       src: svgDataUri('Retreat', 145) },
  { id: 'm4',  kind: 'image', name: 'Office floorplan',   src: svgDataUri('Floorplan', 280) },
  { id: 'm5',  kind: 'image', name: 'Product shot 01',    src: svgDataUri('Product 1', 0) },
  { id: 'm6',  kind: 'image', name: 'Product shot 02',    src: svgDataUri('Product 2', 60) },
  { id: 'm7',  kind: 'image', name: 'Cover photo',        src: svgDataUri('Cover', 340) },
  { id: 'm8',  kind: 'image', name: 'Avatar — Alice',     src: svgDataUri('Alice', 200) },
  { id: 'm9',  kind: 'video', name: 'Onboarding clip',    src: svgDataUri('Video', 240), duration: '1:24' },
  { id: 'm10', kind: 'video', name: 'Field interview',    src: svgDataUri('Interview', 100), duration: '4:08' },
  { id: 'm11', kind: 'doc',   name: 'Brand guide.pdf',    src: svgDataUri('PDF', 30) },
  { id: 'm12', kind: 'doc',   name: 'Whitepaper.docx',    src: svgDataUri('DOC', 120) },
];

interface MediaPickerHost extends HTMLElement {
  setItems(items: readonly MediaItem[]): void;
}

S({
  id: 'media-picker',
  name: 'MediaPicker',
  tag: 'atlas-media-picker',
  mount: (demoEl, { onLog }) => {
    // Three side-by-side specimens: image-only, multiple, search demo.
    const grid = document.createElement('atlas-stack');
    grid.setAttribute('gap', 'lg');

    function makeRow(title: string, picker: HTMLElement): HTMLElement {
      const wrap = document.createElement('atlas-stack');
      wrap.setAttribute('gap', 'sm');
      const heading = document.createElement('atlas-label');
      heading.textContent = title;
      wrap.appendChild(heading);
      wrap.appendChild(picker);
      return wrap;
    }

    function wirePicker(p: MediaPickerHost, label: string): void {
      // Catalogue is host-supplied. Echo every catalogue refresh request
      // to the log so the contract is visible in the specimen UI.
      p.addEventListener('request-items', (ev) => {
        const detail = (ev as CustomEvent).detail;
        onLog(`${label}.request-items`, detail);
        // Always serve the same mock catalogue — filter logic lives in
        // the picker. A real host would issue a backend fetch keyed on
        // detail.query / detail.type / detail.page.
        p.setItems(MOCK_ITEMS);
      });
      p.addEventListener('change', (ev) => {
        const detail = (ev as CustomEvent).detail;
        onLog(`${label}.change`, detail);
      });
      // Seed the catalogue immediately so the trigger preview strip can
      // resolve any pre-set ids without waiting for the panel to open.
      p.setItems(MOCK_ITEMS);
    }

    // 1) Image-only single select
    const single = document.createElement('atlas-media-picker') as MediaPickerHost;
    single.setAttribute('label', 'Featured image');
    single.setAttribute('media-type', 'image');
    single.setAttribute('value', 'm1');
    wirePicker(single, 'single');

    // 2) Multi-select
    const multi = document.createElement('atlas-media-picker') as MediaPickerHost;
    multi.setAttribute('label', 'Gallery items');
    multi.setAttribute('media-type', 'any');
    multi.setAttribute('multiple', '');
    multi.setAttribute('value', 'm3,m6,m8');
    wirePicker(multi, 'multi');

    // 3) Search demo (any type, no preselected value).
    const search = document.createElement('atlas-media-picker') as MediaPickerHost;
    search.setAttribute('label', 'Find in library');
    search.setAttribute('media-type', 'any');
    wirePicker(search, 'search');

    grid.appendChild(makeRow('Image-only (single)', single));
    grid.appendChild(makeRow('Multiple', multi));
    grid.appendChild(makeRow('Search filter demo', search));

    demoEl.appendChild(grid);

    return () => {
      grid.remove();
    };
  },
  configVariants: [{ name: 'default', config: {} }],
});
