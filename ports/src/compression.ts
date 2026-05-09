/**
 * Compression — symmetric byte-level compression primitives.
 *
 * Today's only consumer is identity's SAML AuthnRequest builder, which
 * needs raw DEFLATE (no zlib header) for the HTTP-Redirect binding per
 * SAML 2.0 §3.4.4.1. The port stays narrow until a second consumer
 * arrives; widening to gzip / brotli is a one-line addition.
 *
 * Per ADR 0008 (Atlas-on-Atlas) leak #4: modules MUST NOT import
 * `node:zlib` directly. They take a `Compression` and call its async
 * methods. The runtime adapter (Node `zlib`, browser `CompressionStream`)
 * decides the implementation.
 */
export interface Compression {
  /**
   * RFC 1951 raw DEFLATE — no zlib header, no checksum. Symmetric with
   * `inflateRaw`. Async to accommodate browser `CompressionStream`,
   * which is stream-based.
   */
  deflateRaw(input: Uint8Array): Promise<Uint8Array>;
  inflateRaw(input: Uint8Array): Promise<Uint8Array>;
}
