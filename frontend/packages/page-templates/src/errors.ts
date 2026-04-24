/**
 * Page-templates error taxonomy. Each error carries a stable `code` for
 * callers, plus an optional `details` bag for ajv errors and similar.
 */

export type PageTemplatesErrorCode =
  | 'PAGE_TEMPLATE_INVALID'
  | 'PAGE_DOCUMENT_INVALID'
  | 'PAGE_STORE_ERROR'
  | 'PAGE_TEMPLATE_VERSION_AHEAD';

class PageTemplatesError extends Error {
  readonly code: PageTemplatesErrorCode;
  readonly details?: unknown;

  constructor(code: PageTemplatesErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (details !== undefined) {
      (this as { details?: unknown }).details = details;
    }
  }
}

export class PageTemplateError extends PageTemplatesError {
  constructor(message: string, details?: unknown) {
    super('PAGE_TEMPLATE_INVALID', message, details);
  }
}

export class PageDocumentError extends PageTemplatesError {
  constructor(message: string, details?: unknown) {
    super('PAGE_DOCUMENT_INVALID', message, details);
  }
}

export class PageStoreError extends PageTemplatesError {
  constructor(message: string, details?: unknown) {
    super('PAGE_STORE_ERROR', message, details);
  }
}

export class TemplateVersionError extends PageTemplatesError {
  constructor(message: string, details?: unknown) {
    super('PAGE_TEMPLATE_VERSION_AHEAD', message, details);
  }
}
