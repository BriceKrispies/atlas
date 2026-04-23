import { renderLine } from './line.js';

/** Thin wrapper — area is line + baseline fill. */
export function renderArea(opts) {
  return renderLine({ ...opts, mode: 'area' });
}
