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

// FastAPI emits ``detail: [{loc, msg, type}, ...]`` on 422 validation
// failures. Surface the first entry as "<field> — <msg>" so users see
// which field is wrong instead of a generic status message.
function extractPydanticFieldError(detail: readonly unknown[]): string | null {
  if (detail.length === 0) return null;
  const first = detail[0] as { loc?: unknown[]; msg?: string };
  const msg = typeof first.msg === 'string' ? first.msg : null;
  if (!msg) return null;
  const loc = first.loc;
  if (!Array.isArray(loc) || loc.length === 0) return msg;
  const last = loc[loc.length - 1];
  const field = typeof last === 'string' || typeof last === 'number' ? String(last) : '';
  return field ? `${field} — ${msg}` : msg;
}

function extractDetail(err: AxiosLikeError): string | null {
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) return extractPydanticFieldError(detail);
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

// Upload flows have richer failure modes than a generic JSON POST:
// the browser may hit a proxy-level 413 before reaching our handler,
// timeouts feel different when a file is in flight, and 400s almost
// always mean "wrong file type." Layer those hints on top of the base
// describer — always prefer the server's ``detail`` when present so we
// don't override real error text like "File too large (10 MB max)".
export function describeUploadError(
  err: unknown,
  fallback: string = 'Upload failed',
): string {
  if (!err || typeof err !== 'object') return fallback;
  const e = err as AxiosLikeError;

  if (!e.response) {
    if (e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED') {
      return 'Upload interrupted — check your connection and try again. Larger files take longer.';
    }
    return e.message || fallback;
  }

  const detail = extractDetail(e);
  if (detail) return detail;

  const status = e.response.status;
  if (status === 413) {
    return 'File too large (10 MB max) — pick a smaller file or compress it.';
  }
  if (status === 400) {
    return "That file type isn't supported. Use PDF, image, Word, Excel, CSV, or plain text.";
  }
  if (status === 404) {
    return 'That item no longer exists — it may have been deleted.';
  }
  if (status && GENERIC_BY_STATUS[status]) return GENERIC_BY_STATUS[status];
  return fallback;
}
