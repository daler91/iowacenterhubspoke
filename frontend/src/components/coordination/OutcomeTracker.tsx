import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Plus, Users } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import api from '../../lib/api';

interface EventOutcome {
  id: string;
  project_id: string;
  attendee_name: string;
  attendee_email?: string;
  status: string;
  notes?: string;
}

interface Funnel {
  total: number;
  attended: number;
  contacted: number;
  consultation: number;
  converted: number;
  lost: number;
  conversion_rate: number;
}

const STATUSES = [
  { value: 'attended', label: 'Attended', color: 'bg-blue-100 text-blue-700' },
  { value: 'contacted', label: 'Contacted', color: 'bg-amber-100 text-amber-700' },
  { value: 'consultation', label: 'Consultation', color: 'bg-purple-100 text-purple-700' },
  { value: 'converted', label: 'Converted', color: 'bg-green-100 text-green-700' },
  { value: 'lost', label: 'Lost', color: 'bg-red-100 text-red-600' },
];

interface Props {
  readonly projectId: string;
}

export default function OutcomeTracker({ projectId }: Props) {
  const [outcomes, setOutcomes] = useState<EventOutcome[]>([]);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkNames, setBulkNames] = useState('');
  const [adding, setAdding] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [outRes, funnelRes] = await Promise.all([
        api.get(`/projects/${projectId}/outcomes`),
        api.get(`/projects/${projectId}/outcomes/funnel`),
      ]);
      setOutcomes(outRes.data.items || []);
      setFunnel(funnelRes.data);
    } catch {
      toast.error('Failed to load outcomes');
    }
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleStatusChange = async (outcomeId: string, newStatus: string) => {
    try {
      await api.put(`/projects/${projectId}/outcomes/${outcomeId}`, { status: newStatus });
      loadData();
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleBulkAdd = async () => {
    const names = bulkNames.split('\n').map(n => n.trim()).filter(Boolean);
    if (names.length === 0) return;
    setAdding(true);
    try {
      await api.post(`/projects/${projectId}/outcomes/bulk`, {
        attendees: names.map(name => ({ attendee_name: name, status: 'attended' })),
      });
      toast.success(`${names.length} attendees added`);
      setBulkNames('');
      setShowBulkAdd(false);
      loadData();
    } catch {
      toast.error('Failed to add attendees');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Users className="w-4 h-4" /> Outcomes
        </h3>
        <Button size="sm" variant="outline" onClick={() => setShowBulkAdd(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Attendees
        </Button>
      </div>

      {/* Funnel */}
      {funnel && funnel.total > 0 && (
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-1 h-8 rounded-lg overflow-hidden">
            {STATUSES.filter(s => s.value !== 'lost').map(s => {
              const count = funnel[s.value as keyof Funnel] as number;
              const pct = funnel.total > 0 ? (count / funnel.total) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={s.value}
                  className={cn('h-full flex items-center justify-center text-xs font-medium', s.color)}
                  style={{ width: `${Math.max(pct, 8)}%` }}
                >
                  {count}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-slate-500">
            <span>{funnel.total} total</span>
            <span>{funnel.conversion_rate}% conversion</span>
          </div>
        </Card>
      )}

      {/* Table */}
      <div className="space-y-2">
        {outcomes.map(o => (
          <Card key={o.id} className="p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{o.attendee_name}</p>
              {o.attendee_email && (
                <p className="text-xs text-slate-400">{o.attendee_email}</p>
              )}
            </div>
            <select
              value={o.status}
              onChange={e => handleStatusChange(o.id, e.target.value)}
              className="text-xs border rounded px-2 py-1 bg-white dark:bg-gray-900"
            >
              {STATUSES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Card>
        ))}
        {outcomes.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">No outcomes tracked yet</p>
        )}
      </div>

      {/* Bulk Add Dialog */}
      <Dialog open={showBulkAdd} onOpenChange={setShowBulkAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Attendees</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 mb-2">Enter one name per line:</p>
          <textarea
            value={bulkNames}
            onChange={e => setBulkNames(e.target.value)}
            rows={8}
            className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
            placeholder="John Smith&#10;Jane Doe&#10;..."
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setShowBulkAdd(false)}>Cancel</Button>
            <Button onClick={handleBulkAdd} disabled={adding} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {adding ? 'Adding...' : 'Add All'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
