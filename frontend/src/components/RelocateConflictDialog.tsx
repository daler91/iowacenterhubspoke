import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
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
  onForce: (reason: string) => void;
}

export default function RelocateConflictDialog({ data, onClose, onForce }: Readonly<RelocateConflictDialogProps>) {
  const [reason, setReason] = useState('');

  useEffect(() => { if (data) setReason(''); }, [data]);

  return (
    <Dialog open={data !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[480px] bg-white" data-testid="relocate-conflict-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Schedule Conflict Detected
          </DialogTitle>
          <DialogDescription>
            Moving this schedule would create a conflict with existing schedules. Provide a reason to force the move.
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
        <div>
          <Input
            placeholder="Reason for override (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="conflict-override-reason"
          />
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
            onClick={() => onForce(reason)}
            disabled={!reason.trim()}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Force Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
