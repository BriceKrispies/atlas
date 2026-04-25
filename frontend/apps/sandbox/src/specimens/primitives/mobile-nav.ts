import { S } from '../_register.ts';

/**
 * Mobile nav chrome — top app-bar + thumb-reach bottom-nav.
 * Companion specimens to navigation.ts (which covers <atlas-nav>,
 * <atlas-tabs>, <atlas-tab-bar>, segmented controls, accordions).
 */

S({
  id: 'app-bar',
  name: 'App Bar',
  tag: 'atlas-app-bar',
  variants: [
    {
      name: 'Title only (default)',
      html: `
        <atlas-app-bar name="topbar">
          <atlas-heading level="3">Inbox</atlas-heading>
        </atlas-app-bar>
      `,
    },
    {
      name: 'Leading + trailing actions',
      html: `
        <atlas-app-bar name="topbar">
          <atlas-button slot="leading" variant="ghost" size="sm" name="back" aria-label="Back">
            ←
          </atlas-button>
          <atlas-heading level="3">Page settings</atlas-heading>
          <atlas-stack slot="trailing" direction="row" gap="xs">
            <atlas-button variant="ghost" size="sm" name="search" aria-label="Search">
              ⌕
            </atlas-button>
            <atlas-button variant="ghost" size="sm" name="more" aria-label="More options">
              ⋯
            </atlas-button>
          </atlas-stack>
        </atlas-app-bar>
      `,
    },
    {
      name: 'variant="shell" (dark chrome)',
      html: `
        <atlas-app-bar name="topbar" variant="shell">
          <atlas-button slot="leading" variant="ghost" size="sm" name="menu" aria-label="Open menu">
            ☰
          </atlas-button>
          <atlas-heading level="3">Atlas Admin</atlas-heading>
          <atlas-button slot="trailing" variant="ghost" size="sm" name="profile" aria-label="Profile">
            ◉
          </atlas-button>
        </atlas-app-bar>
      `,
    },
    {
      name: 'scroll-behavior="elevate"',
      html: `
        <atlas-box style="height:240px;overflow:auto;border:1px solid var(--atlas-color-border);border-radius:var(--atlas-radius-md)" data-app-bar-scroll>
          <atlas-app-bar name="topbar" scroll-behavior="elevate">
            <atlas-heading level="3">Scrollable region</atlas-heading>
          </atlas-app-bar>
          <atlas-box padding="lg">
            <atlas-stack gap="md">
              <atlas-text>Scroll the inner box. The bar acquires a shadow once the content has scrolled past 4px.</atlas-text>
              <atlas-text>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</atlas-text>
              <atlas-text>Curabitur tristique, urna in tristique consequat.</atlas-text>
              <atlas-text>Vestibulum ante ipsum primis in faucibus orci luctus.</atlas-text>
              <atlas-text>Praesent commodo cursus magna, vel scelerisque nisl.</atlas-text>
              <atlas-text>Aenean lacinia bibendum nulla sed consectetur.</atlas-text>
              <atlas-text>Donec id elit non mi porta gravida at eget metus.</atlas-text>
              <atlas-text>Etiam porta sem malesuada magna mollis euismod.</atlas-text>
            </atlas-stack>
          </atlas-box>
        </atlas-box>
      `,
    },
    {
      name: 'scroll-behavior="collapse"',
      html: `
        <atlas-box style="height:240px;overflow:auto;border:1px solid var(--atlas-color-border);border-radius:var(--atlas-radius-md)" data-app-bar-scroll>
          <atlas-app-bar name="topbar" scroll-behavior="collapse">
            <atlas-heading level="3">Hides on scroll-down</atlas-heading>
          </atlas-app-bar>
          <atlas-box padding="lg">
            <atlas-stack gap="md">
              <atlas-text>Scroll down — the bar slides out. Scroll up — it returns.</atlas-text>
              <atlas-text>Filler 1.</atlas-text>
              <atlas-text>Filler 2.</atlas-text>
              <atlas-text>Filler 3.</atlas-text>
              <atlas-text>Filler 4.</atlas-text>
              <atlas-text>Filler 5.</atlas-text>
              <atlas-text>Filler 6.</atlas-text>
              <atlas-text>Filler 7.</atlas-text>
              <atlas-text>Filler 8.</atlas-text>
            </atlas-stack>
          </atlas-box>
        </atlas-box>
      `,
    },
  ],
});

S({
  id: 'bottom-nav',
  name: 'Bottom Nav',
  tag: 'atlas-bottom-nav',
  mount: (demoEl, { onLog }) => {
    function makeItem(value: string, label: string, glyph: string, badge?: string): HTMLElement {
      const item = document.createElement('atlas-bottom-nav-item');
      item.setAttribute('value', value);
      item.setAttribute('label', label);
      if (badge) item.setAttribute('badge-count', badge);
      const icon = document.createElement('span');
      icon.setAttribute('slot', 'icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = glyph;
      item.appendChild(icon);
      return item;
    }

    function makeBar(items: HTMLElement[], value: string, attrs: Record<string, string> = {}): HTMLElement {
      const bar = document.createElement('atlas-bottom-nav');
      bar.setAttribute('name', 'primary');
      bar.setAttribute('aria-label', 'Primary');
      bar.setAttribute('value', value);
      for (const [k, v] of Object.entries(attrs)) bar.setAttribute(k, v);
      items.forEach((it) => bar.appendChild(it));
      bar.addEventListener('change', (ev) => {
        const detail = (ev as CustomEvent).detail;
        onLog('change', detail);
      });
      return bar;
    }

    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'lg');

    // 3 items
    const sec3 = document.createElement('atlas-stack');
    sec3.setAttribute('gap', 'xs');
    const lbl3 = document.createElement('atlas-label');
    lbl3.textContent = '3 items';
    sec3.appendChild(lbl3);
    sec3.appendChild(
      makeBar(
        [
          makeItem('home', 'Home', '⌂'),
          makeItem('search', 'Search', '⌕'),
          makeItem('me', 'Me', '◉'),
        ],
        'home',
      ),
    );

    // 4 items, with one badge
    const sec4 = document.createElement('atlas-stack');
    sec4.setAttribute('gap', 'xs');
    const lbl4 = document.createElement('atlas-label');
    lbl4.textContent = '4 items + badge';
    sec4.appendChild(lbl4);
    sec4.appendChild(
      makeBar(
        [
          makeItem('home', 'Home', '⌂'),
          makeItem('inbox', 'Inbox', '✉', '3'),
          makeItem('library', 'Library', '☰'),
          makeItem('me', 'Me', '◉'),
        ],
        'inbox',
      ),
    );

    // 5 items, capped badge
    const sec5 = document.createElement('atlas-stack');
    sec5.setAttribute('gap', 'xs');
    const lbl5 = document.createElement('atlas-label');
    lbl5.textContent = '5 items + capped badge (>99)';
    sec5.appendChild(lbl5);
    sec5.appendChild(
      makeBar(
        [
          makeItem('home', 'Home', '⌂'),
          makeItem('search', 'Search', '⌕'),
          makeItem('add', 'New', '＋'),
          makeItem('inbox', 'Inbox', '✉', '128'),
          makeItem('me', 'Me', '◉'),
        ],
        'home',
      ),
    );

    // hide-above="md" demo
    const secHide = document.createElement('atlas-stack');
    secHide.setAttribute('gap', 'xs');
    const lblH = document.createElement('atlas-label');
    lblH.textContent = 'hide-above="md" — vanishes ≥900px';
    secHide.appendChild(lblH);
    secHide.appendChild(
      makeBar(
        [
          makeItem('home', 'Home', '⌂'),
          makeItem('inbox', 'Inbox', '✉'),
          makeItem('me', 'Me', '◉'),
        ],
        'home',
        { 'hide-above': 'md' },
      ),
    );

    // Auto-cycle demo — programmatic value changes prove the controlled
    // model works without a click. Stops on unmount.
    const secAuto = document.createElement('atlas-stack');
    secAuto.setAttribute('gap', 'xs');
    const lblA = document.createElement('atlas-label');
    lblA.textContent = 'Programmatic cycle (every 1.5s)';
    secAuto.appendChild(lblA);
    const autoBar = makeBar(
      [
        makeItem('a', 'Alpha', 'α'),
        makeItem('b', 'Bravo', 'β'),
        makeItem('c', 'Charlie', 'γ'),
        makeItem('d', 'Delta', 'δ'),
      ],
      'a',
    );
    secAuto.appendChild(autoBar);
    const order = ['a', 'b', 'c', 'd'];
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % order.length;
      autoBar.setAttribute('value', order[i]!);
      onLog('cycled', { value: order[i] });
    }, 1500);

    stack.append(sec3, sec4, sec5, secHide, secAuto);
    demoEl.appendChild(stack);

    return () => {
      clearInterval(timer);
      stack.remove();
    };
  },
  configVariants: [{ name: 'default', config: {} }],
});
