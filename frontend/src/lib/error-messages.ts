// Map common backend errors to actionable messages. When the backend
// returns a ``detail`` string we prefer it (it's already phrased for the
// end user), but surface a friendlier fallback when the detail is empty,
// technical, or a generic 500.

interface AxiosLikeError {
  response?: {
    status?: number;
    data?: {
      detail?: unknown;
      message?: string;
    };
  };
  code?: string;
  message?: string;
}

const GENERIC_BY_STATUS: Record<number, string> = {
  400: "Something in that request wasn't quite right — please double-check the fields.",
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do that.",
  404: "We couldn't find that item — it may have been deleted.",
  409: 'Someone else updated this at the same time. Reload and try again.',
  413: 'The file you uploaded is too large.',
  422: 'Please check the highlighted fields and try again.',
  429: 'Too many requests — give it a moment and try again.',
  500: "Something broke on our end. We've been notified — please try again.",
  502: 'The service is temporarily unavailable. Please try again shortly.',
  503: 'The service is temporarily unavailable. Please try again shortly.',
  504: 'The request timed out. Please try again.',
};

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.';
const NETWORK_MESSAGE = "Can't reach the server — check your connection and try again.";

function extractDetail(err: AxiosLikeError): string | null {
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object') {
    const maybeMessage = (detail as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage;
  }
  const message = err.response?.data?.message;
  if (typeof message === 'string' && message.trim()) return message;
  return null;
}

export function describeApiError(
  err: unknown,
  fallback: string = DEFAULT_MESSAGE,
): string {
  if (!err || typeof err !== 'object') return fallback;
  const e = err as AxiosLikeError;

  // Axios signals network failures with no response + code='ERR_NETWORK'.
  if (!e.response) {
    if (e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED') return NETWORK_MESSAGE;
    return e.message || fallback;
  }

  const detail = extractDetail(e);
  if (detail) return detail;

  const status = e.response.status;
  if (status && GENERIC_BY_STATUS[status]) return GENERIC_BY_STATUS[status];
  return fallback;
}
