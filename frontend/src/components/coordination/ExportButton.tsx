import { useState } from 'react';
import { Button } from '../ui/button';
import { Download, ChevronDown } from 'lucide-react';

interface Props {
  readonly endpoint: string;
  readonly params?: Record<string, string>;
  readonly label?: string;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

export default function ExportButton({
  endpoint, params = {}, label = 'Export',
}: Props) {
  const [open, setOpen] = useState(false);

  const handleExport = (format: 'csv' | 'xlsx') => {
    const searchParams = new URLSearchParams({ ...params, format });
    const url = `${BACKEND_URL}/api/v1${endpoint}?${searchParams}`;
    window.open(url, '_blank');
    setOpen(false);
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="text-sm"
      >
        <Download className="w-3.5 h-3.5 mr-1" />
        {label}
        <ChevronDown className="w-3 h-3 ml-1" />
      </Button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close export menu"
          />
          <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-900 border rounded-lg shadow-lg z-50 py-1 min-w-[140px]">
            <button
              onClick={() => handleExport('csv')}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Export CSV
            </button>
            <button
              onClick={() => handleExport('xlsx')}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Export Excel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
