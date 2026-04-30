/**
 * Hand-encoded WAT fixtures for the worker-host preemption tests.
 *
 * Two modules:
 *   - `infiniteLoopWasm`: render() runs `(loop $L (br $L))` forever.
 *     Used to verify that `WorkerWasmHost` hard-preempts via
 *     `worker.terminate()` instead of waiting on a Promise.race the
 *     event loop is wedged from satisfying.
 *   - `memoryGrowWasm`: alloc() calls `memory.grow 257` to push the
 *     linear memory past the 16 MB cap; the host should surface a
 *     memory-limit ExecutionFailed error rather than crash.
 *
 * Both follow the layout already used in `noopRenderWasm` (see
 * packages/contract-tests/src/wasm-host.ts) — same type/function/
 * memory/export sections, only the code section differs.
 */

/**
 * (module
 *   (memory (export "memory") 1)
 *   (func (export "alloc") (param i32) (result i32) i32.const 256)
 *   (func (export "render") (param i32 i32) (result i64)
 *     (loop $L (br $L))
 *     i64.const 0))
 *
 * `alloc` returns a non-zero pointer (256) so `runModule` doesn't bail
 * early on the invalid-pointer guard before getting to `render`. The
 * `render` body itself spins forever; this is the fixture the worker
 * host's preemption assertion relies on.
 *
 * alloc body: locals=0, i32.const 256 (LEB128 0x80 0x02), end. 5 bytes.
 *   0x00              locals=0
 *   0x41 0x80 0x02    i32.const 256
 *   0x0b              end
 * render body: locals=0, loop (blocktype void = 0x40), br 0, end-of-
 *   loop, i64.const 0, end-of-func. 9 bytes.
 *   0x00       locals=0
 *   0x03 0x40  loop, blocktype void
 *   0x0c 0x00  br 0
 *   0x0b       end (of loop)
 *   0x42 0x00  i64.const 0
 *   0x0b       end (of func)
 */
export const infiniteLoopWasm = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  // type section: 2 funcs (size=12)
  0x01, 0x0c, 0x02,
  0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e,
  // function section: 2 funcs, types [0, 1]
  0x03, 0x03, 0x02, 0x00, 0x01,
  // memory section: 1 memory, 1 page minimum, no max
  0x05, 0x03, 0x01, 0x00, 0x01,
  // export section: memory + alloc + render (size=27 = 0x1b)
  0x07, 0x1b, 0x03,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
  0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00,
  0x06, 0x72, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x00, 0x01,
  // code section: 2 bodies (size = 1 + (1+5) + (1+9) = 17 = 0x11)
  // body0 alloc: size=5 (0x05), 5 body bytes
  //              -> 0x05 0x00 0x41 0x80 0x02 0x0b
  // body1 render: size=9 (0x09), 9 body bytes
  //               -> 0x09 0x00 0x03 0x40 0x0c 0x00 0x0b 0x42 0x00 0x0b
  0x0a, 0x11, 0x02,
  0x05, 0x00, 0x41, 0x80, 0x02, 0x0b,
  0x09, 0x00, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x42, 0x00, 0x0b,
]);

/**
 * (module
 *   (memory (export "memory") 1)
 *   (func (export "alloc") (param i32) (result i32)
 *     i32.const 257
 *     memory.grow
 *     drop
 *     i32.const 256)
 *   (func (export "render") (param i32 i32) (result i64)
 *     ;; pack ptr=256, len=17 → (17 << 32) | 256 = 73014444288
 *     i64.const 0))  ;; we never reach the post-hoc check; alloc-time
 *                    ;; growth blows past the cap and the post-hoc
 *                    ;; check at the top of runModule fires before
 *                    ;; alloc completes? — see below
 *
 * Behaviour: alloc grows the linear memory by 257 pages = 16.0625 MB
 * on top of the initial 1 page; the buffer is now ~16.125 MB > 16 MB.
 * `runModule` does TWO post-hoc memory checks: one right after
 * instantiation (before alloc) and one right after `render` returns.
 * The first check passes (only 1 page initially), then alloc grows
 * memory, then the SECOND check (after render) fires
 * `ExecutionFailed: memory exceeds 16 MB limit`. Render returns 0
 * (pack(0,0)) but we never get to read it because the memory check
 * runs first. Alloc returns 256 so we don't trip the
 * invalid-pointer guard before the memory check has a chance to fire.
 *
 * alloc body bytes: 11 bytes total
 *   0x00              locals=0
 *   0x41 0x81 0x02    i32.const 257 (LEB128: 257 = 0x101 → 0x81 0x02)
 *   0x40 0x00         memory.grow (memory index byte = 0)
 *   0x1a              drop
 *   0x41 0x80 0x02    i32.const 256 (LEB128: 256 = 0x100 → 0x80 0x02)
 *   0x0b              end
 * render body bytes: 4 bytes total
 *   0x00              locals=0
 *   0x42 0x00         i64.const 0
 *   0x0b              end
 */
export const memoryGrowWasm = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type section
  0x01, 0x0c, 0x02,
  0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e,
  // function section
  0x03, 0x03, 0x02, 0x00, 0x01,
  // memory section
  0x05, 0x03, 0x01, 0x00, 0x01,
  // export section
  0x07, 0x1b, 0x03,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
  0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00,
  0x06, 0x72, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x00, 0x01,
  // code section: 2 bodies (size = 1 + (1+11) + (1+4) = 18 = 0x12)
  // body0 alloc: size=11 (0x0b), 11 body bytes
  // body1 render: size=4 (0x04), 4 body bytes
  0x0a, 0x12, 0x02,
  0x0b, 0x00, 0x41, 0x81, 0x02, 0x40, 0x00, 0x1a, 0x41, 0x80, 0x02, 0x0b,
  0x04, 0x00, 0x42, 0x00, 0x0b,
]);
