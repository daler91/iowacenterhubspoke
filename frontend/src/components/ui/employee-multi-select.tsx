import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { Checkbox } from './checkbox';
import { ChevronsUpDown, X } from 'lucide-react';
import type { Employee } from '../../lib/types';

interface EmployeeMultiSelectProps {
  readonly id?: string;
  readonly employees: Employee[];
  readonly selectedIds: string[];
  readonly onSelectionChange: (ids: string[]) => void;
  readonly "aria-invalid"?: boolean;
}

export function EmployeeMultiSelect({
  id,
  employees,
  selectedIds,
  onSelectionChange,
  "aria-invalid": ariaInvalid,
}: Readonly<EmployeeMultiSelectProps>) {
  const [open, setOpen] = useState(false);
  const listboxId = id ? `${id}-listbox` : undefined;

  const toggle = (innerId: string) => {
    onSelectionChange(
      selectedIds.includes(innerId)
        ? selectedIds.filter(x => x !== innerId)
        : [...selectedIds, innerId]
    );
  };

  const removeEmployee = (innerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectionChange(selectedIds.filter(x => x !== innerId));
  };

  const selectedEmployees = (employees || []).filter(e => selectedIds.includes(e.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* role="combobox" is correct for this filter-as-you-type multi-select
            (Radix Popover + Command). Native <select multiple> doesn't
            support incremental search, custom chips, or per-option colors,
            so Sonar's "prefer native" suggestion isn't applicable here. */}
        <button
          type="button"
          id={id}
          data-testid="schedule-employee-select"
          role="combobox" // NOSONAR(S6819)
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-invalid={ariaInvalid || undefined}
          className="flex min-h-[40px] w-full items-center justify-between rounded-lg border border-input bg-gray-50/50 px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 aria-invalid:border-danger aria-invalid:ring-danger"
        >
          <div className="flex flex-wrap gap-1 flex-1">
            {selectedEmployees.length === 0 && (
              <span className="text-muted-foreground">Select employees...</span>
            )}
            {selectedEmployees.map(emp => (
              <span
                key={emp.id}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-xs font-medium text-indigo-700"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: emp.color }} />
                {emp.name}
                <button
                  type="button"
                  onClick={(e) => removeEmployee(emp.id, e)}
                  className="ml-0.5 hover:text-indigo-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search employees..." />
          <CommandList id={listboxId}>
            <CommandEmpty>No employees found.</CommandEmpty>
            <CommandGroup>
              {(employees || []).map(emp => {
                const isSelected = selectedIds.includes(emp.id);
                return (
                  <CommandItem
                    key={emp.id}
                    value={emp.name}
                    onSelect={() => toggle(emp.id)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={isSelected}
                      className="pointer-events-none"
                    />
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: emp.color }} />
                    <span>{emp.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
