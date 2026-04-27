import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Megaphone, Mail, Globe, Newspaper, Plus, Check,
} from 'lucide-react';
import api from '../../lib/api';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

interface ChecklistItem {
  id: string;
  channel: string;
  label: string;
  owner: string;
  internal_done: boolean;
  partner_done: boolean;
}

interface Props {
  readonly projectId: string;
}

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  social_media: Megaphone,
  newsletter: Mail,
  website: Globe,
  local_media: Newspaper,
};

export default function PromotionChecklist({ projectId }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  // Imperative focus on the inline-add Input after it mounts, instead
  // of using the `autoFocus` prop (jsx-a11y/no-autofocus).
  const newLabelInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showAdd) newLabelInputRef.current?.focus();
  }, [showAdd]);

  const loadChecklist = useCallback(async () => {
    try {
      const res = await api.get(
        `/projects/${projectId}/promotion-checklist`,
      );
      setItems(res.data.items || []);
    } catch {
      // Checklist might not exist yet for non-promotion phases
    }
  }, [projectId]);

  useEffect(() => { loadChecklist(); }, [loadChecklist]);

  const handleToggle = async (
    itemId: string, side: 'internal' | 'partner',
  ) => {
    try {
      await api.patch(
        `/projects/${projectId}/promotion-checklist/items/${itemId}/toggle`,
        { side },
      );
      loadChecklist();
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleAdd = async () => {
    if (!newLabel.trim()) return;
    try {
      await api.post(
        `/projects/${projectId}/promotion-checklist/items`,
        { channel: 'custom', label: newLabel.trim(), owner: 'both' },
      );
      setNewLabel('');
      setShowAdd(false);
      loadChecklist();
    } catch {
      toast.error('Failed to add item');
    }
  };

  const total = items.length * 2;
  const done = items.reduce(
    (acc, i) => acc + (i.internal_done ? 1 : 0) + (i.partner_done ? 1 : 0),
    0,
  );
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Megaphone className="w-4 h-4" /> Promotion Checklist
        </h3>
        <Button
          size="sm" variant="outline"
          onClick={() => setShowAdd(!showAdd)}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Add
        </Button>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>{done}/{total} completed</span>
          <span>{pct}%</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-progress rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="space-y-2">
        {items.map(item => {
          const Icon = CHANNEL_ICONS[item.channel] || Megaphone;
          return (
            <Card key={item.id} className="p-3">
              <div className="flex items-center gap-3">
                <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm">{item.label}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggle(item.id, 'internal')}
                    aria-label={`Mark "${item.label}" internal side ${item.internal_done ? 'incomplete' : 'done'}`}
                    aria-pressed={item.internal_done}
                    className={cn(
                      'w-6 h-6 rounded border-2 flex items-center justify-center text-xs transition-colors',
                      item.internal_done
                        ? 'bg-ownership-internal border-ownership-internal text-white'
                        : 'border-ownership-internal/40 hover:border-ownership-internal/70',
                    )}
                    title="Internal"
                  >
                    {item.internal_done && <Check className="w-3 h-3" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggle(item.id, 'partner')}
                    aria-label={`Mark "${item.label}" partner side ${item.partner_done ? 'incomplete' : 'done'}`}
                    aria-pressed={item.partner_done}
                    className={cn(
                      'w-6 h-6 rounded border-2 flex items-center justify-center text-xs transition-colors',
                      item.partner_done
                        ? 'bg-ownership-partner border-ownership-partner text-white'
                        : 'border-ownership-partner/40 hover:border-ownership-partner/70',
                    )}
                    title="Partner"
                  >
                    {item.partner_done && <Check className="w-3 h-3" aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-ownership-internal-soft" aria-hidden="true" /> Internal
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-ownership-partner-soft" aria-hidden="true" /> Partner
        </span>
      </div>

      {/* Inline add */}
      {showAdd && (
        <div className="flex gap-2 mt-3">
          <Input
            ref={newLabelInputRef}
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="e.g., Post on Facebook page"
            className="text-sm"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <Button
            size="sm"
            onClick={handleAdd}
            className="bg-hub text-white"
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
