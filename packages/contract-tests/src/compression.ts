import { describe, test, expect, beforeEach } from 'vitest';
import type { Compression } from '@atlas/ports';

const utf8 = new TextEncoder();

/**
 * Contract any `Compression` adapter must satisfy. Both
 * `NodeCompression` (`@atlas/adapter-node`) and `WebCompression`
 * (`@atlas/adapter-idb`) run this suite.
 *
 * SAML's HTTP-Redirect binding is the canonical consumer; vectors below
 * mirror the round-trip the AuthnRequest builder needs.
 */
export function compressionContract(
  makeCompression: () => Promise<Compression>,
): void {
  describe('Compression contract', () => {
    let c: Compression;

    beforeEach(async () => {
      c = await makeCompression();
    });

    test('deflateRaw → inflateRaw round-trips ASCII payloads', async () => {
      const input = utf8.encode('hello world');
      const out = await c.inflateRaw(await c.deflateRaw(input));
      expect(out).toEqual(input);
    });

    test('deflateRaw → inflateRaw round-trips XML-shaped payloads', async () => {
      const input = utf8.encode(
        '<?xml version="1.0"?><AuthnRequest ID="_abc" Version="2.0"/>',
      );
      const out = await c.inflateRaw(await c.deflateRaw(input));
      expect(out).toEqual(input);
    });

    test('deflateRaw produces a smaller output than the input for redundant payloads', async () => {
      const input = utf8.encode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      const compressed = await c.deflateRaw(input);
      expect(compressed.length).toBeLessThan(input.length);
    });

    test('round-trips an empty payload', async () => {
      const input = new Uint8Array(0);
      const out = await c.inflateRaw(await c.deflateRaw(input));
      expect(out).toEqual(input);
    });

    test('inflateRaw rejects non-deflate input', async () => {
      // 0xff bytes are not a valid raw-deflate stream.
      const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
      await expect(c.inflateRaw(garbage)).rejects.toBeDefined();
    });
  });
}
