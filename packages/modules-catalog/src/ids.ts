function fnv1a64(s: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    hash = (hash ^ BigInt(s.charCodeAt(i))) & mask;
    hash = (hash * prime) & mask;
  }
  return hash;
}

function toHex(n: bigint, len: number): string {
  return n.toString(16).padStart(len, '0').slice(-len);
}

export function deterministicUuid(...parts: string[]): string {
  const seed = parts.join('|');
  const a = fnv1a64('a:' + seed);
  const b = fnv1a64('b:' + seed);
  const hex = toHex(a, 16) + toHex(b, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function newEventId(): string {
  const a = BigInt(Math.floor(Math.random() * 2 ** 32)) << 32n;
  const b = BigInt(Math.floor(Math.random() * 2 ** 32));
  const c = BigInt(Math.floor(Math.random() * 2 ** 32)) << 32n;
  const d = BigInt(Math.floor(Math.random() * 2 ** 32));
  const hex = toHex(a | b, 16) + toHex(c | d, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
