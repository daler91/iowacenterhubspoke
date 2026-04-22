import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly projectTitle: string;
}

export default function DeleteProjectDialog({ open, onOpenChange, onConfirm, projectTitle }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-danger" />
            Delete Project
          </AlertDialogTitle>
          <AlertDialogDescription>
            Deleting &quot;{projectTitle}&quot; will also remove its tasks, documents,
            messages, and outcomes. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-danger hover:bg-danger/90 text-white"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
