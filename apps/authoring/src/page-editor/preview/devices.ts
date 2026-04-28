/**
 * Device frame definitions for the page-editor preview surface (S5).
 *
 * The dedicated `<page-editor-preview>` element renders the page document
 * inside one of three device frames. Frame widths are anchored to the
 * standard responsive breakpoints described in `specs/frontend/responsive.md`
 * (`--atlas-bp-sm | --atlas-bp-md | --atlas-bp-lg`):
 *
 *   - mobile  (390 × 844)  iPhone-class — sits below `--atlas-bp-sm`
 *   - tablet  (820 × 1180) iPad-class   — sits below `--atlas-bp-md`
 *   - desktop (1440 × 900) laptop-class — comfortably above `--atlas-bp-lg`
 *
 * Heights are advisory: the frame's CSS `height` matches but the inner
 * content is allowed to scroll inside the frame. Tests assert on the
 * width because that's what governs the responsive layout the user is
 * previewing.
 */
import type { PreviewDevice } from '../state.ts';

export interface DeviceFrame {
  readonly id: PreviewDevice;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export const DEVICES: ReadonlyArray<DeviceFrame> = [
  { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
  { id: 'tablet', label: 'Tablet', width: 820, height: 1180 },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
];

const BY_ID: Readonly<Record<PreviewDevice, DeviceFrame>> = Object.freeze(
  Object.fromEntries(DEVICES.map((d) => [d.id, d])) as Record<PreviewDevice, DeviceFrame>,
);

/** Return the frame definition for a given device id. */
export function deviceFrame(id: PreviewDevice): DeviceFrame {
  return BY_ID[id];
}
