import { useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { schedulesAPI } from '../lib/api';
import { toast } from 'sonner';

const AVAILABLE_FIELDS = [
  { id: 'date', label: 'Date' },
  { id: 'start_time', label: 'Start Time' },
  { id: 'end_time', label: 'End Time' },
  { id: 'employee_name', label: 'Employee Name' },
  { id: 'employee_email', label: 'Employee Email' },
  { id: 'location_name', label: 'Location Name' },
  { id: 'class_name', label: 'Class Name' },
  { id: 'status', label: 'Status' },
  { id: 'notes', label: 'Notes' },
];

export default function ExportCsvDialog({ open, onOpenChange, currentFilters }) {
  const [selectedFields, setSelectedFields] = useState([
    'date', 'start_time', 'end_time', 'employee_name', 'location_name', 'status'
  ]);
  const [isExporting, setIsExporting] = useState(false);

  const toggleField = (fieldId) => {
    setSelectedFields((prev) =>
      prev.includes(fieldId)
        ? prev.filter(f => f !== fieldId)
        : [...prev, fieldId]
    );
  };

  const handleExport = async () => {
    if (selectedFields.length === 0) {
      toast.error('Please select at least one field to export');
      return;
    }

    setIsExporting(true);
    try {
      const params = {
        ...currentFilters,
        fields: selectedFields.join(','),
      };

      const response = await schedulesAPI.exportCsv(params);

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;

      const contentDisposition = response.headers['content-disposition'];
      let fileName = 'schedules_export.csv';
      if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
        if (fileNameMatch && fileNameMatch.length === 2) {
          fileName = fileNameMatch[1];
        }
      }

      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      onOpenChange(false);
      toast.success('Export completed successfully');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export schedules');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export Schedules to CSV</DialogTitle>
          <DialogDescription>
            Select the fields you want to include in the exported CSV file. The current calendar filters will be applied to the export.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="space-y-2">
            <h4 className="font-medium text-sm mb-3">Columns to Export</h4>
            <div className="grid grid-cols-2 gap-3">
              {AVAILABLE_FIELDS.map((field) => (
                <div key={field.id} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id={`field-${field.id}`}
                    checked={selectedFields.includes(field.id)}
                    onChange={() => toggleField(field.id)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <label
                    htmlFor={`field-${field.id}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {field.label}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting || selectedFields.length === 0}>
            {isExporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
