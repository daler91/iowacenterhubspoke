import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { KeyboardEvent, ChangeEvent, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { Mention, ProjectMember } from '../../lib/coordination-types';

// Tokens are encoded inline in the body as ``@[Display Name](user:ID:kind)``.
// The backend ignores the name and only uses the companion ``mentions`` array,
// but keeping the display name in the body means legacy clients that don't
// understand the companion array still render something sensible.
const MENTION_TOKEN_RE = /@\[([^\]]+)\]\(user:([^:)]+):(internal|partner)\)/g;

export function encodeMentionToken(m: Mention): string {
  return `@[${m.name}](user:${m.id}:${m.kind})`;
}

// Render a body string into React nodes, replacing mention tokens with
// styled chips. Falls back to the raw body when no tokens are present —
// that covers messages posted before tokenization shipped (we stored the
// plain ``@Name`` text then).
export function renderMentionBody(body: string, _mentions?: Mention[]): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let keyIdx = 0;
  for (const m of body.matchAll(MENTION_TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(body.slice(last, start));
    out.push(
      <span
        key={`mention-${keyIdx++}`}
        className="inline-flex items-center rounded px-1 py-0 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-medium"
      >
        @{m[1]}
      </span>,
    );
    last = start + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out.length > 0 ? out : [body];
}

interface Props {
  readonly value: string;
  readonly mentions: Mention[];
  readonly members: readonly ProjectMember[];
  readonly onChange: (body: string, mentions: Mention[]) => void;
  readonly onSubmit?: () => void;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly className?: string;
  readonly textareaClassName?: string;
  readonly disabled?: boolean;
}

interface TriggerState {
  // The @ index in the current body. Stays fixed while the user types the
  // search query so we know exactly which range to replace on accept.
  start: number;
  // Current search (text after the @, up to the caret).
  query: string;
}

// Members are sorted alphabetically then filtered by a simple
// case-insensitive "starts-with-or-contains" match against name/email, so the
// best candidates bubble to the top.
function filterMembers(members: readonly ProjectMember[], query: string): ProjectMember[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...members];
  return members.filter(m => {
    const name = (m.name || '').toLowerCase();
    const email = (m.email || '').toLowerCase();
    return name.includes(q) || email.includes(q);
  });
}

export default function MentionTextarea({
  value, mentions, members, onChange, onSubmit,
  placeholder, rows = 1, className, textareaClassName, disabled,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = useMemo(
    () => (trigger ? filterMembers(members, trigger.query).slice(0, 8) : []),
    [trigger, members],
  );

  // Keep active highlight inside the visible set as the query narrows.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  // Detect whether the caret is inside an active ``@query`` run. We scan
  // backwards from the caret until we hit whitespace or an @; if the last
  // character we hit is @, we're in a mention trigger.
  const detectTrigger = useCallback((body: string, caret: number): TriggerState | null => {
    for (let i = caret - 1; i >= 0; i -= 1) {
      const ch = body[i];
      if (ch === '@') {
        // Must be at start of text or preceded by whitespace to avoid matching
        // emails and mid-word @ characters.
        const prev = i > 0 ? body[i - 1] : ' ';
        if (/\s/.test(prev) || i === 0) {
          return { start: i, query: body.slice(i + 1, caret) };
        }
        return null;
      }
      if (/\s/.test(ch)) return null;
    }
    return null;
  }, []);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    const caret = e.target.selectionStart ?? next.length;
    // Drop mention entries whose token no longer appears in the body so the
    // companion array never diverges from the visible content.
    const stillPresent = mentions.filter(m =>
      next.includes(encodeMentionToken(m)),
    );
    onChange(next, stillPresent);
    setTrigger(detectTrigger(next, caret));
    setActiveIdx(0);
  };

  const acceptMember = (member: ProjectMember) => {
    if (!trigger || !textareaRef.current) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice(trigger.start + 1 + trigger.query.length);
    const mention: Mention = { id: member.id, kind: member.kind, name: member.name };
    const token = encodeMentionToken(mention);
    const next = `${before}${token} ${after}`;
    const newMentions = mentions.some(m => m.id === mention.id && m.kind === mention.kind)
      ? mentions
      : [...mentions, mention];
    onChange(next, newMentions);
    setTrigger(null);
    // Move the caret past the inserted token + trailing space.
    const caret = before.length + token.length + 1;
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(caret, caret);
      }
    });
  };

  // Split the popover-navigation branches out so the top-level keydown
  // handler stays flat — otherwise the nested conditions push cognitive
  // complexity over Sonar's threshold.
  const handlePopoverKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const n = filtered.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIdx(i => (i + 1) % n);
        return true;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIdx(i => (i - 1 + n) % n);
        return true;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        acceptMember(filtered[activeIdx]);
        return true;
      case 'Escape':
        e.preventDefault();
        setTrigger(null);
        return true;
      default:
        return false;
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (trigger && filtered.length > 0 && handlePopoverKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className={cn('relative flex-1', className)}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Small delay so a click on a popover option lands before we close.
          setTimeout(() => setTrigger(null), 120);
        }}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={cn(
          'w-full bg-transparent border-0 outline-none resize-none py-1.5 placeholder:text-slate-400 text-sm',
          textareaClassName,
        )}
      />
      {trigger && filtered.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-1 w-64 max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-50"
          role="listbox"
          aria-label="Mention a project member"
        >
          {filtered.map((m, idx) => (
            <button
              key={`${m.kind}:${m.id}`}
              type="button"
              // onMouseDown (not onClick) so the textarea's onBlur delay isn't
              // required to commit the selection — mousedown fires before blur.
              onMouseDown={(e) => { e.preventDefault(); acceptMember(m); }}
              onMouseEnter={() => setActiveIdx(idx)}
              role="option"
              aria-selected={idx === activeIdx}
              className={cn(
                'w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs',
                idx === activeIdx
                  ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800',
              )}
            >
              <span className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold shrink-0',
                m.kind === 'partner'
                  ? 'bg-ownership-partner-soft text-ownership-partner'
                  : 'bg-ownership-internal-soft text-ownership-internal',
              )}>
                {(m.name || '?').charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 truncate font-medium">{m.name}</span>
              <span className="text-[9px] uppercase tracking-wide text-slate-400">
                {m.kind}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
