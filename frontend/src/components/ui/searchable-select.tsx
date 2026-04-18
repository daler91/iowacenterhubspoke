import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  readonly id?: string;
  readonly options: SearchableSelectOption[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyMessage?: string;
  readonly className?: string;
  readonly 'aria-invalid'?: boolean;
  readonly 'aria-describedby'?: string;
}

export function SearchableSelect({
  id,
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No results found.',
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: Readonly<SearchableSelectProps>) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  // Stable id for the popover's listbox so the trigger can point
  // aria-controls at it. Falls back to undefined when ``id`` isn't supplied.
  const listboxId = id ? `${id}-listbox` : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Disclosure button opening a listbox popup. We stick with the
            default button role rather than role="combobox" — axe flags
            combobox buttons without an external <label>, lint rules balk
            at aria-invalid on a plain button, and Sonar rejects combobox
            in favor of native select. Invalidity is signalled visually
            via data-invalid + aria-describedby on the parent form. The
            selected option label (or placeholder) inside the span is
            the button's accessible name. */}
        <button
          id={id}
          type="button"
          data-invalid={ariaInvalid ? 'true' : undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-describedby={ariaDescribedBy}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-lg border border-input bg-white px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 dark:bg-gray-900 dark:border-gray-700 data-[invalid=true]:border-danger data-[invalid=true]:ring-danger data-[invalid=true]:ring-2',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList id={listboxId}>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onValueChange(option.value === value ? '' : option.value);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0',
                      value === option.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="truncate">{option.label}</span>
                    {option.sublabel && (
                      <span className="text-xs text-muted-foreground ml-1">{option.sublabel}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
