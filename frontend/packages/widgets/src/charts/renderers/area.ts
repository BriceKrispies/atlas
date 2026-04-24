import { renderLine, type LineRendererOptions } from './line.ts';

/** Thin wrapper — area is line + baseline fill. */
export function renderArea(opts: LineRendererOptions): SVGGElement {
  return renderLine({ ...opts, mode: 'area' });
}
