import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import type { PreviewKind } from '../../lib/attachment-preview';

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly filename: string;
  /**
   * Author-supplied description used as the image's accessible alt text.
   * Prefer this over `filename` so screen-reader users hear what's in
   * the picture instead of "screenshot-2025-04-03-14-22-01.png". Falls
   * back to a filename-derived description when no caption is available.
   */
  readonly caption?: string;
  readonly kind: PreviewKind;
  readonly url: string;
}

export default function AttachmentPreviewDialog({
  open,
  onOpenChange,
  filename,
  caption,
  kind,
  url,
}: Props) {
  const describedName = caption?.trim() || `Attachment: ${filename}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[92vw] h-[88vh] p-0 gap-0 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <DialogTitle className="text-sm font-semibold truncate pr-8">
            {filename}
          </DialogTitle>
        </div>
        <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
          {kind === 'pdf' ? (
            <iframe
              src={url}
              title={`Preview of ${describedName}`}
              className="w-full h-full border-0 bg-white"
            />
          ) : (
            <img
              src={url}
              alt={describedName}
              className="max-w-full max-h-full object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
