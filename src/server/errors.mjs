import { ZodError } from "zod";
export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
// Keep actionable public errors, never expose raw paths, credentials or provider bodies.
const unsafe =
  /(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|(?:password|secret|api[_ -]?key|token)["']?\s*[:=]\s*["']?\S+|(?:postgres(?:ql)?|redis):\/\/|(?:\/(?:[^\s/]+\/)+[^\s]+|[A-Za-z]:\\[^\s]+)|\n\s*at\s|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/i;
export function safeErrorMessage(message, status = 500) {
  const text = String(message || "");
  if (!text || unsafe.test(text) || text.length > 600)
    return status >= 500
      ? "The request could not be completed. Please retry or contact your administrator."
      : "The request could not be completed. Check the submitted values.";
  return text.replace(/\0/g, "");
}
export function publicError(error, requestId) {
  if (error instanceof ZodError)
    error = new AppError(
      "VALIDATION_ERROR",
      "Submitted values are invalid.",
      400,
    );
  const status =
    Number.isInteger(error?.status) &&
    error.status >= 400 &&
    error.status <= 599
      ? error.status
      : 500;
  return {
    status,
    body: {
      error: {
        code:
          error instanceof AppError
            ? error.code
            : status < 500
              ? "BAD_REQUEST"
              : "INTERNAL_ERROR",
        message:
          error instanceof AppError || status < 500
            ? safeErrorMessage(error.message, status)
            : "Internal server error",
        requestId,
      },
    },
  };
}
