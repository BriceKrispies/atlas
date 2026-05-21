/**
 * Type-narrowing helpers for the `fast-xml-parser` boundary.
 *
 * `XMLParser.parse()` returns `any` (the library has no typed schema for
 * the input XML), so every read off the parsed tree is a candidate for
 * the unsafe-type-assertion lint. Funnelling all those reads through
 * these helpers gives one runtime check per shape with one documented
 * suppression each — call sites stay clean.
 *
 * Shared between `verify.ts` (SAML response verification) and
 * `metadata-parser.ts` (IdP metadata ingest). Both consume the same
 * `XMLParser` output shape; the helpers are the impedance bridge.
 */
/**
 * Runtime-checked narrowing for properties read from the parsed XML tree.
 * One single cast funnels every parsed-tree object read through this guard.
 */
export function asXmlRecord(v: unknown): Record<string, unknown> | undefined {
    if (v === null || v === undefined)
        return undefined;
    if (typeof v !== 'object')
        return undefined;
    if (Array.isArray(v))
        return undefined;
    return v as Record<string, unknown>;
}
/** Pure runtime `typeof` guard — no cast at all. */
export function asXmlString(v: unknown): string | undefined {
    return typeof v === 'string' ? v : undefined;
}
/**
 * Narrow audience-restriction shape: `string | string[]` from
 * fast-xml-parser's single-or-array convention. Typed `.every` predicate
 * keeps the result safe — no cast.
 */
export function asXmlStringOrArray(v: unknown): string | string[] | undefined {
    if (typeof v === 'string')
        return v;
    if (Array.isArray(v) && v.every(function (x): x is string {
        return typeof x === 'string';
    })) {
        return v;
    }
    return undefined;
}
/**
 * Normalise fast-xml-parser's single-or-array attribute output to an array
 * of runtime-checked records. Reuses `asXmlRecord` so every entry is
 * funnelled through one narrowing.
 */
export function asXmlRecordArray(v: unknown): Record<string, unknown>[] {
    if (v === undefined || v === null)
        return [];
    const items = Array.isArray(v) ? v : [v];
    const out: Record<string, unknown>[] = [];
    for (const item of items) {
        const rec = asXmlRecord(item);
        if (rec)
            out.push(rec);
    }
    return out;
}
