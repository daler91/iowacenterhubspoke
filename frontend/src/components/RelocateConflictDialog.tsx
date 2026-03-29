import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';

interface ConflictData {
  scheduleId: string;
  newDate: string;
  newStart: string;
  newEnd: string;
  conflicts: Array<{
    schedule_id?: string;
    location: string;
    time: string;
    overlap: string;
  }>;
}

interface RelocateConflictDialogProps {
  data: ConflictData | null;
  onClose: () => void;
  onForce: () => void;
}

export default function RelocateConflictDialog({ data, onClose, onForce }: Readonly<RelocateConflictDialogProps>) {
  return (
    <Dialog open={data !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[480px] bg-white" data-testid="relocate-conflict-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Schedule Conflict Detected
          </DialogTitle>
          <DialogDescription>
            Moving this schedule would create a conflict with existing schedules. You can force the move or cancel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {(data?.conflicts || []).map((conflict, i) => (
            <div key={conflict.schedule_id || i} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm font-medium text-amber-800">{conflict.location}</p>
              <p className="text-xs text-amber-600">{conflict.time}</p>
              <p className="text-xs text-amber-500 mt-1">{conflict.overlap}</p>
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            data-testid="relocate-conflict-cancel"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="relocate-conflict-force"
            onClick={onForce}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Force Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
