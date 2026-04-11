import { useState, useEffect } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Plus, Trash2, Play, Copy } from 'lucide-react';
import api from '../../lib/api';
import { toast } from 'sonner';

interface WebhookSub {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  last_triggered_at?: string;
  failure_count: number;
}

const BACKEND = '/webhooks';

export default function WebhookManager() {
  const [subs, setSubs] = useState<WebhookSub[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState('');

  const loadSubs = () => {
    api.get(BACKEND).then(res => setSubs(res.data.items || []))
      .catch(() => {});
    api.get(`${BACKEND}/events`).then(res => setAvailableEvents(res.data.events || []))
      .catch(() => {});
  };

  useEffect(() => { loadSubs(); }, []);

  const handleCreate = async () => {
    if (!url || selectedEvents.length === 0) {
      toast.error('URL and at least one event are required');
      return;
    }
    setCreating(true);
    try {
      const res = await api.post(BACKEND, { url, events: selectedEvents });
      setCreatedSecret(res.data.secret);
      toast.success('Webhook created');
      loadSubs();
      setUrl('');
      setSelectedEvents([]);
    } catch {
      toast.error('Failed to create webhook');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`${BACKEND}/${id}`);
      loadSubs();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleTest = async (id: string) => {
    try {
      await api.post(`${BACKEND}/${id}/test`);
      toast.success('Test webhook sent');
    } catch {
      toast.error('Failed to send test');
    }
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents(prev =>
      prev.includes(event)
        ? prev.filter(e => e !== event)
        : [...prev, event],
    );
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Webhooks
        </h1>
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-1" /> Add Webhook
        </Button>
      </div>

      <div className="space-y-3">
        {subs.map(sub => (
          <Card key={sub.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium font-mono">{sub.url}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <Badge variant={sub.active ? 'default' : 'secondary'} className="text-[10px]">
                    {sub.active ? 'Active' : 'Inactive'}
                  </Badge>
                  {sub.events.map(e => (
                    <Badge key={e} variant="secondary" className="text-[10px]">{e}</Badge>
                  ))}
                  {sub.failure_count > 0 && (
                    <Badge className="text-[10px] bg-danger-soft text-danger">
                      {sub.failure_count} failures
                    </Badge>
                  )}
                </div>
                {sub.last_triggered_at && (
                  <p className="text-xs text-slate-400 mt-1">
                    Last triggered: {new Date(sub.last_triggered_at).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => handleTest(sub.id)} title="Send test">
                  <Play className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(sub.id)} className="text-danger" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {subs.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">No webhooks configured</p>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={() => { setShowCreate(false); setCreatedSecret(''); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{createdSecret ? 'Webhook Created' : 'New Webhook'}</DialogTitle>
          </DialogHeader>
          {createdSecret ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Save this secret — it won't be shown again:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded font-mono break-all">
                  {createdSecret}
                </code>
                <Button
                  size="sm" variant="outline"
                  onClick={() => { navigator.clipboard.writeText(createdSecret); toast.success('Copied'); }}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              <Button onClick={() => { setShowCreate(false); setCreatedSecret(''); }} className="w-full">
                Done
              </Button>
            </div>
          ) : (
            <div className="space-y-4 mt-2">
              <div>
                <Label htmlFor="webhook-url">URL *</Label>
                <Input id="webhook-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.example.com/..." />
              </div>
              <fieldset>
                <legend className="text-sm font-medium leading-none">Events *</legend>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5 max-h-48 overflow-y-auto">
                  {availableEvents.map(event => (
                    <label key={event} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(event)}
                        onChange={() => toggleEvent(event)}
                        className="rounded"
                      />
                      {event}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={creating} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  {creating ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
