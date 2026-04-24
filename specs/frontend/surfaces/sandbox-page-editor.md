# `sandbox.page-editor` — Sandbox Page Editor

Surface contract for the sandbox-hosted visual page editor. The page editor
lets a user compose a page document (`page_document.schema.json`) by dragging
widgets into template regions, editing their config via a schema-driven
property panel, and previewing the result alongside the edit canvas.

The editor is a **dev surface** shipped inside `apps/sandbox`. Production
tenants will get an equivalent surface in `apps/admin` once the module
bundle model is finalized — this contract is the prototype for that.

```yaml
surfaceId: sandbox.page-editor
kind: page
purpose: Compose a page document from widgets, edit their config, preview live, and persist through the PageStore port.

auth:
  required: false
  roles: []
  permissions: []

states:
  loading:
    description: Skeleton canvas + palette while the seed page loads from the store
    testId: sandbox.page-editor.state-loading
  empty:
    description: Template has regions but no widget instances — drop-zones are the hero
    testId: sandbox.page-editor.state-empty
  success:
    description: Canvas renders the page with widgets; inspector, palette, and preview (if toggled) visible
    testId: sandbox.page-editor.state-success
  backendError:
    description: Store or schema error; surface shows message and retry
    testId: sandbox.page-editor.state-error
  validationError:
    description: Property panel rejected an edit with a stable reason code (from EditorAPI)
    testId: sandbox.page-editor.state-validation-error

elements:
  - name: toolbar
    type: atlas-box
    testId: sandbox.page-editor.toolbar
    purpose: Top strip holding undo/redo, template switcher, save status, preview toggle
  - name: undo
    type: atlas-button
    testId: sandbox.page-editor.undo
    purpose: Revert the previous edit (cmd/ctrl+z)
  - name: redo
    type: atlas-button
    testId: sandbox.page-editor.redo
    purpose: Re-apply the most recently undone edit (cmd/ctrl+shift+z)
  - name: template-switcher
    type: atlas-multi-select
    testId: sandbox.page-editor.template-switcher
    purpose: Change the underlying template/layout for the current page
  - name: save-status
    type: atlas-text
    testId: sandbox.page-editor.save-status
    purpose: "Shows persistence status: saved, saving, error"
  - name: toggle-preview
    type: atlas-button
    testId: sandbox.page-editor.toggle-preview
    purpose: Opens/closes the live preview pane
  - name: canvas
    type: atlas-box
    testId: sandbox.page-editor.canvas
    purpose: Hosts the edit-mode content-page element
  - name: inspector
    type: atlas-box
    testId: sandbox.page-editor.inspector
    purpose: Property panel driven by the selected widget's configSchema
  - name: preview
    type: atlas-box
    testId: sandbox.page-editor.preview
    purpose: View-mode content-page mirroring the same pageId

intents: []
# No backend intents in sandbox — the editor drives the in-memory PageStore
# port. Admin-app parity will add Content.Page.UpdateLayout here.

telemetryEvents:
  - eventName: sandbox.page-editor.mounted
    trigger: Shell connectedCallback completes
    properties: [pageId, templateId]
  - eventName: sandbox.page-editor.widget-added
    trigger: EditorAPI.add returned ok
    properties: [widgetId, instanceId, region, index, correlationId]
  - eventName: sandbox.page-editor.widget-moved
    trigger: EditorAPI.move returned ok
    properties: [instanceId, fromRegion, toRegion, fromIndex, toIndex, correlationId]
  - eventName: sandbox.page-editor.widget-updated
    trigger: EditorAPI.update returned ok
    properties: [instanceId, correlationId]
  - eventName: sandbox.page-editor.widget-removed
    trigger: EditorAPI.remove returned ok
    properties: [instanceId, correlationId]
  - eventName: sandbox.page-editor.edit-rejected
    trigger: EditorAPI returned ok=false
    properties: [action, reason]
  - eventName: sandbox.page-editor.undo
    trigger: Undo button or cmd/ctrl+z
    properties: [depth]
  - eventName: sandbox.page-editor.redo
    trigger: Redo button or cmd/ctrl+shift+z
    properties: [depth]
  - eventName: sandbox.page-editor.template-switched
    trigger: Template switcher commits
    properties: [fromTemplateId, toTemplateId, widgetsRemoved]
  - eventName: sandbox.page-editor.preview-toggled
    trigger: Preview button clicked
    properties: [open]

testIds:
  surface: sandbox.page-editor
  toolbar: sandbox.page-editor.toolbar
  undo: sandbox.page-editor.undo
  redo: sandbox.page-editor.redo
  templateSwitcher: sandbox.page-editor.template-switcher
  saveStatus: sandbox.page-editor.save-status
  togglePreview: sandbox.page-editor.toggle-preview
  canvas: sandbox.page-editor.canvas
  inspector: sandbox.page-editor.inspector
  preview: sandbox.page-editor.preview
  stateLoading: sandbox.page-editor.state-loading
  stateEmpty: sandbox.page-editor.state-empty
  stateSuccess: sandbox.page-editor.state-success
  stateError: sandbox.page-editor.state-error
  stateValidationError: sandbox.page-editor.state-validation-error

a11y:
  landmark: main
  ariaLabel: Page editor sandbox
  keyboardInteractions:
    - "cmd/ctrl+z: undo last edit"
    - "cmd/ctrl+shift+z: redo"
    - "Delete / Backspace on selected widget(s): remove"
    - "Escape: clear selection and close preview"
    - "Shift/cmd-click on widget: toggle selection (multi-select)"
  liveAnnouncements:
    - "Widget added"
    - "Widget removed"
    - "Edit rejected: {reason}"
    - "Template switched — N widgets removed"
    - "Undo"
    - "Redo"

acceptanceScenarios:
  - name: Mount shows seed page in edit mode
    given: Sandbox is running and the editor specimen is selected
    when: The shell mounts with pageId=editor-starter
    then: Canvas renders content-page with widgets; inspector is empty-stated; preview is hidden

  - name: Drag a widget from the palette
    given: Editor is mounted on editor-blank
    when: User drags atlas-kpi-tile from the palette to the main region
    then: content-page.editor.add is called; widget appears; telemetry widget-added fires

  - name: Edit a widget property via inspector
    given: A widget is selected on the canvas
    when: User changes a field in the inspector and blurs
    then: content-page.editor.update runs; canvas re-renders with new value; save-status briefly reads "saving" then "saved"

  - name: Undo restores previous state
    given: The user added a widget
    when: User presses cmd/ctrl+z
    then: The added widget is removed; redo becomes enabled

  - name: Toggle preview mirrors canvas
    given: Editor has widgets on canvas and preview is closed
    when: User clicks "Preview"
    then: Preview pane opens, view-mode content-page renders the same widgets on the same pageId

  - name: Multi-select + delete
    given: Two widgets exist on canvas
    when: User shift-clicks both and presses Delete
    then: Both are removed; each removal is a history frame

  - name: Switch template drops orphaned widgets
    given: Page uses template.two-column with widgets in "sidebar"
    when: User switches to a template without a "sidebar" region and confirms
    then: Sidebar widgets are removed in one history frame; warning shows count
```
