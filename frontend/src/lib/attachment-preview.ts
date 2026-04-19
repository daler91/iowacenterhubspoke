// Which attachment file types the in-app previewer can render natively
// (no extra dependency). Kept small on purpose — browsers handle PDFs in
// <iframe> and raster images in <img> without help, but DOCX/XLSX would
// need a server-side converter or a heavy viewer library.

export type PreviewKind = 'pdf' | 'image';

const PDF_EXTS = new Set(['pdf']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif']);

function normalize(fileType: string | null | undefined): string {
  if (!fileType) return '';
  return fileType.trim().toLowerCase().replace(/^\./, '');
}

export function previewKind(fileType: string | null | undefined): PreviewKind | null {
  const ext = normalize(fileType);
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return null;
}

export function canPreview(fileType: string | null | undefined): boolean {
  return previewKind(fileType) !== null;
}
