/**
 * Single source of truth for the event-envelope schema. Imports the JSON
 * file directly from specs/schemas/contracts/ so atlasctl can never drift
 * from the canonical contract (INV-CTL-04). When @atlas/schemas grows an
 * envelope export, swap this for that.
 */
import envelopeSchema from '../../../specs/schemas/contracts/event_envelope.schema.json' with { type: 'json' };

export { envelopeSchema };
export const ENVELOPE_SCHEMA_ID =
  'https://atlas-platform.example.com/schemas/event-envelope.v1.json';
