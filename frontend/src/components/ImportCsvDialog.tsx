import { useState, useRef } from 'react';
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
import { describeApiError } from '../lib/error-messages';
import { toast } from 'sonner';
import { Upload, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';

function PreviewResults({ file, previewData, onReset }) {
  const hasErrors = previewData.errors.length > 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-4 bg-muted/50 dark:bg-muted rounded-lg border dark:border-border">
        <div className="flex items-center space-x-3">
          <FileText className="h-6 w-6 text-primary" />
          <div>
            <p className="text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {previewData.total_rows} total rows processed
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Change File
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border bg-spoke-soft border-spoke/30">
          <div className="flex items-center text-spoke mb-2">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            <span className="font-semibold">Valid Rows ({previewData.valid_rows.length})</span>
          </div>
          <p className="text-sm text-spoke">
            These schedules are ready to be imported into the system.
          </p>
        </div>

        <div className={cn(
          "p-4 rounded-lg border",
          hasErrors ? "bg-danger-soft border-danger/30" : "bg-muted/50 dark:bg-muted border-border"
        )}>
          <div className={cn(
            "flex items-center mb-2",
            hasErrors ? "text-danger" : "text-foreground"
          )}>
            {hasErrors ? (
              <XCircle className="h-5 w-5 mr-2" />
            ) : (
              <CheckCircle2 className="h-5 w-5 mr-2" />
            )}
            <span className="font-semibold">Errors ({previewData.errors.length})</span>
          </div>
          <p className={cn(
            "text-sm",
            hasErrors ? "text-danger" : "text-foreground/80 dark:text-muted-foreground"
          )}>
            Rows with errors will be skipped during import.
          </p>
        </div>
      </div>

      {hasErrors && (
        <div className="border rounded-md mt-4 max-h-[300px] overflow-y-auto">
          <div className="bg-danger-soft px-4 py-2 border-b border-danger/20 font-medium text-danger text-sm sticky top-0">
            Error Details
          </div>
          <ul className="divide-y divide-danger/20 text-sm">
            {previewData.errors.slice(0, 50).map((err) => (
              <li key={`row-${err.row}`} className="p-3 bg-white dark:bg-card">
                <div className="font-medium text-foreground mb-1">Row {err.row}</div>
                <ul className="list-disc list-inside text-danger space-y-1 ml-1">
                  {err.errors.map((e) => <li key={`${err.row}-${e}`}>{e}</li>)}
                </ul>
              </li>
            ))}
            {previewData.errors.length > 50 && (
              <li className="p-3 text-center text-muted-foreground italic bg-muted/50 dark:bg-muted">
                ...and {previewData.errors.length - 50} more errors
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}


export default function ImportCsvDialog({ open, onOpenChange, onImportSuccess }) {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
        toast.error('Please upload a valid CSV file');
        return;
      }
      setFile(selectedFile);
      setPreviewData(null); // Reset preview when new file is selected
    }
  };

  const handlePreview = async () => {
    if (!file) return;

    setIsUploading(true);
    try {
      const response = await schedulesAPI.importPreview(file);
      setPreviewData(response.data);
      if (response.data.errors.length > 0) {
        toast.warning(`Found ${response.data.errors.length} rows with errors`);
      } else {
        toast.success(`Successfully parsed ${response.data.valid_rows.length} valid rows`);
      }
    } catch (error) {
      console.error('Preview error:', error);
      toast.error(describeApiError(error, 'Couldn\u2019t process that CSV file \u2014 please check the format and try again.'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleCommit = async () => {
    if (!previewData || previewData.valid_rows.length === 0) return;

    setIsCommitting(true);
    try {
      const response = await schedulesAPI.importCommit(previewData.valid_rows);
      toast.success(`Successfully imported ${response.data.inserted_count} schedules`);

      if (response.data.errors?.length > 0) {
        toast.warning(`${response.data.errors.length} schedules failed to import due to conflicts or missing data`);
      }

      onImportSuccess();
      handleClose();
    } catch (error) {
      console.error('Import commit error:', error);
      toast.error(describeApiError(error, 'Couldn\u2019t import those schedules \u2014 please try again.'));
    } finally {
      setIsCommitting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setPreviewData(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Schedules via CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file containing schedules. The file must contain the following column headers:{' '}
            <strong>date, start_time, end_time, employee_email, location_name</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
          {previewData ? (
            <PreviewResults
              file={file}
              previewData={previewData}
              onReset={() => setPreviewData(null)}
            />
          ) : (
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center flex flex-col items-center justify-center bg-muted/50 dark:bg-muted/50 hover:bg-muted/50 dark:hover:bg-muted transition-colors">
              <Upload className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-sm font-medium text-foreground mb-1">
                {file ? file.name : 'Click to upload or drag and drop'}
              </p>
              <p className="text-xs text-muted-foreground mb-4">CSV files only (max. 10MB)</p>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv"
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Select File
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isUploading || isCommitting}>
            Cancel
          </Button>
          {previewData ? (
            <Button
              onClick={handleCommit}
              disabled={previewData.valid_rows.length === 0 || isCommitting}
            >
              {isCommitting ? 'Importing...' : `Import ${previewData.valid_rows.length} Schedules`}
            </Button>
          ) : (
            <Button
              onClick={handlePreview}
              disabled={!file || isUploading}
            >
              {isUploading ? 'Processing...' : 'Preview Import'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

