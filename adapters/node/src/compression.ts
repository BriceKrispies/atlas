import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { Compression } from '@atlas/ports';

/**
 * Node `Compression` adapter — wraps `node:zlib`'s sync API in promises.
 * The sync calls are CPU-bound and fast for the small payloads we
 * actually compress (SAML AuthnRequest XML is ~600 bytes), so the
 * promise wrapping is just contract conformance, not a perf optimisation.
 */
export class NodeCompression implements Compression {
  async deflateRaw(input: Uint8Array): Promise<Uint8Array> {
    return toPlainUint8Array(deflateRawSync(input));
  }
  async inflateRaw(input: Uint8Array): Promise<Uint8Array> {
    return toPlainUint8Array(inflateRawSync(input));
  }
}

// `node:zlib` returns Node `Buffer`, which subclasses Uint8Array but
// fails `toEqual` against a plain Uint8Array. Strip the Buffer prototype
// so contract assertions and the browser-adapter outputs are byte-for-
// byte interchangeable.
function toPlainUint8Array(buf: Buffer): Uint8Array {
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}
