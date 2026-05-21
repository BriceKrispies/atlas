import type { Compression } from '@atlas/ports';

/**
 * Browser `Compression` adapter — uses the platform-native
 * `CompressionStream('deflate-raw')` available in modern engines
 * (Chrome 80+, Firefox 113+, Safari 16.4+, Node 18+).
 *
 * Streams a single `Uint8Array` through the compressor and concatenates
 * the chunks. For the SAML-sized payloads identity actually compresses
 * (~600 bytes) the streaming overhead is negligible.
 */
export class WebCompression implements Compression {
  async deflateRaw(input: Uint8Array): Promise<Uint8Array> {
    return runStream(input, new CompressionStream('deflate-raw'));
  }
  async inflateRaw(input: Uint8Array): Promise<Uint8Array> {
    return runStream(input, new DecompressionStream('deflate-raw'));
  }
}

// CompressionStream / DecompressionStream are functionally equivalent
// to TransformStream<Uint8Array, Uint8Array> but the lib.dom typings
// expose them as a narrower derived class. Cast at the boundary.
async function runStream(
  input: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const blob = new Blob([input as BlobPart]);
  const piped = blob
    .stream()
    .pipeThrough(transform as unknown as TransformStream<Uint8Array, Uint8Array>);
  const out = await new Response(piped).arrayBuffer();
  return new Uint8Array(out);
}
