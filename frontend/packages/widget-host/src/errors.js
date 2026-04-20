/**
 * Widget host error taxonomy.
 *
 * Each error has a stable `code` so callers can branch on it without
 * pattern-matching on message strings. All extend the built-in Error.
 */

class WidgetHostError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class WidgetManifestError extends WidgetHostError {
  constructor(message, details) {
    super('WIDGET_MANIFEST_INVALID', message, details);
  }
}

export class WidgetLayoutError extends WidgetHostError {
  constructor(message, details) {
    super('WIDGET_LAYOUT_INVALID', message, details);
  }
}

export class UndeclaredTopicError extends WidgetHostError {
  constructor(message, details) {
    super('WIDGET_TOPIC_UNDECLARED', message, details);
  }
}

export class CapabilityDeniedError extends WidgetHostError {
  constructor(message, details) {
    super('WIDGET_CAPABILITY_DENIED', message, details);
  }
}

export class WidgetIsolationError extends WidgetHostError {
  constructor(message, details) {
    super('WIDGET_ISOLATION_UNSUPPORTED', message, details);
  }
}

export class WidgetConfigError extends WidgetHostError {
  constructor(message, details) {
    super('WIDGET_CONFIG_INVALID', message, details);
  }
}
