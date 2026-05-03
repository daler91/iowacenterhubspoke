export interface NormalizedApiError {
  status: number | null;
  detail: unknown;
  conflicts: Array<Record<string, unknown>>;
  message: string;
}

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

export function normalizeApiError(err: unknown, fallbackMessage: string = FALLBACK_MESSAGE): NormalizedApiError {
  const maybe = err as { response?: { status?: number; data?: { detail?: unknown } }; message?: string };
  const status = maybe?.response?.status ?? null;
  const detail = maybe?.response?.data?.detail;
  const conflicts = (
    typeof detail === 'object' && detail !== null && 'conflicts' in detail
      ? (detail as { conflicts?: Array<Record<string, unknown>> }).conflicts
      : undefined
  ) || [];

  let message = fallbackMessage;
  if (typeof detail === 'string' && detail.trim()) {
    message = detail;
  } else if (typeof maybe?.message === 'string' && maybe.message.trim()) {
    message = maybe.message;
  }

  return { status, detail, conflicts, message };
}
