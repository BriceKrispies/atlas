export interface ErrorBody {
  code: string;
  message: string;
  correlationId: string;
}

export class IngressError extends Error {
  readonly code: string;
  readonly status: number;
  readonly correlationId: string;
  constructor(code: string, message: string, status: number, correlationId: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.correlationId = correlationId;
  }
  toBody(): ErrorBody {
    return { code: this.code, message: this.message, correlationId: this.correlationId };
  }
}
