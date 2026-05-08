/**
 * Shared type contract between the <atlas-code-editor> stub and its
 * lazy-loaded Monaco impl. Defining these here (instead of in the stub
 * file) lets both files import a static type without forming an
 * import-graph cycle — the stub still loads the impl via dynamic
 * import, which is the real runtime relationship.
 */

export interface CodeEditorController {
  getValue(): string;
  setValue(next: string): void;
  applyAttribute(name: string, value: string | null): void;
  dispose(): void;
}

export interface CodeEditorModule {
  mount(host: HTMLElement): CodeEditorController;
}
