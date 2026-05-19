/**
 * Render tree IR validation — TypeScript mirror of
 * `crates/wasm_runtime/src/render_tree.rs`.
 *
 * Enforces invariants V1-V17 against structured render trees produced by
 * WASM plugins. Invalid trees are rejected entirely (no partial trees,
 * no fallback). Each thrown {@link RenderTreeError} carries an `invariant`
 * tag (e.g. `"V1"`, `"V11"`) so callers can pinpoint the rule that fired.
 *
 * Line references map back to the Rust source-of-truth so the two
 * implementations can be diffed.
 */
import { MAX_SERIALIZED_OUTPUT } from './errors.ts';
export { MAX_SERIALIZED_OUTPUT };
/** Max nesting depth (V13). Mirrors Rust `MAX_DEPTH`. */
const MAX_DEPTH = 64;
/** Max total node count (V14). Mirrors Rust `MAX_NODE_COUNT`. */
const MAX_NODE_COUNT = 10000;
/** Max bytes (UTF-8) for a single prop string value (V16). */
const MAX_PROP_VALUE_SIZE = 100 * 1024;
/** Leaf node types — MUST NOT have children (V7). */
const LEAF_TYPES = new Set(['text', 'image', 'divider']);
/** Block-level node types. */
const BLOCK_TYPES = new Set([
    'heading',
    'paragraph',
    'code_block',
    'blockquote',
    'list',
    'list_item',
    'block',
    'divider',
    'image',
]);
/** Inline node types. */
const INLINE_TYPES = new Set([
    'text',
    'strong',
    'emphasis',
    'code',
    'link',
    'image',
]);
/** All known primitive node types (V4). */
const PRIMITIVE_TYPES = new Set([
    'text',
    'image',
    'divider',
    'heading',
    'paragraph',
    'code_block',
    'blockquote',
    'list',
    'list_item',
    'block',
    'strong',
    'emphasis',
    'code',
    'link',
]);
/** Allowed URL schemes for `link.href` (V11). */
const LINK_SCHEMES = ['https:', 'http:', 'mailto:'];
/** Allowed URL schemes for `image.src` (V12). */
const IMAGE_SCHEMES = ['https:', 'http:'];
/**
 * Tag identifying which invariant a {@link RenderTreeError} corresponds to.
 * One of `"V1"` … `"V17"`.
 */
export type RenderTreeInvariant = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11' | 'V12' | 'V13' | 'V14' | 'V15' | 'V16' | 'V17';
/**
 * Error thrown by {@link validateRenderTree} when an invariant is violated.
 * Mirrors the `kind` + `detail` shape of {@link WasmHostError}, plus an
 * `invariant` tag so callers can branch on the specific rule.
 */
export class RenderTreeError extends Error {
    readonly kind: string;
    readonly detail: string;
    readonly invariant: RenderTreeInvariant;
    constructor(invariant: RenderTreeInvariant, detail: string) {
        super(`${invariant}: ${detail}`);
        this.name = 'RenderTreeError';
        this.kind = 'InvalidRenderTree';
        this.detail = detail;
        this.invariant = invariant;
    }
}
/** Structural shape — present after validation succeeds. */
export interface RenderTree {
    version: 1;
    nodes: RenderNode[];
}
export interface RenderNode {
    type: string;
    props?: Record<string, string | number | boolean | null>;
    children?: RenderNode[];
    fallback?: RenderNode[];
}
/** Context in which a node appears, for V8 nesting rule enforcement. */
type NodeContext = 'Block' | 'Inline' | 'ListChildren' | 'Fallback';
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype);
}
/** Number of UTF-8 bytes a string would occupy. */
const utf8ByteLength = (function () {
    // Node has Buffer; browsers have TextEncoder. Prefer TextEncoder for portability.
    if (typeof TextEncoder !== 'undefined') {
        const enc = new TextEncoder();
        return function (s: string) {
            return enc.encode(s).length;
        };
    }
    return function (s: string) {
        return Buffer.byteLength(s, 'utf8');
    };
})();
/**
 * Validate a render tree against invariants V1-V17.
 *
 * Throws {@link RenderTreeError} on the first violation; the error's
 * `invariant` field identifies which rule fired.
 */
export function validateRenderTree(input: unknown): asserts input is RenderTree {
    // V15: serialized size <= 1 MB. Run first so a giant input short-circuits
    // before we walk it. JSON.stringify can return undefined for non-JSON-able
    // values (e.g. functions); treat that as a structural failure caught downstream.
    let serialized: string | undefined;
    try {
        serialized = JSON.stringify(input);
    }
    catch {
        serialized = undefined;
    }
    if (serialized !== undefined) {
        const size = utf8ByteLength(serialized);
        if (size > MAX_SERIALIZED_OUTPUT) {
            throw new RenderTreeError('V15', `serialized render tree exceeds 1 MB limit (${size} bytes)`);
        }
    }
    if (!isPlainObject(input)) {
        // Structural failure — fall under V1 by spec (the Rust validator's
        // first .as_object() failure is reported as a structural error). The
        // contract test never exercises this branch directly, but use V1 as
        // the closest-fit tag.
        throw new RenderTreeError('V1', 'render tree must be a JSON object');
    }
    const obj = input;
    // V1: version is a positive integer === 1
    if (!('version' in obj)) {
        throw new RenderTreeError('V1', 'missing required field: version');
    }
    const version = obj['version'];
    if (typeof version !== 'number' ||
        !Number.isInteger(version) ||
        version <= 0) {
        throw new RenderTreeError('V1', 'version must be a positive integer');
    }
    if (version !== 1) {
        throw new RenderTreeError('V1', `unsupported render tree version: ${version}`);
    }
    // V2: nodes is a non-empty array
    if (!('nodes' in obj)) {
        throw new RenderTreeError('V2', 'missing required field: nodes');
    }
    const nodes = obj['nodes'];
    if (!Array.isArray(nodes)) {
        throw new RenderTreeError('V2', 'nodes must be an array');
    }
    if (nodes.length === 0) {
        throw new RenderTreeError('V2', 'nodes array must not be empty');
    }
    // Reject unknown top-level keys
    for (const key of Object.keys(obj)) {
        if (key !== 'version' && key !== 'nodes') {
            throw new RenderTreeError('V1', `unknown top-level field: ${key}`);
        }
    }
    // Walk all nodes
    const counter = { count: 0 };
    for (const node of nodes) {
        validateNode(node, 'Block', 1, counter);
    }
}
interface Counter {
    count: number;
}
function validateNode(node: unknown, ctx: NodeContext, depth: number, counter: Counter): void {
    // V13: depth check
    if (depth > MAX_DEPTH) {
        throw new RenderTreeError('V13', `tree depth exceeds maximum of ${MAX_DEPTH}`);
    }
    // V14: node count check
    counter.count += 1;
    if (counter.count > MAX_NODE_COUNT) {
        throw new RenderTreeError('V14', `node count exceeds maximum of ${MAX_NODE_COUNT}`);
    }
    if (!isPlainObject(node)) {
        throw new RenderTreeError('V3', 'node must be a JSON object');
    }
    const obj = node;
    // V3: type is a non-empty string
    if (!('type' in obj)) {
        throw new RenderTreeError('V3', 'node missing required field: type');
    }
    const nodeType = obj['type'];
    if (typeof nodeType !== 'string') {
        throw new RenderTreeError('V3', 'node type must be a string');
    }
    if (nodeType.length === 0) {
        throw new RenderTreeError('V3', 'node type must not be empty');
    }
    const isExtension = nodeType.startsWith('x-');
    // V10: extension nodes are not allowed in fallback context
    if (isExtension && ctx === 'Fallback') {
        throw new RenderTreeError('V10', `extension node '${nodeType}' is not allowed in fallback (must be primitive-only)`);
    }
    // V4: type is a known primitive OR starts with x-
    if (!isExtension && !PRIMITIVE_TYPES.has(nodeType)) {
        throw new RenderTreeError('V4', `unknown node type: ${nodeType}`);
    }
    // Reject unknown fields on the node
    for (const key of Object.keys(obj)) {
        if (key !== 'type' && key !== 'props' && key !== 'children' && key !== 'fallback') {
            throw new RenderTreeError('V3', `unknown field on node: ${key}`);
        }
    }
    // V5, V6, V16: validate props (or absence-of-props)
    if ('props' in obj) {
        validateProps(obj['props'], nodeType);
    }
    else {
        checkRequiredProps(undefined, nodeType);
    }
    const isLeaf = !isExtension && LEAF_TYPES.has(nodeType);
    // V7: leaf nodes must not have children
    if (isLeaf && 'children' in obj) {
        throw new RenderTreeError('V7', `leaf node '${nodeType}' must not have children`);
    }
    // V8: nesting rules (skip for extensions — they're free-form by type)
    if (!isExtension) {
        validateNesting(nodeType, ctx);
    }
    // Validate children
    if ('children' in obj && obj['children'] !== undefined) {
        if (!Array.isArray(obj['children'])) {
            throw new RenderTreeError('V3', 'children must be an array');
        }
        const childCtx = childContext(nodeType, isExtension);
        for (const child of obj['children']) {
            validateNode(child, childCtx, depth + 1, counter);
        }
    }
    // V9, V10: extension fallback rules
    if (isExtension) {
        if (!('fallback' in obj)) {
            throw new RenderTreeError('V9', `extension node '${nodeType}' missing required fallback`);
        }
        const fallback = obj['fallback'];
        if (!Array.isArray(fallback)) {
            throw new RenderTreeError('V9', 'fallback must be an array');
        }
        for (const fbNode of fallback) {
            validateNode(fbNode, 'Fallback', depth + 1, counter);
        }
    }
    else if ('fallback' in obj) {
        throw new RenderTreeError('V9', `primitive node '${nodeType}' must not have fallback`);
    }
}
function validateNesting(nodeType: string, ctx: NodeContext): void {
    switch (ctx) {
        case 'Block':
        case 'Fallback':
            if (!BLOCK_TYPES.has(nodeType)) {
                throw new RenderTreeError('V8', `node '${nodeType}' is not allowed at block level`);
            }
            break;
        case 'Inline':
            if (!INLINE_TYPES.has(nodeType)) {
                throw new RenderTreeError('V8', `node '${nodeType}' is not allowed at inline level`);
            }
            break;
        case 'ListChildren':
            if (nodeType !== 'list_item') {
                throw new RenderTreeError('V8', `list children must be list_item, got '${nodeType}'`);
            }
            break;
    }
}
function childContext(nodeType: string, isExtension: boolean): NodeContext {
    if (isExtension) {
        return 'Block';
    }
    switch (nodeType) {
        case 'list':
            return 'ListChildren';
        case 'heading':
        case 'paragraph':
        case 'code_block':
        case 'strong':
        case 'emphasis':
        case 'code':
        case 'link':
            return 'Inline';
        case 'list_item':
        case 'blockquote':
        case 'block':
        default:
            return 'Block';
    }
}
function validateProps(props: unknown, nodeType: string): void {
    if (!isPlainObject(props)) {
        throw new RenderTreeError('V5', 'props must be a JSON object');
    }
    // V5, V16: all values must be JSON primitives, no string > 100 KB
    for (const [key, val] of Object.entries(props)) {
        if (typeof val === 'string') {
            const size = utf8ByteLength(val);
            if (size > MAX_PROP_VALUE_SIZE) {
                throw new RenderTreeError('V16', `prop '${key}' value exceeds 100 KB limit (${size} bytes)`);
            }
        }
        else if (typeof val === 'number' ||
            typeof val === 'boolean' ||
            val === null) {
            // primitive — ok
        }
        else {
            throw new RenderTreeError('V5', `prop '${key}' value must be a JSON primitive (string, number, boolean, null)`);
        }
    }
    checkRequiredProps(props as Record<string, unknown>, nodeType);
}
function checkRequiredProps(props: Record<string, unknown> | undefined, nodeType: string): void {
    switch (nodeType) {
        case 'text': {
            // V6: content required string; V17: not empty
            const content = props?.['content'];
            if (content === undefined) {
                throw new RenderTreeError('V6', 'text node missing required prop: content');
            }
            if (typeof content !== 'string') {
                throw new RenderTreeError('V6', 'text.content must be a string');
            }
            if (content.length === 0) {
                throw new RenderTreeError('V17', 'text.content must not be empty');
            }
            break;
        }
        case 'heading': {
            // V6: level required integer 1-6
            const level = props?.['level'];
            if (level === undefined) {
                throw new RenderTreeError('V6', 'heading node missing required prop: level');
            }
            if (typeof level !== 'number' ||
                !Number.isInteger(level) ||
                level < 0) {
                throw new RenderTreeError('V6', 'heading.level must be an integer');
            }
            if (level < 1 || level > 6) {
                throw new RenderTreeError('V6', `heading.level must be 1-6, got ${level}`);
            }
            break;
        }
        case 'image': {
            // V6: src + alt required
            const src = props?.['src'];
            if (src === undefined) {
                throw new RenderTreeError('V6', 'image node missing required prop: src');
            }
            if (typeof src !== 'string') {
                throw new RenderTreeError('V6', 'image.src must be a string');
            }
            // V12: scheme check
            validateUrlScheme(src, IMAGE_SCHEMES, 'image.src', 'V12');
            const alt = props?.['alt'];
            if (alt === undefined) {
                throw new RenderTreeError('V6', 'image node missing required prop: alt');
            }
            if (typeof alt !== 'string') {
                throw new RenderTreeError('V6', 'image.alt must be a string');
            }
            break;
        }
        case 'link': {
            // V6: href required
            const href = props?.['href'];
            if (href === undefined) {
                throw new RenderTreeError('V6', 'link node missing required prop: href');
            }
            if (typeof href !== 'string') {
                throw new RenderTreeError('V6', 'link.href must be a string');
            }
            // V11: scheme check
            validateUrlScheme(href, LINK_SCHEMES, 'link.href', 'V11');
            break;
        }
        case 'list': {
            // V6: ordered required boolean
            const ordered = props?.['ordered'];
            if (ordered === undefined) {
                throw new RenderTreeError('V6', 'list node missing required prop: ordered');
            }
            if (typeof ordered !== 'boolean') {
                throw new RenderTreeError('V6', 'list.ordered must be a boolean');
            }
            break;
        }
        default:
            // No required props for other types (or extensions)
            break;
    }
}
function validateUrlScheme(url: string, allowed: readonly string[], field: string, invariant: RenderTreeInvariant): void {
    const lower = url.toLowerCase();
    for (const scheme of allowed) {
        if (lower.startsWith(scheme)) {
            return;
        }
    }
    const truncated = url.length > 50 ? url.slice(0, 50) : url;
    throw new RenderTreeError(invariant, `${field} has disallowed scheme (allowed: ${JSON.stringify(allowed)}): ${truncated}`);
}
