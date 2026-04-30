import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { MessageSquare, Reply, Send, X } from 'lucide-react';
import MentionTextarea, { renderMentionBody } from '../coordination/MentionTextarea';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { type Mention, type ProjectMember, type TaskComment } from '../../lib/coordination-types';

function formatCommentDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: '2-digit',
  });
}

function groupCommentsByDate(comments: TaskComment[]) {
  return comments.reduce<Array<{ date: string; items: TaskComment[] }>>((acc, item) => {
    const d = formatCommentDate(item.created_at);
    const last = acc.at(-1);
    if (!last || last.date !== d) acc.push({ date: d, items: [item] });
    else last.items.push(item);
    return acc;
  }, []);
}

function buildChildrenMap(comments: TaskComment[]) {
  const ids = new Set(comments.map(c => c.id));
  const map = new Map<string | null, TaskComment[]>();
  for (const c of comments) {
    const parent = c.parent_comment_id && ids.has(c.parent_comment_id)
      ? c.parent_comment_id
      : null;
    const bucket = map.get(parent) ?? [];
    bucket.push(c);
    map.set(parent, bucket);
  }
  for (const bucket of map.values()) bucket.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return map;
}

function collectDescendants(rootId: string, childrenMap: Map<string | null, TaskComment[]>) {
  const queue = [...(childrenMap.get(rootId) ?? [])];
  const flattened: TaskComment[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    flattened.push(current);
    queue.push(...(childrenMap.get(current.id) ?? []));
  }
  return flattened.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 45_000) return 'just now';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatCommentDate(iso);
}

function CommentNode({ comment, isRoot, onReply, parentDate }: Readonly<{ comment: TaskComment; isRoot: boolean; onReply?: (c: TaskComment) => void; parentDate: string }>) {
  const ownDate = formatCommentDate(comment.created_at);
  const time = new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const crossesDayBoundary = ownDate !== parentDate;
  return (
    <div id={`comment-${comment.id}`} className="flex gap-2 mb-3">
      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 mt-0.5', comment.sender_type === 'partner' ? 'bg-ownership-partner-soft text-ownership-partner-strong' : 'bg-ownership-internal-soft text-ownership-internal-strong')}>
        {(comment.sender_name || '?').charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-semibold text-foreground">{comment.sender_name}</span>
          <span className="text-[10px] text-muted-foreground">{crossesDayBoundary ? `${ownDate} · ${time}` : time}</span>
          {isRoot && onReply && (
            <button type="button" onClick={() => onReply(comment)} className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-hub hover:text-hub-strong dark:text-hub-soft dark:hover:text-hub-soft px-1.5 py-0.5 rounded hover:bg-hub-soft dark:hover:bg-hub-soft/30 transition-colors" aria-label={`Reply to ${comment.sender_name}`}>
              <Reply className="w-3 h-3" /> Reply
            </button>
          )}
        </div>
        <p className="text-xs text-foreground/80 dark:text-muted-foreground mt-0.5 leading-relaxed whitespace-pre-wrap">{renderMentionBody(comment.body, comment.mentions)}</p>
      </div>
    </div>
  );
}

function ThreadSummary({ descendants, onExpand }: Readonly<{ descendants: TaskComment[]; onExpand: () => void }>) {
  const seen = new Set<string>();
  const avatars: TaskComment[] = [];
  for (const d of descendants) {
    const key = d.sender_id || d.sender_name;
    if (seen.has(key)) continue;
    seen.add(key);
    avatars.push(d);
    if (avatars.length === 3) break;
  }
  const last = descendants.at(-1);
  const count = descendants.length;
  return (
    <button type="button" onClick={onExpand} className="group ml-9 mb-3 -mt-1 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[11px] text-hub-strong hover:bg-hub-soft dark:hover:bg-hub-soft/30 transition-colors">
      <div className="flex -space-x-1.5">{avatars.map(a => <span key={a.id} className={cn('w-5 h-5 rounded-md border border-white dark:border-card flex items-center justify-center text-[9px] font-semibold', a.sender_type === 'partner' ? 'bg-ownership-partner-soft text-ownership-partner-strong' : 'bg-ownership-internal-soft text-ownership-internal-strong')}>{(a.sender_name || '?').charAt(0).toUpperCase()}</span>)}</div>
      <span className="font-semibold group-hover:underline">{count} {count === 1 ? 'reply' : 'replies'}</span>
      {last && <span className="text-[10px] text-muted-foreground font-normal">Last reply {timeAgo(last.created_at)}</span>}
    </button>
  );
}

function ConversationsPanel({ comments, members, onPostComment }: Readonly<{ comments: TaskComment[]; members: readonly ProjectMember[]; onPostComment: (body: string, parentCommentId?: string | null, mentions?: Mention[]) => Promise<string | null | void> }>) {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<TaskComment | null>(null);
  const [lastPostedId, setLastPostedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);
  const childrenMap = buildChildrenMap(comments);
  const roots = childrenMap.get(null) ?? [];
  const groups = groupCommentsByDate(roots);

  const openThread = (rootId: string) => setExpanded(prev => prev.has(rootId) ? prev : new Set([...prev, rootId]));
  const toggleThread = (rootId: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(rootId)) next.delete(rootId); else next.add(rootId);
    return next;
  });

  useEffect(() => {
    if (lastPostedId) {
      const el = document.getElementById(`comment-${lastPostedId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setLastPostedId(null);
        return;
      }
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length, lastPostedId]);

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const target = replyingTo;
      const newId = await onPostComment(body.trim(), target?.id ?? null, mentions);
      setBody('');
      setMentions([]);
      setReplyingTo(null);
      if (target) openThread(target.id);
      if (typeof newId === 'string') setLastPostedId(newId);
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="lg:w-[360px] lg:shrink-0 border-l-4 border-hub-soft dark:border-hub-soft/70 bg-gradient-to-b from-hub-soft/80 via-white to-muted/50 dark:from-hub-soft/30 dark:via-card/60 dark:to-card/80 shadow-[inset_6px_0_12px_-6px_rgba(99,102,241,0.25)] dark:shadow-[inset_6px_0_12px_-6px_rgba(99,102,241,0.35)] flex flex-col rounded-xl">
      <header className="px-4 py-3 border-b border-hub-soft/70 dark:border-hub-soft/50 bg-white/70 dark:bg-card/50 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-hub-soft/50 flex items-center justify-center"><MessageSquare className="w-3.5 h-3.5 text-hub-strong" /></div>
        <h2 className="text-base font-semibold text-foreground">Conversations</h2>
        {comments.length > 0 && <span className="text-[10px] font-bold text-hub-strong dark:text-hub-soft bg-hub-soft/50 px-1.5 py-0.5 rounded-full">{comments.length}</span>}
      </header>
      <section className="flex-1 overflow-y-auto px-3 py-3 max-h-[22rem] lg:max-h-[30rem]">
        {groups.length === 0 ? <div className="flex items-center justify-center h-full min-h-[200px]"><p className="text-xs text-muted-foreground">No messages yet</p></div> : groups.map(group => <div key={group.date}><div className="flex items-center gap-2 my-3"><div className="flex-1 h-px bg-muted" /><span className="text-[10px] text-muted-foreground font-medium">{group.date}</span><div className="flex-1 h-px bg-muted" /></div>{group.items.map(root => {
          const descendants = collectDescendants(root.id, childrenMap);
          const hasReplies = descendants.length > 0;
          const isExpanded = expanded.has(root.id);
          const rootDate = formatCommentDate(root.created_at);
          return <div key={root.id} className={cn('rounded-lg mb-2 transition-colors', hasReplies && 'bg-white/60 dark:bg-card/40 border border-border p-2')}><CommentNode comment={root} isRoot onReply={(c) => { setReplyingTo(c); openThread(c.id); }} parentDate={group.date} />
            {hasReplies && !isExpanded && <ThreadSummary descendants={descendants} onExpand={() => toggleThread(root.id)} />}
            {hasReplies && isExpanded && <div className="ml-4 border-l border-hub-soft dark:border-hub-soft/50 pl-3 mt-1">{descendants.map(d => <CommentNode key={d.id} comment={d} isRoot={false} parentDate={rootDate} />)}<button type="button" onClick={() => toggleThread(root.id)} className="text-[10px] font-medium text-hub hover:text-hub-strong dark:text-hub-soft dark:hover:text-hub-soft hover:underline mb-1">Hide replies</button></div>}
          </div>;
        })}</div>)}
        <div ref={endRef} />
      </section>
      <footer className="p-3 border-t border-border">
        {replyingTo && <div className="flex items-center gap-1.5 mb-2 px-2.5 py-1 rounded-full bg-hub-soft/30 border border-hub-soft dark:border-hub-soft/60 text-[11px] text-hub-strong dark:text-hub-soft w-fit max-w-full"><Reply className="w-3 h-3 shrink-0" /><span className="truncate">Replying to <span className="font-semibold">{replyingTo.sender_name}</span></span><button type="button" onClick={() => setReplyingTo(null)} className="ml-0.5 p-0.5 rounded hover:bg-hub-soft dark:hover:bg-hub-soft/60 transition-colors shrink-0" aria-label="Cancel reply"><X className="w-3 h-3" /></button></div>}
        <div className="flex items-center gap-2 rounded-full border-2 border-hub-soft dark:border-hub-soft/60 focus-within:border-hub-soft dark:focus-within:border-hub bg-white dark:bg-card pl-4 pr-1.5 py-1 transition-colors">
          <MentionTextarea value={body} mentions={mentions} members={members} onChange={(b, m) => { setBody(b); setMentions(m); }} onSubmit={handleSend} placeholder={replyingTo ? `Reply to ${replyingTo.sender_name}...` : 'Type a message — @ to mention...'} />
          <Button size="icon" onClick={handleSend} disabled={sending || !body.trim()} className="rounded-full bg-hub hover:bg-hub-strong text-white h-8 w-8 shrink-0" aria-label="Send message"><Send className="w-3.5 h-3.5" aria-hidden="true" /></Button>
        </div>
      </footer>
    </div>
  );
}


export default ConversationsPanel;
