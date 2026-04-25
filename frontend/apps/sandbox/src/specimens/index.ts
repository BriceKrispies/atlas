/**
 * Specimen registry barrel. Each import registers its specimens for side
 * effects via `S({...})` → `AtlasSandbox.register(...)`. The sandbox
 * bootstrap imports this file once.
 *
 * Order doesn't affect behaviour — the sandbox sorts specimens via the
 * taxonomy resolver — but files are listed by category so diffs are
 * easier to read.
 */

// Primitives
import './primitives/layout.ts';
import './primitives/typography.ts';
import './primitives/controls-text.ts';
import './primitives/controls-selection.ts';
import './primitives/controls-specialized.ts';
import './primitives/feedback.ts';
import './primitives/navigation.ts';
import './primitives/mobile-nav.ts';
import './primitives/overlays.ts';
import './primitives/data.ts';

// Patterns
import './patterns/page.ts';
import './patterns/forms.ts';
import './patterns/shell.ts';
import './patterns/surfaces.ts';
import './patterns/widgets.ts';

// Pages
import './pages/content.ts';

// Templates
import './templates/editors.ts';
import './templates/layouts.ts';
import './templates/gallery.ts';
import './templates/page-editor.ts';
import './templates/layout-editor.ts';
