/**
 * Page-templates error taxonomy. Each error carries a stable `code` for
 * callers, plus an optional `details` bag for ajv errors and similar.
 */

class PageTemplatesError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class PageTemplateError extends PageTemplatesError {
  constructor(message, details) {
    super('PAGE_TEMPLATE_INVALID', message, details);
  }
}

export class PageDocumentError extends PageTemplatesError {
  constructor(message, details) {
    super('PAGE_DOCUMENT_INVALID', message, details);
  }
}

export class PageStoreError extends PageTemplatesError {
  constructor(message, details) {
    super('PAGE_STORE_ERROR', message, details);
  }
}

export class TemplateVersionError extends PageTemplatesError {
  constructor(message, details) {
    super('PAGE_TEMPLATE_VERSION_AHEAD', message, details);
  }
}
