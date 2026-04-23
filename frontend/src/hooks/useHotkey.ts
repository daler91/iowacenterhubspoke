import { useEffect } from 'react';

/**
 * Global single-key hotkey subscriber. Fires the handler when the
 * user presses `key` anywhere in the app, except while focus is in a
 * text input (input / textarea / contentEditable) or a modifier
 * (Ctrl / Meta / Alt) is held — those cases let the underlying
 * editor/shortcut handle the press unchanged.
 *
 * The key match is case-insensitive and compares KeyboardEvent.key.
 * Pass `"?"` to catch the literal question-mark character (Shift+`/`
 * in US layouts) — we do match `event.key`, so the modifier check
 * below explicitly allows Shift when the target key itself is `?`.
 */
export function useHotkey(
  key: string,
  handler: (event: KeyboardEvent) => void,
  options: { enabled?: boolean } = {},
): void {
  const { enabled = true } = options;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Ignore hotkeys while the user is typing into any editable field.
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }
      // Skip when modifier keys (except Shift, which is needed for `?`
      // on US layouts) are held — Ctrl+N shouldn't trigger plain "n".
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() !== key.toLowerCase()) return;
      event.preventDefault();
      handler(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [key, handler, enabled]);
}
