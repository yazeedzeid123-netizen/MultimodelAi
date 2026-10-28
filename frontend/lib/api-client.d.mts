export type ApiRequestErrorKind = "network" | "http" | "malformed";

export class ApiRequestError extends Error {
  kind: ApiRequestErrorKind;
  retryable: boolean;
  status: number | null;
}

export function postAnalysis(
  formData: FormData,
  options?: { fetchImpl?: typeof fetch; apiBase?: string; maxAttempts?: number }
): Promise<unknown>;