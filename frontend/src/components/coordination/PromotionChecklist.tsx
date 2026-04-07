import { useState, useEffect, useCallback } from 'react';
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
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
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
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>{done}/{total} completed</span>
          <span>{pct}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all"
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
                <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="flex-1 text-sm">{item.label}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(item.id, 'internal')}
                    className={cn(
                      'w-6 h-6 rounded border-2 flex items-center justify-center text-xs transition-colors',
                      item.internal_done
                        ? 'bg-blue-500 border-blue-500 text-white'
                        : 'border-blue-300 hover:border-blue-400',
                    )}
                    title="Internal"
                  >
                    {item.internal_done && <Check className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => handleToggle(item.id, 'partner')}
                    className={cn(
                      'w-6 h-6 rounded border-2 flex items-center justify-center text-xs transition-colors',
                      item.partner_done
                        ? 'bg-purple-500 border-purple-500 text-white'
                        : 'border-purple-300 hover:border-purple-400',
                    )}
                    title="Partner"
                  >
                    {item.partner_done && <Check className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex gap-3 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-blue-100" /> Internal
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-purple-100" /> Partner
        </span>
      </div>

      {/* Inline add */}
      {showAdd && (
        <div className="flex gap-2 mt-3">
          <Input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="Channel name"
            className="text-sm"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            autoFocus
          />
          <Button
            size="sm"
            onClick={handleAdd}
            className="bg-indigo-600 text-white"
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
