import { useState } from 'react';
import PropTypes from 'prop-types';
import { Trash2, UserCog, ChevronDown, X, MapPin, BookOpen } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';
import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';
import { SCHEDULE_STATUS } from '../lib/constants';

export default function BulkActionBar({ selectedCount, selectedIds, onComplete, onDeselectAll, employees, locations, classes }) {
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const ids = Array.from(selectedIds);

  const handleBulkDelete = async () => {
    setLoading(true);
    try {
      const res = await schedulesAPI.bulkDelete(ids);
      toast.success(`Deleted ${res.data.deleted_count} schedule(s)`);
      onComplete();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete schedules');
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  const handleBulkStatus = async (status) => {
    setLoading(true);
    try {
      const res = await schedulesAPI.bulkUpdateStatus(ids, status);
      toast.success(`Updated ${res.data.updated_count} schedule(s) to ${status.replace('_', ' ')}`);
      onComplete();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkReassign = async (employeeId, employeeName) => {
    setLoading(true);
    try {
      const res = await schedulesAPI.bulkReassign(ids, employeeId);
      toast.success(`Reassigned ${res.data.updated_count} schedule(s) to ${employeeName}`);
      onComplete();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to reassign schedules');
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  const handleBulkLocation = async (locationId, locationName) => {
    setLoading(true);
    try {
      const res = await schedulesAPI.bulkUpdateLocation(ids, locationId);
      toast.success(`Updated ${res.data.updated_count} schedule(s) to ${locationName}`);
      onComplete();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update location');
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  const handleBulkClass = async (classId, className) => {
    setLoading(true);
    try {
      const res = await schedulesAPI.bulkUpdateClass(ids, classId);
      toast.success(`Updated ${res.data.updated_count} schedule(s) to ${className}`);
      onComplete();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update class');
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg px-6 py-3 animate-in slide-in-from-bottom-2 duration-200">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-sm px-3 py-1">
              {selectedCount} selected
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDeselectAll}
              className="text-slate-500 hover:text-slate-700"
            >
              <X className="w-4 h-4 mr-1" />
              Deselect All
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {/* Status dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={loading}>
                  Status
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Set status to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleBulkStatus(SCHEDULE_STATUS.UPCOMING)}>
                  Upcoming
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkStatus(SCHEDULE_STATUS.IN_PROGRESS)}>
                  In Progress
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkStatus(SCHEDULE_STATUS.COMPLETED)}>
                  Completed
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Reassign dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={loading}>
                  <UserCog className="w-4 h-4 mr-1" />
                  Reassign
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-60 overflow-y-auto">
                <DropdownMenuLabel>Reassign to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(employees || []).map(emp => (
                  <DropdownMenuItem
                    key={emp.id}
                    onClick={() => setConfirmAction({
                      type: 'reassign',
                      label: `Reassign ${selectedCount} schedule(s) to ${emp.name}?`,
                      description: `All selected schedules will be assigned to ${emp.name}.`,
                      onConfirm: () => handleBulkReassign(emp.id, emp.name),
                    })}
                  >
                    <div
                      className="w-3 h-3 rounded-full mr-2 shrink-0"
                      style={{ backgroundColor: emp.color || '#4F46E5' }}
                    />
                    {emp.name}
                  </DropdownMenuItem>
                ))}
                {(!employees || employees.length === 0) && (
                  <DropdownMenuItem disabled>No employees available</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Location dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={loading}>
                  <MapPin className="w-4 h-4 mr-1" />
                  Location
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-60 overflow-y-auto">
                <DropdownMenuLabel>Change location to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(locations || []).map(loc => (
                  <DropdownMenuItem
                    key={loc.id}
                    onClick={() => setConfirmAction({
                      type: 'location',
                      label: `Change location for ${selectedCount} schedule(s) to ${loc.city_name}?`,
                      description: `All selected schedules will be moved to ${loc.city_name}.`,
                      onConfirm: () => handleBulkLocation(loc.id, loc.city_name),
                    })}
                  >
                    {loc.city_name}
                  </DropdownMenuItem>
                ))}
                {(!locations || locations.length === 0) && (
                  <DropdownMenuItem disabled>No locations available</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Class dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={loading}>
                  <BookOpen className="w-4 h-4 mr-1" />
                  Class
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-60 overflow-y-auto">
                <DropdownMenuLabel>Change class to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(classes || []).map(cls => (
                  <DropdownMenuItem
                    key={cls.id}
                    onClick={() => setConfirmAction({
                      type: 'class',
                      label: `Change class for ${selectedCount} schedule(s) to ${cls.name}?`,
                      description: `All selected schedules will be updated to class ${cls.name}.`,
                      onConfirm: () => handleBulkClass(cls.id, cls.name),
                    })}
                  >
                    <div
                      className="w-3 h-3 rounded-full mr-2 shrink-0"
                      style={{ backgroundColor: cls.color || '#0F766E' }}
                    />
                    {cls.name}
                  </DropdownMenuItem>
                ))}
                {(!classes || classes.length === 0) && (
                  <DropdownMenuItem disabled>No classes available</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Delete button */}
            <Button
              variant="destructive"
              size="sm"
              disabled={loading}
              onClick={() => setConfirmAction({
                type: 'delete',
                label: `Delete ${selectedCount} schedule(s)?`,
                description: 'This will remove the selected schedules. This action can be undone by an administrator.',
                onConfirm: handleBulkDelete,
              })}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.label}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={(e) => { e.preventDefault(); confirmAction?.onConfirm(); }}
              className={confirmAction?.type === 'delete' ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              {(() => {
                let buttonLabel;
                if (loading) {
                  buttonLabel = 'Processing...';
                } else if (confirmAction?.type === 'delete') {
                  buttonLabel = 'Delete';
                } else {
                  buttonLabel = 'Reassign';
                }
                return buttonLabel;
              })()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

BulkActionBar.propTypes = {
  selectedCount: PropTypes.number.isRequired,
  selectedIds: PropTypes.instanceOf(Set).isRequired,
  onComplete: PropTypes.func.isRequired,
  onDeselectAll: PropTypes.func.isRequired,
  employees: PropTypes.array,
  locations: PropTypes.array,
  classes: PropTypes.array,
};
