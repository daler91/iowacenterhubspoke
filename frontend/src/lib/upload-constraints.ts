// Mirror of backend/core/upload.py limits. Keep in sync if the server changes.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_MB = 10;

export const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'txt',
]);

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

// Returns a user-facing reason the file can't be uploaded, or null if it's OK.
export function validateUpload(file: File): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `File too large (${MAX_UPLOAD_MB} MB max) — pick a smaller file or compress it.`;
  }
  const ext = extensionOf(file.name);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    const allowed = [...ALLOWED_EXTENSIONS].join(', ');
    return `Unsupported file type. Allowed: ${allowed}.`;
  }
  return null;
}
