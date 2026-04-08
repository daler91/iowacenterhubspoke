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
  attendee_phone?: string;
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
  const [bulkText, setBulkText] = useState('');
  const [parsedAttendees, setParsedAttendees] = useState<{ attendee_name: string; attendee_email?: string; attendee_phone?: string }[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [adding, setAdding] = useState(false);
  const [transitionWarning, setTransitionWarning] = useState<{
    outcomeId: string; currentStatus: string; requestedStatus: string; attendeeName: string;
  } | null>(null);

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

  const handleStatusChange = async (outcomeId: string, newStatus: string, force?: boolean) => {
    const outcome = outcomes.find(o => o.id === outcomeId);
    try {
      const res = await api.put(`/projects/${projectId}/outcomes/${outcomeId}`, {
        status: newStatus,
        ...(force ? { force: true } : {}),
      });
      if (res.data.warning && res.data.requires_confirmation) {
        setTransitionWarning({
          outcomeId,
          currentStatus: res.data.current_status,
          requestedStatus: res.data.requested_status,
          attendeeName: outcome?.attendee_name || 'Attendee',
        });
        return;
      }
      loadData();
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleForceTransition = async () => {
    if (!transitionWarning) return;
    await handleStatusChange(transitionWarning.outcomeId, transitionWarning.requestedStatus, true);
    setTransitionWarning(null);
    loadData();
  };

  const handleParsePreview = () => {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(line => {
      const parts = line.split(',').map(p => p.trim());
      return {
        attendee_name: parts[0] || '',
        attendee_email: parts[1] || undefined,
        attendee_phone: parts[2] || undefined,
      };
    }).filter(a => a.attendee_name);
    setParsedAttendees(parsed);
    setShowPreview(true);
  };

  const handleBulkAdd = async () => {
    if (parsedAttendees.length === 0) return;
    setAdding(true);
    try {
      await api.post(`/projects/${projectId}/outcomes/bulk`, {
        attendees: parsedAttendees.map(a => ({
          attendee_name: a.attendee_name,
          attendee_email: a.attendee_email || null,
          attendee_phone: a.attendee_phone || null,
          status: 'attended',
        })),
      });
      toast.success(`${parsedAttendees.length} attendees added`);
      setBulkText('');
      setParsedAttendees([]);
      setShowPreview(false);
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
      <Dialog open={showBulkAdd} onOpenChange={(open) => { setShowBulkAdd(open); if (!open) { setShowPreview(false); setParsedAttendees([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Attendees</DialogTitle>
          </DialogHeader>
          {showPreview ? (
            <>
              <p className="text-sm text-slate-500 mb-2">{parsedAttendees.length} attendee(s) parsed:</p>
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">Name</th>
                      <th className="text-left px-3 py-1.5 font-medium">Email</th>
                      <th className="text-left px-3 py-1.5 font-medium">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedAttendees.map((a) => (
                      <tr key={a.attendee_name + (a.attendee_email || '')} className="border-t">
                        <td className="px-3 py-1.5">{a.attendee_name}</td>
                        <td className="px-3 py-1.5 text-slate-500">{a.attendee_email || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{a.attendee_phone || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="outline" onClick={() => setShowPreview(false)}>Back</Button>
                <Button onClick={handleBulkAdd} disabled={adding} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  {adding ? 'Adding...' : `Add ${parsedAttendees.length} Attendees`}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-2">
                Enter one attendee per line (Name, Email, Phone):
              </p>
              <textarea
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                rows={8}
                className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
                placeholder="John Smith, john@example.com, 515-555-0100&#10;Jane Doe, jane@example.com&#10;Bob Jones"
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="outline" onClick={() => setShowBulkAdd(false)}>Cancel</Button>
                <Button onClick={handleParsePreview} disabled={!bulkText.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  Preview
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Backward Transition Warning Dialog */}
      <Dialog open={!!transitionWarning} onOpenChange={() => setTransitionWarning(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Status Change</DialogTitle>
          </DialogHeader>
          {transitionWarning && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Move <strong>{transitionWarning.attendeeName}</strong> from{' '}
              <strong>{transitionWarning.currentStatus}</strong> back to{' '}
              <strong>{transitionWarning.requestedStatus}</strong>?
            </p>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setTransitionWarning(null)}>Cancel</Button>
            <Button onClick={handleForceTransition} className="bg-amber-600 hover:bg-amber-700 text-white">
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
