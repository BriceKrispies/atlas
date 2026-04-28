import { S } from '../_register.ts';

S({
  id: 'slider',
  name: 'Slider',
  tag: 'atlas-slider',
  variants: [
    {
      name: 'Default with value readout',
      html: `<atlas-slider label="Volume" value="40" min="0" max="100" show-value format="percent"></atlas-slider>`,
    },
    {
      name: 'Custom range / step',
      html: `<atlas-slider label="Temperature" value="20" min="16" max="28" step="0.5" show-value></atlas-slider>`,
    },
    {
      name: 'Disabled',
      html: `<atlas-slider label="Locked" value="50" min="0" max="100" disabled></atlas-slider>`,
    },
  ],
});

S({
  id: 'date-picker',
  name: 'DatePicker',
  tag: 'atlas-date-picker',
  variants: [
    {
      name: 'Default',
      html: `<atlas-date-picker label="Due date"></atlas-date-picker>`,
    },
    {
      name: 'With min/max and preset value',
      html: `<atlas-date-picker label="Event date" value="2026-05-01" min="2026-04-24" max="2026-12-31"></atlas-date-picker>`,
    },
    {
      name: 'Disabled',
      html: `<atlas-date-picker label="Archived" value="2024-01-01" disabled></atlas-date-picker>`,
    },
  ],
});

S({
  id: 'file-upload',
  name: 'FileUpload',
  tag: 'atlas-file-upload',
  variants: [
    {
      name: 'Default (single file)',
      html: `<atlas-file-upload label="Avatar" accept="image/*"></atlas-file-upload>`,
    },
    {
      name: 'Multiple with size limit',
      html: `<atlas-file-upload label="Attachments" multiple max-size="5242880"></atlas-file-upload>`,
    },
    {
      name: 'Disabled',
      html: `<atlas-file-upload label="Disabled" disabled></atlas-file-upload>`,
    },
  ],
});

S({
  id: 'form-field',
  name: 'FormField',
  tag: 'atlas-form-field',
  variants: [
    {
      name: 'Label + description',
      html: `
        <atlas-form-field label="Email" description="We'll only use this to send account notifications.">
          <atlas-input type="email" placeholder="you@example.com"></atlas-input>
        </atlas-form-field>
      `,
    },
    {
      name: 'Required + error',
      html: `
        <atlas-form-field label="Password" required error="Must be at least 8 characters.">
          <atlas-input type="password"></atlas-input>
        </atlas-form-field>
      `,
    },
    {
      name: 'Wraps a select',
      html: `
        <atlas-form-field label="Plan" description="You can change this later.">
          <atlas-select placeholder="Pick one"></atlas-select>
        </atlas-form-field>
      `,
    },
    {
      name: 'Wraps a textarea with error',
      html: `
        <atlas-form-field label="Reason" required error="Tell us why, please." description="Will be shared with reviewers.">
          <atlas-textarea rows="3"></atlas-textarea>
        </atlas-form-field>
      `,
    },
  ],
});
