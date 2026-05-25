/** JSON value — the wire is JSON; web-abi is zero-dep so this lives here. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A wire error body. Transport errors surface as HTTP status + this shape. */
export interface WireError {
  error: {
    code: string;
    message: string;
  };
}
