/**
 * Page Editor — Playwright coverage.
 *
 * Covers the full-featured editor surface shipped under the "Page Editor"
 * specimen group: shell scaffold, widget palette, schema-driven property
 * panel, undo/redo, multi-select + bulk delete, live preview, and template
 * switcher.
 *
 * Piercing note — the <sandbox-page-editor> shell uses its own shadow
 * DOM, nested inside <atlas-sandbox>'s shadow DOM. The `deep*` helpers in
 * this file walk both so the tests never have to care about the
 * layering.
 */

import { test, expect } from '@playwright/test';

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Load a Page Editor specimen by pageId. Waits for the shell to mount
 * AND for the inner content-page to attach its editor API.
 */
async function openEditor(page, pageId) {
  const specimenId = `page-editor.${pageId}`;
  await page.goto(`/?specimen=${encodeURIComponent(specimenId)}`);
  await page.waitForSelector(
    `atlas-nav-item.item[data-id="${specimenId}"][aria-selected="true"]`,
  );
  await page.waitForFunction((pid) => {
    const deepQuery = (selector) => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        if (!root.querySelector) continue;
        const found = root.querySelector(selector);
        if (found) return found;
        const all = root.querySelectorAll('*');
        for (const el of all) if (el.shadowRoot) stack.push(el.shadowRoot);
      }
      return null;
    };
    const shell = deepQuery('sandbox-page-editor');
    if (!shell) return false;
    const cp = deepQuery(`content-page[data-page-id="${pid}"]`);
    return !!(cp && cp.editor);
  }, pageId);
}

/**
 * Get a handle to the shell element in the live page. Returns a JSHandle.
 */
async function shellHandle(page) {
  return page.evaluateHandle(() => {
    const stack = [document];
    while (stack.length) {
      const root = stack.shift();
      if (!root.querySelector) continue;
      const el = root.querySelector('sandbox-page-editor');
      if (el) return el;
      const all = root.querySelectorAll('*');
      for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
    }
    return null;
  });
}

/**
 * Call the canvas content-page's imperative editor API.
 */
async function runEditorOp(page, pageId, op, args) {
  return page.evaluate(({ pid, op, args }) => {
    const stack = [document];
    while (stack.length) {
      const root = stack.shift();
      if (!root.querySelector) continue;
      const cp = root.querySelector(`content-page[data-page-id="${pid}"]`);
      if (cp && cp.editor) return cp.editor[op](args);
      const all = root.querySelectorAll('*');
      for (const el of all) if (el.shadowRoot) stack.push(el.shadowRoot);
    }
    return { ok: false, reason: 'editor-not-found' };
  }, { pid: pageId, op, args });
}

/**
 * Read `editor.list()` — ordered widget-instance summary.
 */
async function listEditor(page, pageId) {
  return runEditorOp(page, pageId, 'list');
}

/**
 * Read a property from the shell's shadow root.
 */
async function shellShadowQuery(page, selector) {
  return page.evaluate((sel) => {
    const stack = [document];
    while (stack.length) {
      const root = stack.shift();
      if (!root.querySelector) continue;
      const el = root.querySelector('sandbox-page-editor');
      if (el?.shadowRoot) {
        const hit = el.shadowRoot.querySelector(sel);
        if (hit) return { ok: true, text: hit.textContent, html: hit.outerHTML.slice(0, 500) };
      }
      const all = root.querySelectorAll('*');
      for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
    }
    return { ok: false };
  }, selector);
}

/**
 * Click an element inside the shell's shadow root, located by a CSS
 * selector. Uses elementHandle → click so real pointer events fire.
 */
async function clickInShell(page, selector) {
  const handle = await page.evaluateHandle((sel) => {
    const stack = [document];
    while (stack.length) {
      const root = stack.shift();
      if (!root.querySelector) continue;
      const el = root.querySelector('sandbox-page-editor');
      if (el?.shadowRoot) {
        const hit = el.shadowRoot.querySelector(sel);
        if (hit) return hit;
      }
      const all = root.querySelectorAll('*');
      for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
    }
    return null;
  }, selector);
  const el = handle.asElement();
  if (!el) throw new Error(`selector not found in shell shadow: ${selector}`);
  await el.click();
}

/**
 * Click a widget cell by instance id inside the canvas. Cells live in
 * the shell's shadow root (light-DOM children of the inner content-page).
 * Optional modifier: 'shift' | 'meta' | undefined.
 */
async function clickCell(page, instanceId, modifier) {
  const handle = await page.evaluateHandle((id) => {
    const stack = [document];
    while (stack.length) {
      const root = stack.shift();
      if (!root.querySelector) continue;
      const shell = root.querySelector('sandbox-page-editor');
      if (shell?.shadowRoot) {
        const hit = shell.shadowRoot.querySelector(
          `[data-widget-cell][data-instance-id="${id}"]`,
        );
        if (hit) return hit;
      }
      const all = root.querySelectorAll('*');
      for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
    }
    return null;
  }, instanceId);
  const el = handle.asElement();
  if (!el) throw new Error(`cell not found: ${instanceId}`);
  await el.click({ modifiers: modifier ? [modifier] : [] });
}

// ── shell + seed ─────────────────────────────────────────────────────

test.describe('Page Editor — shell + seed', () => {
  test('editor-starter specimen mounts with toolbar, canvas, inspector', async ({ page }) => {
    await openEditor(page, 'editor-starter');

    const toolbar = await shellShadowQuery(page, 'atlas-box[data-role="toolbar"]');
    expect(toolbar.ok).toBe(true);

    const undo = await shellShadowQuery(page, 'atlas-button[name="undo"]');
    expect(undo.ok).toBe(true);
    expect(undo.text).toMatch(/Undo/);

    const redo = await shellShadowQuery(page, 'atlas-button[name="redo"]');
    expect(redo.ok).toBe(true);

    const canvas = await shellShadowQuery(page, 'atlas-box[data-role="canvas"]');
    expect(canvas.ok).toBe(true);

    const inspector = await shellShadowQuery(page, 'page-editor-property-panel');
    expect(inspector.ok).toBe(true);
  });

  test('editor-starter renders four seeded widgets', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const list = await listEditor(page, 'editor-starter');
    expect(Array.isArray(list)).toBe(true);
    const widgetIds = list.map((e) => e.widgetId).sort();
    expect(widgetIds).toEqual(
      ['sandbox.heading', 'sandbox.kpi-tile', 'sandbox.sparkline', 'sandbox.text'].sort(),
    );
  });

  test('editor-blank specimen mounts with zero widgets', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const list = await listEditor(page, 'editor-blank');
    expect(list).toEqual([]);
  });

  test('undo/redo start disabled on a fresh page', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const undoDisabled = await page.evaluate(() => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        const shell = root.querySelector?.('sandbox-page-editor');
        if (shell?.shadowRoot) {
          const btn = shell.shadowRoot.querySelector('atlas-button[name="undo"]');
          if (btn) return btn.hasAttribute('disabled');
        }
        const all = root.querySelectorAll?.('*') ?? [];
        for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return null;
    });
    expect(undoDisabled).toBe(true);
  });

  test('save-status initialises to "saved"', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const status = await shellShadowQuery(page, 'atlas-text[name="save-status"]');
    expect(status.text?.trim()).toBe('saved');
  });
});

// ── palette ──────────────────────────────────────────────────────────

test.describe('Page Editor — palette', () => {
  test('palette lists all five editor widgets as chips', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const expected = [
      'sandbox.heading',
      'sandbox.text',
      'sandbox.kpi-tile',
      'sandbox.sparkline',
      'sandbox.data-table',
    ];
    for (const id of expected) {
      const chip = await shellShadowQuery(
        page,
        `[data-palette-chip][data-widget-id="${id}"]`,
      );
      expect(chip.ok, `palette chip for ${id} should be present`).toBe(true);
    }
  });

  test('adding via editor.add appends the widget to its region', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'main',
      config: { level: 2, text: 'Added from a test' },
    });
    expect(res.ok).toBe(true);
    const list = await listEditor(page, 'editor-blank');
    expect(list.length).toBe(1);
    expect(list[0].widgetId).toBe('sandbox.heading');
    expect(list[0].region).toBe('main');
  });

  test('adding an unknown widgetId returns reason=unknown-widget', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'does.not.exist',
      region: 'main',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unknown-widget');
  });

  test('adding into an invalid region returns reason=region-invalid', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'no-such-region',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('region-invalid');
  });
});

// ── property panel ───────────────────────────────────────────────────

test.describe('Page Editor — property panel', () => {
  test('clicking a widget populates the inspector with its schema', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-heading');

    // Title in the property panel reflects the schema/widget.
    const title = await shellShadowQuery(page, 'atlas-heading[name="inspector-title"]');
    expect(title.ok).toBe(true);
    expect(title.text).toMatch(/Heading/i);

    const subtitle = await shellShadowQuery(page, 'atlas-text[name="inspector-subtitle"]');
    expect(subtitle.ok).toBe(true);
    expect(subtitle.text).toContain('sandbox.heading');
    expect(subtitle.text).toContain('w-editor-starter-main-heading');
  });

  test('editing text field commits via editor.update (debounced)', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-text');

    // Find the content field's atlas-input, reach into its shadow to the <input>.
    const inputHandle = await page.evaluateHandle(() => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        const shell = root.querySelector?.('sandbox-page-editor');
        if (shell?.shadowRoot) {
          const field = shell.shadowRoot.querySelector('atlas-box[name="field-content"] atlas-input');
          if (field?.shadowRoot) return field.shadowRoot.querySelector('input');
        }
        const all = root.querySelectorAll?.('*') ?? [];
        for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return null;
    });
    const inp = inputHandle.asElement();
    expect(inp).not.toBeNull();
    await inp.fill('New copy from a test');

    // Wait for the debounce + commit.
    await expect.poll(async () => {
      const entry = await runEditorOp(page, 'editor-starter', 'get', 'w-editor-starter-main-text');
      return entry?.config?.content;
    }).toBe('New copy from a test');
  });

  test('clicking an enum chip commits the new enum value', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-text');

    // The text widget has a `variant` enum — click the "muted" chip.
    await clickInShell(page, 'atlas-button[name="enum-variant-muted"]');

    await expect.poll(async () => {
      const entry = await runEditorOp(page, 'editor-starter', 'get', 'w-editor-starter-main-text');
      return entry?.config?.variant;
    }).toBe('muted');
  });

  test('clicking an empty region clears the inspector', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-heading');

    // Confirm populated.
    const populated = await shellShadowQuery(page, 'atlas-heading[name="inspector-title"]');
    expect(populated.ok).toBe(true);

    // Click the canvas itself (not any widget) — selection clears.
    await clickInShell(page, 'atlas-box[data-role="canvas"]');

    const afterClear = await shellShadowQuery(page, 'atlas-heading[name="inspector-title"]');
    expect(afterClear.ok).toBe(false);
  });
});

// ── undo / redo ──────────────────────────────────────────────────────

test.describe('Page Editor — undo/redo', () => {
  test('add → undo → redo round-trips', async ({ page }) => {
    await openEditor(page, 'editor-blank');

    const add = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'main',
      config: { level: 2, text: 'round-trip' },
    });
    expect(add.ok).toBe(true);

    await expect.poll(async () => (await listEditor(page, 'editor-blank')).length).toBe(1);

    // Undo.
    await clickInShell(page, 'atlas-button[name="undo"]');
    await expect.poll(async () => (await listEditor(page, 'editor-blank')).length).toBe(0);

    // Redo.
    await clickInShell(page, 'atlas-button[name="redo"]');
    await expect.poll(async () => (await listEditor(page, 'editor-blank')).length).toBe(1);
  });

  test('cmd/ctrl+Z undoes, cmd/ctrl+shift+Z redoes', async ({ page }) => {
    await openEditor(page, 'editor-blank');

    await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'main',
      config: { level: 1, text: 'keyboard' },
    });
    await expect.poll(async () => (await listEditor(page, 'editor-blank')).length).toBe(1);

    // Focus the shell so the keydown lands in composedPath.
    await clickInShell(page, 'atlas-box[data-role="canvas"]');

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await listEditor(page, 'editor-blank')).length).toBe(0);

    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await listEditor(page, 'editor-blank')).length).toBe(1);
  });

  test('undo button becomes enabled after the first edit', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const before = await page.evaluate(() => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        const shell = root.querySelector?.('sandbox-page-editor');
        if (shell?.shadowRoot) {
          const btn = shell.shadowRoot.querySelector('atlas-button[name="undo"]');
          if (btn) return btn.hasAttribute('disabled');
        }
        const all = root.querySelectorAll?.('*') ?? [];
        for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return null;
    });
    expect(before).toBe(true);

    await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'main',
      config: { level: 1, text: 'x' },
    });

    await expect.poll(async () => {
      return page.evaluate(() => {
        const stack = [document];
        while (stack.length) {
          const root = stack.shift();
          const shell = root.querySelector?.('sandbox-page-editor');
          if (shell?.shadowRoot) {
            const btn = shell.shadowRoot.querySelector('atlas-button[name="undo"]');
            if (btn) return btn.hasAttribute('disabled');
          }
          const all = root.querySelectorAll?.('*') ?? [];
          for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
        }
        return null;
      });
    }).toBe(false);
  });
});

// ── multi-select + bulk delete ───────────────────────────────────────

test.describe('Page Editor — multi-select', () => {
  test('shift-click adds to selection; plain click replaces', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-heading');
    await clickCell(page, 'w-editor-starter-main-text', 'Shift');

    // Both cells should carry data-multi-selected="true"
    const both = await page.evaluate(() => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        const shell = root.querySelector?.('sandbox-page-editor');
        if (shell?.shadowRoot) {
          const a = shell.shadowRoot.querySelector(
            '[data-widget-cell][data-instance-id="w-editor-starter-main-heading"]',
          );
          const b = shell.shadowRoot.querySelector(
            '[data-widget-cell][data-instance-id="w-editor-starter-main-text"]',
          );
          if (a && b) {
            return {
              a: a.getAttribute('data-multi-selected'),
              b: b.getAttribute('data-multi-selected'),
            };
          }
        }
        const all = root.querySelectorAll?.('*') ?? [];
        for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return null;
    });
    expect(both).toEqual({ a: 'true', b: 'true' });

    // Plain click on a third cell replaces the set.
    await clickCell(page, 'w-editor-starter-main-kpi');
    const afterPlain = await page.evaluate(() => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        const shell = root.querySelector?.('sandbox-page-editor');
        if (shell?.shadowRoot) {
          const all = shell.shadowRoot.querySelectorAll('[data-widget-cell][data-multi-selected="true"]');
          return all.length;
        }
        const kids = root.querySelectorAll?.('*') ?? [];
        for (const e of kids) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return null;
    });
    expect(afterPlain).toBe(0);
  });

  test('Delete key removes every selected widget', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const before = (await listEditor(page, 'editor-starter')).length;

    await clickCell(page, 'w-editor-starter-main-heading');
    await clickCell(page, 'w-editor-starter-main-text', 'Shift');
    await page.keyboard.press('Delete');

    await expect.poll(async () => (await listEditor(page, 'editor-starter')).length).toBe(before - 2);
  });

  test('Escape clears the current selection', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-heading');
    await clickCell(page, 'w-editor-starter-main-text', 'Shift');

    await page.keyboard.press('Escape');

    const count = await page.evaluate(() => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        const shell = root.querySelector?.('sandbox-page-editor');
        if (shell?.shadowRoot) {
          return shell.shadowRoot.querySelectorAll('[data-widget-cell][data-multi-selected="true"]').length;
        }
        const kids = root.querySelectorAll?.('*') ?? [];
        for (const e of kids) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return null;
    });
    expect(count).toBe(0);
  });
});

// ── live preview ─────────────────────────────────────────────────────

test.describe('Page Editor — live preview', () => {
  test('preview toggle opens and closes the pane', async ({ page }) => {
    await openEditor(page, 'editor-starter');

    const openedBefore = await page.evaluate(() => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        const shell = root.querySelector?.('sandbox-page-editor');
        if (shell) return shell.hasAttribute('preview-open');
        const kids = root.querySelectorAll?.('*') ?? [];
        for (const e of kids) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return null;
    });
    expect(openedBefore).toBe(false);

    await clickInShell(page, 'atlas-button[name="toggle-preview"]');

    await expect.poll(async () => {
      return page.evaluate(() => {
        const stack = [document];
        while (stack.length) {
          const root = stack.shift();
          const shell = root.querySelector?.('sandbox-page-editor');
          if (shell) return shell.hasAttribute('preview-open');
          const kids = root.querySelectorAll?.('*') ?? [];
          for (const e of kids) if (e.shadowRoot) stack.push(e.shadowRoot);
        }
        return null;
      });
    }).toBe(true);

    await clickInShell(page, 'atlas-button[name="toggle-preview"]');
    await expect.poll(async () => {
      return page.evaluate(() => {
        const stack = [document];
        while (stack.length) {
          const root = stack.shift();
          const shell = root.querySelector?.('sandbox-page-editor');
          if (shell) return shell.hasAttribute('preview-open');
          const kids = root.querySelectorAll?.('*') ?? [];
          for (const e of kids) if (e.shadowRoot) stack.push(e.shadowRoot);
        }
        return null;
      });
    }).toBe(false);
  });

  test('preview re-renders after canvas edit commits', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickInShell(page, 'atlas-button[name="toggle-preview"]');
    // Wait for preview content-page to mount
    await page.waitForFunction(() => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        const shell = root.querySelector?.('sandbox-page-editor');
        if (shell?.shadowRoot) {
          const pane = shell.shadowRoot.querySelector('atlas-box[data-role="preview"] content-page');
          if (pane) return true;
        }
        const kids = root.querySelectorAll?.('*') ?? [];
        for (const e of kids) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return false;
    });

    // Commit an edit through the canvas editor.
    const res = await runEditorOp(page, 'editor-starter', 'update', {
      instanceId: 'w-editor-starter-main-heading',
      config: { level: 2, text: 'Mirrored in preview' },
    });
    expect(res.ok).toBe(true);

    // Preview pane's heading reflects the new text.
    await expect.poll(async () => {
      return page.evaluate(() => {
        const stack = [document];
        while (stack.length) {
          const root = stack.shift();
          const shell = root.querySelector?.('sandbox-page-editor');
          if (shell?.shadowRoot) {
            const pane = shell.shadowRoot.querySelector('atlas-box[data-role="preview"]');
            if (pane) return pane.textContent ?? '';
          }
          const kids = root.querySelectorAll?.('*') ?? [];
          for (const e of kids) if (e.shadowRoot) stack.push(e.shadowRoot);
        }
        return '';
      });
    }).toContain('Mirrored in preview');
  });
});

// ── KPI tile placement ───────────────────────────────────────────────

test.describe('Page Editor — KPI tile placement', () => {
  /**
   * Query the rendered <atlas-kpi-tile> DOM for a given instance id,
   * piercing the shell's shadow root. Returns shape info the test can
   * assert on (presence of wrapper, inner tile, label/value/trend nodes).
   */
  async function readKpiTile(page, instanceId) {
    return page.evaluate((id) => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        if (!root.querySelector) continue;
        const shell = root.querySelector('sandbox-page-editor');
        if (shell?.shadowRoot) {
          const cell = shell.shadowRoot.querySelector(
            `[data-widget-cell][data-instance-id="${id}"]`,
          );
          if (cell) {
            const wrapper = cell.querySelector('sandbox-widget-kpi-tile');
            const tile = wrapper?.querySelector('atlas-kpi-tile') ?? null;
            return {
              found: true,
              wrapper: !!wrapper,
              tile: !!tile,
              tileAttrs: tile
                ? {
                    label: tile.getAttribute('label'),
                    value: tile.getAttribute('value'),
                    unit: tile.getAttribute('unit'),
                    trend: tile.getAttribute('trend'),
                    trendLabel: tile.getAttribute('trend-label'),
                    sparkline: tile.getAttribute('sparkline-values'),
                  }
                : null,
              label: tile?.querySelector('[data-role="label"]')?.textContent ?? null,
              value: tile?.querySelector('[data-role="value"]')?.textContent ?? null,
              trendText:
                tile?.querySelector('[data-role="trend"]')?.textContent ?? null,
              trendAttr:
                tile?.querySelector('[data-role="trend"]')?.getAttribute('data-trend') ?? null,
              sparklineChild: !!tile?.querySelector('atlas-sparkline'),
            };
          }
        }
        const all = root.querySelectorAll('*');
        for (const e of all) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return { found: false };
    }, instanceId);
  }

  test('seeded KPI tile renders label, value, trend, and inline sparkline', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const kpi = await readKpiTile(page, 'w-editor-starter-main-kpi');
    expect(kpi.found, 'seeded KPI cell must exist').toBe(true);
    expect(kpi.wrapper, 'sandbox-widget-kpi-tile wrapper must render').toBe(true);
    expect(kpi.tile, 'inner <atlas-kpi-tile> must render').toBe(true);
    expect(kpi.tileAttrs.value).toBe('42');
    expect(kpi.tileAttrs.label).toBe('Active tenants');
    expect(kpi.tileAttrs.trend).toBe('up');
    expect(kpi.label).toBe('Active tenants');
    expect(kpi.value?.trim()).toBe('42');
    expect(kpi.trendAttr).toBe('up');
    expect(kpi.trendText).toContain('+3 this week');
    expect(kpi.sparklineChild, 'sparkline should render when sparklineValues set').toBe(true);
  });

  test('KPI tile added with a full config renders all parts', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.kpi-tile',
      region: 'main',
      instanceId: 'w-kpi-placed-full',
      config: {
        label: 'Placed tile',
        value: '99',
        unit: '%',
        trend: 'down',
        trendLabel: '-1.2% vs. last week',
        sparklineValues: '1,2,3,4,5',
      },
    });
    expect(res.ok).toBe(true);

    await expect.poll(async () => {
      const k = await readKpiTile(page, 'w-kpi-placed-full');
      return k.tile === true;
    }).toBe(true);

    const kpi = await readKpiTile(page, 'w-kpi-placed-full');
    expect(kpi.wrapper).toBe(true);
    expect(kpi.tile).toBe(true);
    expect(kpi.tileAttrs.label).toBe('Placed tile');
    expect(kpi.tileAttrs.value).toBe('99');
    expect(kpi.tileAttrs.unit).toBe('%');
    expect(kpi.tileAttrs.trend).toBe('down');
    expect(kpi.label).toBe('Placed tile');
    expect(kpi.value?.trim()).toBe('99 %');
    expect(kpi.trendAttr).toBe('down');
    expect(kpi.sparklineChild).toBe(true);
  });

  test('KPI tile added via palette chip (empty config) renders a visible value', async ({ page }) => {
    // Mirrors the user flow: click a palette chip → chip is selected →
    // click the empty region slot → editor.add({ widgetId, region, index }).
    // Palette drops pass no config, so the widget must fall back to its
    // schema defaults (value: "0") and still render a populated tile.
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.kpi-tile',
      region: 'main',
      instanceId: 'w-kpi-placed-empty',
    });
    expect(res.ok).toBe(true);

    await expect.poll(async () => {
      const k = await readKpiTile(page, 'w-kpi-placed-empty');
      return k.wrapper === true;
    }).toBe(true);

    const kpi = await readKpiTile(page, 'w-kpi-placed-empty');
    expect(kpi.wrapper, 'wrapper must render').toBe(true);
    expect(kpi.tile, 'inner <atlas-kpi-tile> must render').toBe(true);
    // The bug: placed-with-empty-config tiles render an <atlas-kpi-tile>
    // with no `value` attribute, so the [data-role="value"] div is empty
    // and the tile looks blank. A correctly-placed tile should expose a
    // non-empty value (schema default is "0").
    expect(
      kpi.tileAttrs.value,
      'placed tile should receive schema-default value',
    ).not.toBeNull();
    expect(kpi.value?.trim().length ?? 0).toBeGreaterThan(0);
  });

  test('KPI tile updates re-render the atlas-kpi-tile element', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const before = await readKpiTile(page, 'w-editor-starter-main-kpi');
    expect(before.tileAttrs.value).toBe('42');

    const res = await runEditorOp(page, 'editor-starter', 'update', {
      instanceId: 'w-editor-starter-main-kpi',
      config: {
        label: 'Active tenants',
        value: '57',
        unit: '',
        trend: 'up',
        trendLabel: '+15 this week',
        sparklineValues: '10,20,30,40,50,57',
      },
    });
    expect(res.ok).toBe(true);

    await expect.poll(async () => {
      const k = await readKpiTile(page, 'w-editor-starter-main-kpi');
      return k.tileAttrs?.value ?? null;
    }).toBe('57');

    const after = await readKpiTile(page, 'w-editor-starter-main-kpi');
    expect(after.value?.trim()).toBe('57');
    expect(after.trendText).toContain('+15 this week');
  });
});

// ── template switcher ────────────────────────────────────────────────

test.describe('Page Editor — template switcher', () => {
  test('renders chips for every registered template; current is primary', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const chips = await page.evaluate(() => {
      const stack = [document];
      while (stack.length) {
        const root = stack.shift();
        const shell = root.querySelector?.('sandbox-page-editor');
        if (shell?.shadowRoot) {
          const container = shell.shadowRoot.querySelector('atlas-stack[name="template-switcher"]');
          if (container) {
            return Array.from(container.querySelectorAll('atlas-button')).map((b) => ({
              name: b.getAttribute('name'),
              variant: b.getAttribute('variant'),
              label: (b.textContent ?? '').trim(),
            }));
          }
        }
        const kids = root.querySelectorAll?.('*') ?? [];
        for (const e of kids) if (e.shadowRoot) stack.push(e.shadowRoot);
      }
      return null;
    });
    expect(Array.isArray(chips)).toBe(true);
    expect(chips.length).toBeGreaterThan(0);
    const current = chips.find((c) => c.variant === 'primary');
    expect(current?.name).toBe('template-template.two-column');
  });
});
