/**
 * Failing-first contract tests for `validateRenderTree` — the TypeScript
 * mirror of `crates/wasm_runtime/src/render_tree.rs::validate_render_tree`.
 *
 * Today (red phase) `@atlas/wasm-host` does NOT export `validateRenderTree`
 * or `RenderTreeError`; `execute.ts` only checks size + JSON-validity.
 * These tests drive a port-parity implementation: every invariant V1-V17
 * defined in the Rust source MUST reject the corresponding bad tree, and
 * a handful of canonical-good trees MUST pass.
 *
 * Rust source line references (crates/wasm_runtime/src/render_tree.rs):
 *   V1  — lines 67-75    version must be integer === 1
 *   V2  — lines 77-85    nodes is a non-empty array
 *   V3  — lines 137-144  node.type is a non-empty string
 *   V4  — lines 156-159  type is a known primitive OR starts with "x-"
 *   V5  — lines 275-300  prop values are JSON primitives only
 *   V6  — lines 305-376  required props by node type
 *   V7  — lines 177-185  leaf nodes (text/image/divider) MUST NOT have children
 *   V8  — lines 225-256  nesting rules (block vs inline vs list children)
 *   V9  — lines 205-214  extension nodes MUST carry a `fallback` array
 *   V10 — lines 148-154  extension nodes are not allowed inside fallback
 *   V11 — lines 351-361  link.href scheme ∈ {http,https,mailto}
 *   V12 — lines 334-350  image.src scheme ∈ {http,https}
 *   V13 — lines 10, 118-121   max nesting depth = 64
 *   V14 — lines 11, 124-130   max node count = 10_000
 *   V15 — line 9             max serialized size = 1 MB
 *   V16 — lines 12, 283-291  max prop string value = 100 KB
 *   V17 — lines 318-320      text.content MUST NOT be empty
 *
 * Error API: mirrors the existing `WasmHostError` style — a class with
 * `kind` + `detail`, plus a string `invariant` tag (V1..V17) so tests
 * can assert the precise rule that fired.
 */

import { describe, test, expect } from 'vitest';
// Intentionally unresolvable today — this is the red-phase API target.
// Both symbols MUST be re-exported from `@atlas/wasm-host`'s root.
import {
  validateRenderTree,
  RenderTreeError,
  MAX_SERIALIZED_OUTPUT,
} from '@atlas/wasm-host';

/** Minimal valid leaf used as a child in many fixtures. */
const okText = (content = 'x') => ({
  type: 'text',
  props: { content },
});

/** Wrap a single-node body in a v=1 tree. */
const wrap = (node: unknown) => ({ version: 1, nodes: [node] });

/** Helper: assert that validate throws RenderTreeError tagged with `invariant`. */
function expectInvariant(input: unknown, invariant: string): void {
  let caught: unknown;
  try {
    validateRenderTree(input);
  } catch (e) {
    caught = e;
  }
  expect(caught, `expected ${invariant} rejection but call succeeded`).toBeInstanceOf(
    RenderTreeError,
  );
  expect((caught as RenderTreeError).invariant).toBe(invariant);
}

describe('validateRenderTree (V1-V17)', () => {
  // ─── Positive baselines ────────────────────────────────────────────

  test('positive: minimal valid heading + paragraph passes', () => {
    const tree = {
      version: 1,
      nodes: [
        {
          type: 'heading',
          props: { level: 1 },
          children: [okText('Hello')],
        },
        {
          type: 'paragraph',
          children: [okText('World')],
        },
      ],
    };
    expect(() => validateRenderTree(tree)).not.toThrow();
  });

  test('positive: valid extension with fallback passes', () => {
    const tree = {
      version: 1,
      nodes: [
        {
          type: 'x-callout',
          props: { level: 'warning' },
          children: [{ type: 'paragraph', children: [okText('Watch out!')] }],
          fallback: [{ type: 'paragraph', children: [okText('Watch out!')] }],
        },
      ],
    };
    expect(() => validateRenderTree(tree)).not.toThrow();
  });

  test('positive: list with list_item children + mailto link passes', () => {
    const tree = {
      version: 1,
      nodes: [
        {
          type: 'list',
          props: { ordered: false },
          children: [
            {
              type: 'list_item',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    {
                      type: 'link',
                      props: { href: 'mailto:user@example.com' },
                      children: [okText('email')],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => validateRenderTree(tree)).not.toThrow();
  });

  // ─── V1: version ───────────────────────────────────────────────────

  test('V1: rejects unsupported version', () => {
    expectInvariant(
      { version: 2, nodes: [{ type: 'paragraph', children: [okText()] }] },
      'V1',
    );
  });

  test('V1: rejects missing version', () => {
    expectInvariant(
      { nodes: [{ type: 'paragraph', children: [okText()] }] },
      'V1',
    );
  });

  // ─── V2: nodes array ───────────────────────────────────────────────

  test('V2: rejects empty nodes array', () => {
    expectInvariant({ version: 1, nodes: [] }, 'V2');
  });

  test('V2: rejects missing nodes field', () => {
    expectInvariant({ version: 1 }, 'V2');
  });

  // ─── V3: node.type required string ─────────────────────────────────

  test('V3: rejects node missing type', () => {
    expectInvariant({ version: 1, nodes: [{ props: {} }] }, 'V3');
  });

  test('V3: rejects empty-string node type', () => {
    expectInvariant({ version: 1, nodes: [{ type: '' }] }, 'V3');
  });

  // ─── V4: type is known primitive or x- ─────────────────────────────

  test('V4: rejects unknown node type "div"', () => {
    expectInvariant({ version: 1, nodes: [{ type: 'div' }] }, 'V4');
  });

  // ─── V5: prop values are primitives only ───────────────────────────

  test('V5: rejects nested object in props', () => {
    expectInvariant(
      wrap({
        type: 'heading',
        props: { level: 1, style: { color: 'red' } },
        children: [okText()],
      }),
      'V5',
    );
  });

  test('V5: rejects array in props', () => {
    expectInvariant(
      wrap({
        type: 'heading',
        props: { level: 1, classes: ['a', 'b'] },
        children: [okText()],
      }),
      'V5',
    );
  });

  // ─── V6: required props per node type ──────────────────────────────

  test('V6: rejects heading.level out of 1-6 range', () => {
    expectInvariant(
      wrap({
        type: 'heading',
        props: { level: 7 },
        children: [okText()],
      }),
      'V6',
    );
  });

  test('V6: rejects image missing required src', () => {
    expectInvariant(wrap({ type: 'image', props: { alt: 'x' } }), 'V6');
  });

  test('V6: rejects list missing required `ordered` boolean', () => {
    expectInvariant(
      wrap({
        type: 'list',
        children: [{ type: 'list_item', children: [okText()] }],
      }),
      'V6',
    );
  });

  // ─── V7: leaf nodes have no children ───────────────────────────────

  test('V7: rejects text node with children (leaf)', () => {
    expectInvariant(
      wrap({
        type: 'paragraph',
        children: [
          {
            type: 'text',
            props: { content: 'hello' },
            children: [okText('bad')],
          },
        ],
      }),
      'V7',
    );
  });

  // ─── V8: nesting rules ─────────────────────────────────────────────

  test('V8: rejects block node nested inside inline context', () => {
    expectInvariant(
      wrap({
        type: 'paragraph',
        children: [
          {
            type: 'strong',
            children: [
              {
                type: 'heading',
                props: { level: 1 },
                children: [okText('bad')],
              },
            ],
          },
        ],
      }),
      'V8',
    );
  });

  test('V8: rejects non-list_item child of list', () => {
    expectInvariant(
      wrap({
        type: 'list',
        props: { ordered: true },
        children: [{ type: 'paragraph', children: [okText('bad')] }],
      }),
      'V8',
    );
  });

  // ─── V9: extension requires fallback ───────────────────────────────

  test('V9: rejects extension node missing fallback', () => {
    expectInvariant(
      wrap({
        type: 'x-widget',
        children: [{ type: 'paragraph', children: [okText()] }],
      }),
      'V9',
    );
  });

  // ─── V10: extension forbidden inside fallback ──────────────────────

  test('V10: rejects extension node inside another fallback', () => {
    expectInvariant(
      wrap({
        type: 'x-widget',
        children: [{ type: 'paragraph', children: [okText()] }],
        fallback: [
          {
            type: 'x-inner',
            children: [{ type: 'paragraph', children: [okText()] }],
            fallback: [{ type: 'paragraph', children: [okText()] }],
          },
        ],
      }),
      'V10',
    );
  });

  // ─── V11: link.href scheme ─────────────────────────────────────────

  test('V11: rejects javascript: href on link', () => {
    expectInvariant(
      wrap({
        type: 'paragraph',
        children: [
          {
            type: 'link',
            props: { href: 'javascript:alert(1)' },
            children: [okText('click')],
          },
        ],
      }),
      'V11',
    );
  });

  // ─── V12: image.src scheme ─────────────────────────────────────────

  test('V12: rejects data: URI image src', () => {
    expectInvariant(
      wrap({
        type: 'image',
        props: { src: 'data:image/png;base64,abc', alt: 'img' },
      }),
      'V12',
    );
  });

  // ─── V13: depth ≤ 64 ───────────────────────────────────────────────

  test('V13: rejects tree exceeding max depth (64)', () => {
    // Build a 70-deep chain of nested blockquote→…→paragraph→text.
    // blockquote child context is Block, so blockquote-in-blockquote is legal
    // until we hit the depth cap.
    let inner: Record<string, unknown> = {
      type: 'paragraph',
      children: [okText('deep')],
    };
    for (let i = 0; i < 70; i++) {
      inner = { type: 'blockquote', children: [inner] };
    }
    expectInvariant({ version: 1, nodes: [inner] }, 'V13');
  });

  // ─── V14: node count ≤ 10_000 ──────────────────────────────────────

  test('V14: rejects tree exceeding max node count (10_000)', () => {
    // 10_001 sibling paragraphs — still legal nesting, just too many.
    const nodes: unknown[] = [];
    for (let i = 0; i < 10_001; i++) {
      nodes.push({ type: 'paragraph', children: [okText(String(i))] });
    }
    expectInvariant({ version: 1, nodes }, 'V14');
  });

  // ─── V15: serialized size ≤ 1 MB ───────────────────────────────────

  test('V15: rejects render tree whose serialized JSON exceeds 1 MB', () => {
    // Many small text nodes summing to > 1 MB after JSON.stringify.
    // Each text node is ~70 bytes serialized; 20_000 nodes ≈ 1.4 MB.
    // (Will also blow V14, but V15 is the size-side guarantee mirroring
    // MAX_SERIALIZED_SIZE; the validator is expected to short-circuit on
    // size before walking node count when input is given as a string,
    // OR fire size last. Either way, this stresses the 1 MB cap.)
    const big = 'a'.repeat(MAX_SERIALIZED_OUTPUT + 1024);
    expectInvariant(
      wrap({ type: 'paragraph', children: [okText(big)] }),
      'V15',
    );
  });

  // ─── V16: prop string value ≤ 100 KB ───────────────────────────────

  test('V16: rejects single prop string value exceeding 100 KB', () => {
    // 100 KB + 1 byte. Smaller than V15 cap so V15 doesn't fire first.
    const big = 'a'.repeat(100 * 1024 + 1);
    expectInvariant(
      wrap({
        type: 'paragraph',
        children: [okText(big)],
      }),
      'V16',
    );
  });

  // ─── V17: text.content non-empty ───────────────────────────────────

  test('V17: rejects empty text.content', () => {
    expectInvariant(
      wrap({
        type: 'paragraph',
        children: [{ type: 'text', props: { content: '' } }],
      }),
      'V17',
    );
  });
});
