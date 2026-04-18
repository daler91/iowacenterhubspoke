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
  const errorMessageId = id ? `${id}-error` : undefined;

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
        {/* Disclosure button opening a listbox popup. We stick with the
            default button role rather than role="combobox" — lint rules
            balk at aria-invalid on a plain button role, and Sonar rejects
            combobox in favor of native select. Invalidity is signalled
            visually via data-invalid + an aria-describedby pointer at the
            error message rendered by the parent form. */}
        <button
          type="button"
          id={id}
          data-testid="schedule-employee-select"
          data-invalid={ariaInvalid ? "true" : undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-describedby={ariaInvalid ? errorMessageId : undefined}
          className="flex min-h-[40px] w-full items-center justify-between rounded-lg border border-input bg-gray-50/50 px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 data-[invalid=true]:border-danger data-[invalid=true]:ring-danger data-[invalid=true]:ring-2"
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
                  aria-label={`Remove ${emp.name}`}
                  className="ml-0.5 hover:text-indigo-900"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
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
