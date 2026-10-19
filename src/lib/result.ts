// The app's Result type (CLAUDE.md "Async & Error Handling"): async work that
// can fail in an expected way returns one of these instead of throwing.

export type ErrorResult = Readonly<{
  err: unknown;
  msg: string;
}>;

export type Result<T> = Readonly<{
  data?: T;
  error?: ErrorResult;
}>;
