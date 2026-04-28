import { S } from '../_register.ts';

S({
  id: 'breadcrumbs',
  name: 'Breadcrumbs',
  tag: 'atlas-breadcrumbs',
  variants: [
    {
      name: '2 items',
      html: `
        <atlas-breadcrumbs label="You are here">
          <atlas-breadcrumb-item href="#/admin">Admin</atlas-breadcrumb-item>
          <atlas-breadcrumb-item current>Pages</atlas-breadcrumb-item>
        </atlas-breadcrumbs>
      `,
    },
    {
      name: '5 items',
      html: `
        <atlas-breadcrumbs>
          <atlas-breadcrumb-item href="#/admin">Admin</atlas-breadcrumb-item>
          <atlas-breadcrumb-item href="#/admin/content">Content</atlas-breadcrumb-item>
          <atlas-breadcrumb-item href="#/admin/content/pages">Pages</atlas-breadcrumb-item>
          <atlas-breadcrumb-item href="#/admin/content/pages/welcome">Welcome</atlas-breadcrumb-item>
          <atlas-breadcrumb-item current>Edit</atlas-breadcrumb-item>
        </atlas-breadcrumbs>
      `,
    },
    {
      name: 'Overflow at 320px (10 items)',
      html: `
        <div style="width: 320px; border: 1px dashed var(--atlas-color-border); padding: var(--atlas-space-sm); border-radius: var(--atlas-radius-md);">
          <atlas-breadcrumbs>
            <atlas-breadcrumb-item href="#/root">Root</atlas-breadcrumb-item>
            <atlas-breadcrumb-item href="#/root/org">Acme Corp</atlas-breadcrumb-item>
            <atlas-breadcrumb-item href="#/root/org/region">EMEA</atlas-breadcrumb-item>
            <atlas-breadcrumb-item href="#/root/org/region/country">Germany</atlas-breadcrumb-item>
            <atlas-breadcrumb-item href="#/root/org/region/country/dept">Engineering</atlas-breadcrumb-item>
            <atlas-breadcrumb-item href="#/root/org/region/country/dept/team">Platform</atlas-breadcrumb-item>
            <atlas-breadcrumb-item href="#/root/org/region/country/dept/team/svc">Atlas</atlas-breadcrumb-item>
            <atlas-breadcrumb-item href="#/root/org/region/country/dept/team/svc/repo">Frontend</atlas-breadcrumb-item>
            <atlas-breadcrumb-item href="#/root/.../widgets">Widgets</atlas-breadcrumb-item>
            <atlas-breadcrumb-item current>Card</atlas-breadcrumb-item>
          </atlas-breadcrumbs>
        </div>
      `,
    },
  ],
});

S({
  id: 'tree',
  name: 'Tree',
  tag: 'atlas-tree',
  variants: [
    {
      name: 'Simple 2-level',
      html: `
        <atlas-tree label="Project files">
          <atlas-tree-item value="src" expanded>src
            <atlas-tree-item value="src/index.ts">index.ts</atlas-tree-item>
            <atlas-tree-item value="src/app.ts">app.ts</atlas-tree-item>
          </atlas-tree-item>
          <atlas-tree-item value="tests" expanded>tests
            <atlas-tree-item value="tests/app.test.ts">app.test.ts</atlas-tree-item>
          </atlas-tree-item>
          <atlas-tree-item value="readme">README.md</atlas-tree-item>
        </atlas-tree>
      `,
    },
    {
      name: 'Org units (single selection)',
      html: `
        <atlas-tree label="Organisation" selection="single">
          <atlas-tree-item value="acme" expanded>Acme Corp
            <atlas-tree-item value="acme/emea" expanded>EMEA
              <atlas-tree-item value="acme/emea/de">Germany</atlas-tree-item>
              <atlas-tree-item value="acme/emea/fr" selected>France</atlas-tree-item>
              <atlas-tree-item value="acme/emea/uk">United Kingdom</atlas-tree-item>
            </atlas-tree-item>
            <atlas-tree-item value="acme/amer">Americas
              <atlas-tree-item value="acme/amer/us">United States</atlas-tree-item>
              <atlas-tree-item value="acme/amer/ca">Canada</atlas-tree-item>
              <atlas-tree-item value="acme/amer/br" disabled>Brazil (coming soon)</atlas-tree-item>
            </atlas-tree-item>
            <atlas-tree-item value="acme/apac">APAC
              <atlas-tree-item value="acme/apac/jp">Japan</atlas-tree-item>
            </atlas-tree-item>
          </atlas-tree-item>
        </atlas-tree>
      `,
    },
    {
      name: 'Multi-select with disabled nodes',
      html: `
        <atlas-tree label="Permissions" selection="multiple">
          <atlas-tree-item value="content" expanded>Content
            <atlas-tree-item value="content.read" selected>Read</atlas-tree-item>
            <atlas-tree-item value="content.write" selected>Write</atlas-tree-item>
            <atlas-tree-item value="content.delete" disabled>Delete (admin only)</atlas-tree-item>
          </atlas-tree-item>
          <atlas-tree-item value="settings" expanded>Settings
            <atlas-tree-item value="settings.read">Read</atlas-tree-item>
            <atlas-tree-item value="settings.write">Write</atlas-tree-item>
          </atlas-tree-item>
        </atlas-tree>
      `,
    },
  ],
});

S({
  id: 'stepper',
  name: 'Stepper',
  tag: 'atlas-stepper',
  variants: [
    {
      name: 'Horizontal 4-step',
      html: `
        <atlas-stepper>
          <atlas-step value="account" status="complete" label="Account"></atlas-step>
          <atlas-step value="profile" status="complete" label="Profile"></atlas-step>
          <atlas-step value="team" status="current" label="Team"></atlas-step>
          <atlas-step value="confirm" status="pending" label="Confirm"></atlas-step>
        </atlas-stepper>
      `,
    },
    {
      name: 'Vertical 4-step',
      html: `
        <atlas-stepper orientation="vertical">
          <atlas-step value="upload" status="complete" label="Upload data"></atlas-step>
          <atlas-step value="map" status="complete" label="Map columns"></atlas-step>
          <atlas-step value="validate" status="current" label="Validate"></atlas-step>
          <atlas-step value="import" status="pending" label="Import"></atlas-step>
        </atlas-stepper>
      `,
    },
    {
      name: 'With error',
      html: `
        <atlas-stepper>
          <atlas-step value="a" status="complete" label="Plan"></atlas-step>
          <atlas-step value="b" status="error" label="Provision"></atlas-step>
          <atlas-step value="c" status="pending" label="Deploy"></atlas-step>
          <atlas-step value="d" status="pending" label="Verify"></atlas-step>
        </atlas-stepper>
      `,
    },
    {
      name: 'Clickable',
      html: `
        <atlas-stepper clickable name="onboarding">
          <atlas-step value="account" status="complete" label="Account"></atlas-step>
          <atlas-step value="profile" status="complete" label="Profile"></atlas-step>
          <atlas-step value="team" status="current" label="Team"></atlas-step>
          <atlas-step value="confirm" status="pending" label="Confirm"></atlas-step>
        </atlas-stepper>
      `,
    },
  ],
});

S({
  id: 'pagination',
  name: 'Pagination',
  tag: 'atlas-pagination',
  variants: [
    {
      name: 'Page 1 of 10',
      html: `<atlas-pagination total="100" page="1" page-size="10"></atlas-pagination>`,
    },
    {
      name: 'Page 5 of 10',
      html: `<atlas-pagination total="100" page="5" page-size="10"></atlas-pagination>`,
    },
    {
      name: 'Page 20 of 100 (ellipsis both sides)',
      html: `<atlas-pagination total="1000" page="20" page-size="10"></atlas-pagination>`,
    },
    {
      name: 'Mobile-collapsed (constrained)',
      html: `
        <div style="max-width: 360px; border: 1px dashed var(--atlas-color-border); padding: var(--atlas-space-sm); border-radius: var(--atlas-radius-md);">
          <atlas-pagination total="500" page="7" page-size="10"></atlas-pagination>
        </div>
      `,
    },
  ],
});

S({
  id: 'progress',
  name: 'Progress',
  tag: 'atlas-progress',
  variants: [
    {
      name: 'Determinate values',
      html: `
        <atlas-stack gap="md">
          <atlas-progress value="0"></atlas-progress>
          <atlas-progress value="33"></atlas-progress>
          <atlas-progress value="66"></atlas-progress>
          <atlas-progress value="100"></atlas-progress>
        </atlas-stack>
      `,
    },
    {
      name: 'Indeterminate',
      html: `<atlas-progress indeterminate label="Loading"></atlas-progress>`,
    },
    {
      name: 'Variants',
      html: `
        <atlas-stack gap="md">
          <atlas-progress value="50" variant="default" show-label></atlas-progress>
          <atlas-progress value="75" variant="success" show-label></atlas-progress>
          <atlas-progress value="60" variant="warning" show-label></atlas-progress>
          <atlas-progress value="20" variant="danger" show-label></atlas-progress>
        </atlas-stack>
      `,
    },
    {
      name: 'With label, sm size',
      html: `
        <atlas-stack gap="md">
          <atlas-progress value="47" show-label></atlas-progress>
          <atlas-progress value="47" size="sm" show-label></atlas-progress>
        </atlas-stack>
      `,
    },
  ],
});
