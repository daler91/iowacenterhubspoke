import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

interface ShortcutCheatsheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

// Keep SHORTCUTS in sync with the actual useHotkey registrations in
// DashboardPage. The cheatsheet is the canonical reference surfaced
// to users, so drift = quiet UX regression.
const SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: 'N', label: 'New schedule' },
  { keys: '?', label: 'Show keyboard shortcuts' },
  { keys: 'Esc', label: 'Close the active dialog or popover' },
];

export default function ShortcutCheatsheet({ open, onOpenChange }: ShortcutCheatsheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="shortcut-cheatsheet">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Available anywhere in the app. Shortcuts are ignored while you're typing into a text field.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border">
          {SHORTCUTS.map(({ keys, label }) => (
            <li key={keys} className="flex items-center justify-between py-2 text-sm">
              <span className="text-foreground">{label}</span>
              <kbd className="inline-flex min-w-[28px] justify-center rounded-md border border-border bg-muted/50 dark:bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
                {keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
