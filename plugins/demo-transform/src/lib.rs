//! Demo WASM transform plugin with zero imports.
//!
//! Targets `wasm32-unknown-unknown`. No std, no allocator, no host functions.
//! Exports: `alloc`, `render`, `memory`.
//!
//! Output: structured render tree IR (version 1).

#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// --- Bump allocator ---

static mut HEAP: [u8; 65536] = [0u8; 65536]; // 64 KB heap
static mut HEAP_PTR: usize = 0;

#[no_mangle]
pub extern "C" fn alloc(len: i32) -> i32 {
    unsafe {
        let len = len as usize;
        // Align to 8 bytes
        let aligned = (HEAP_PTR + 7) & !7;
        let heap_ptr = &raw const HEAP as *const u8;
        let heap_len = core::mem::size_of_val(&*(&raw const HEAP));
        if aligned + len > heap_len {
            return 0; // OOM
        }
        HEAP_PTR = aligned + len;
        heap_ptr.add(aligned) as i32
    }
}

// --- JSON field extraction (no-alloc, no-parse) ---

/// Find a string value for a given key in flat JSON.
/// Returns (start, end) byte offsets of the value (without quotes).
fn find_str_value(json: &[u8], key: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i + key.len() + 3 < json.len() {
        if json[i] == b'"' {
            let start = i + 1;
            if start + key.len() <= json.len() && &json[start..start + key.len()] == key {
                let after_key = start + key.len();
                if after_key < json.len() && json[after_key] == b'"' {
                    let mut j = after_key + 1;
                    while j < json.len() && (json[j] == b' ' || json[j] == b'\t' || json[j] == b'\n' || json[j] == b'\r') {
                        j += 1;
                    }
                    if j < json.len() && json[j] == b':' {
                        j += 1;
                        while j < json.len() && (json[j] == b' ' || json[j] == b'\t' || json[j] == b'\n' || json[j] == b'\r') {
                            j += 1;
                        }
                        if j < json.len() && json[j] == b'"' {
                            let val_start = j + 1;
                            let mut val_end = val_start;
                            while val_end < json.len() && json[val_end] != b'"' {
                                val_end += 1;
                            }
                            return Some((val_start, val_end));
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

// --- Output buffer ---

static mut OUT_BUF: [u8; 4096] = [0u8; 4096];

/// Append bytes to output buffer, return new offset.
fn append(buf: &mut [u8], offset: usize, src: &[u8]) -> usize {
    let end = offset + src.len();
    if end <= buf.len() {
        buf[offset..end].copy_from_slice(src);
    }
    end
}

#[no_mangle]
pub extern "C" fn render(ptr: i32, len: i32) -> u64 {
    let input = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };

    let title = find_str_value(input, b"title");
    let page_id = find_str_value(input, b"pageId");
    let slug = find_str_value(input, b"slug");

    let out = unsafe { &mut *(&raw mut OUT_BUF) };
    let mut o = 0;

    // Emit render tree IR: {"version":1,"nodes":[...]}
    o = append(out, o, br#"{"version":1,"nodes":["#);

    // Node 1: heading with title
    o = append(out, o, br#"{"type":"heading","props":{"level":1},"children":[{"type":"text","props":{"content":""#);
    if let Some((s, e)) = title {
        o = append(out, o, &input[s..e]);
    }
    o = append(out, o, br#""}}]}"#);

    // Node 2: paragraph with page info
    o = append(out, o, br#",{"type":"paragraph","children":[{"type":"text","props":{"content":"Page: "#);
    if let Some((s, e)) = page_id {
        o = append(out, o, &input[s..e]);
    }
    o = append(out, o, br#" | Slug: /"#);
    if let Some((s, e)) = slug {
        o = append(out, o, &input[s..e]);
    }
    o = append(out, o, br#""}}]}"#);

    // Close nodes array and root object
    o = append(out, o, br#"]}"#);

    let out_ptr = out.as_ptr() as u64;
    let out_len = o as u64;

    // Pack: lower 32 = ptr, upper 32 = len
    (out_len << 32) | (out_ptr & 0xFFFF_FFFF)
}
