/**
 * Structural dry-run for the iframe isolation pieces.
 *
 * We do not try to run the iframe-host end-to-end — linkedom has no
 * iframe content-window support and we don't want a full browser
 * here. Instead we verify the public shape of each new module so a
 * regression in exports surfaces immediately. The browser-backed
 * assertions live in Playwright specimens for the sandbox.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function main(): Promise<void> {
  const boot = await import('../src/iframe-runtime/boot.ts');
  if (typeof boot.BOOT_SCRIPT !== 'string' || boot.BOOT_SCRIPT.length === 0) {
    fail('BOOT_SCRIPT must be exported as a non-empty string');
  }
  // Must contain the widget-ready handshake and the dynamic import.
  if (!boot.BOOT_SCRIPT.includes('widget-ready')) {
    fail('BOOT_SCRIPT must post a widget-ready handshake');
  }
  if (!boot.BOOT_SCRIPT.includes('import(')) {
    fail('BOOT_SCRIPT must dynamically import the widget module URL');
  }

  const transport = await import('../src/transport/postmessage.ts');
  if (typeof transport.createPostMessageTransport !== 'function') {
    fail('createPostMessageTransport must be exported as a function');
  }

  const iframeHostPath = fileURLToPath(
    new URL('../src/hosts/iframe-host.ts', import.meta.url),
  );
  const iframeHostSrc = readFileSync(iframeHostPath, 'utf8');
  for (const needle of [
    'export async function mount',
    'sandbox',
    'allow-scripts',
    'widgetModuleUrl',
    'capability.ack',
  ]) {
    if (!iframeHostSrc.includes(needle)) {
      fail(`iframe-host.ts is missing required token: ${needle}`);
    }
  }
  // allow-same-origin would defeat the whole point; fail loudly if
  // the actual sandbox attribute grants it. (Comments mentioning the
  // token by name are fine.)
  if (
    /setAttribute\(\s*['"]sandbox['"][^)]*allow-same-origin/.test(
      iframeHostSrc,
    )
  ) {
    fail(
      'iframe-host.ts must NOT grant allow-same-origin on the sandbox attribute',
    );
  }

  console.log('OK');
}

main().catch((err: unknown) => {
  const stack =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('FAIL:', stack);
  process.exit(1);
});
