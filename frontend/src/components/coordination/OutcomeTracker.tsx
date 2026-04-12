import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Plus, Users, Search, UserPlus } from 'lucide-react';
import { Input } from '../ui/input';
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
  { value: 'attended', label: 'Attended', color: 'bg-info-soft text-info' },
  { value: 'contacted', label: 'Contacted', color: 'bg-warn-soft text-warn' },
  { value: 'consultation', label: 'Consultation', color: 'bg-ownership-partner-soft text-ownership-partner' },
  { value: 'converted', label: 'Converted', color: 'bg-spoke-soft text-spoke' },
  { value: 'lost', label: 'Lost', color: 'bg-danger-soft text-danger' },
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
  const [searchQuery, setSearchQuery] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickEmail, setQuickEmail] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickAdding, setQuickAdding] = useState(false);
  const [transitionWarning, setTransitionWarning] = useState<{
    outcomeId: string; currentStatus: string; requestedStatus: string; attendeeName: string;
  } | null>(null);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      const [outRes, funnelRes] = await Promise.all([
        api.get(`/projects/${projectId}/outcomes`, { signal }),
        api.get(`/projects/${projectId}/outcomes/funnel`, { signal }),
      ]);
      setOutcomes(outRes.data.items || []);
      setFunnel(funnelRes.data);
    } catch (err) {
      if (signal?.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') return;
      toast.error('Failed to load outcomes');
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

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

  const handleQuickAdd = async () => {
    if (!quickName.trim()) return;
    setQuickAdding(true);
    try {
      await api.post(`/projects/${projectId}/outcomes/bulk`, {
        attendees: [{
          attendee_name: quickName.trim(),
          attendee_email: quickEmail.trim() || null,
          attendee_phone: quickPhone.trim() || null,
          status: 'attended',
        }],
      });
      toast.success(`Added ${quickName.trim()}`);
      setQuickName(''); setQuickEmail(''); setQuickPhone('');
      setShowQuickAdd(false);
      loadData();
    } catch {
      toast.error('Failed to add attendee');
    } finally {
      setQuickAdding(false);
    }
  };

  const filteredOutcomes = searchQuery
    ? outcomes.filter(o =>
        o.attendee_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.attendee_email?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : outcomes;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Users className="w-4 h-4" /> Outcomes
        </h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowQuickAdd(!showQuickAdd)}>
            <UserPlus className="w-3.5 h-3.5 mr-1" /> Quick Add
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowBulkAdd(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Bulk Add
          </Button>
        </div>
      </div>

      {/* Quick Add Row */}
      {showQuickAdd && (
        <Card className="p-3 mb-4 border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="quick-add-name" className="text-[10px] text-slate-500 uppercase tracking-wide">Name *</label>
              <Input id="quick-add-name" value={quickName} onChange={e => setQuickName(e.target.value)} placeholder="Attendee name" className="h-8 text-sm" />
            </div>
            <div className="flex-1">
              <label htmlFor="quick-add-email" className="text-[10px] text-slate-500 uppercase tracking-wide">Email</label>
              <Input id="quick-add-email" value={quickEmail} onChange={e => setQuickEmail(e.target.value)} placeholder="email@example.com" className="h-8 text-sm" />
            </div>
            <div className="w-32">
              <label htmlFor="quick-add-phone" className="text-[10px] text-slate-500 uppercase tracking-wide">Phone</label>
              <Input id="quick-add-phone" value={quickPhone} onChange={e => setQuickPhone(e.target.value)} placeholder="515-555-0100" className="h-8 text-sm" />
            </div>
            <Button size="sm" onClick={handleQuickAdd} disabled={quickAdding || !quickName.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white h-8">
              Add
            </Button>
          </div>
        </Card>
      )}

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

      {/* Search */}
      {outcomes.length > 5 && (
        <div className="relative mb-3">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search attendees..."
            className="pl-8 h-8 text-sm"
          />
        </div>
      )}

      {/* Table */}
      <div className="space-y-2">
        {filteredOutcomes.map(o => {
          const statusDef = STATUSES.find(s => s.value === o.status);
          return (
            <Card key={o.id} className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{o.attendee_name}</p>
                {o.attendee_email && (
                  <p className="text-xs text-muted-foreground">{o.attendee_email}</p>
                )}
              </div>
              <select
                value={o.status}
                onChange={e => handleStatusChange(o.id, e.target.value)}
                className={cn('text-xs border rounded px-2 py-1', statusDef?.color || 'bg-white dark:bg-gray-900')}
              >
                {STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Card>
          );
        })}
        {outcomes.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No outcomes tracked yet</p>
        )}
        {outcomes.length > 0 && filteredOutcomes.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No matching attendees</p>
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
            <p className="text-sm text-slate-600 dark:text-muted-foreground">
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
