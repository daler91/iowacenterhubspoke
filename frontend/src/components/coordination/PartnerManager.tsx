import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Plus, Search } from 'lucide-react';
import { usePartnerOrgs } from '../../hooks/useCoordinationData';
import { partnerOrgsAPI } from '../../lib/coordination-api';
import { STATUS_BADGE_COLORS } from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

export default function PartnerManager() {
  const navigate = useNavigate();
  const { partnerOrgs, mutatePartnerOrgs, isLoading } = usePartnerOrgs();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', community: '', status: 'prospect' as string, notes: '' });
  const [creating, setCreating] = useState(false);

  const filtered = partnerOrgs.filter(org =>
    org.name.toLowerCase().includes(search.toLowerCase()) ||
    org.community.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    if (!form.name || !form.community) {
      toast.error('Name and community are required');
      return;
    }
    setCreating(true);
    try {
      await partnerOrgsAPI.create(form);
      toast.success('Partner organization created');
      setShowCreate(false);
      setForm({ name: '', community: '', status: 'prospect', notes: '' });
      mutatePartnerOrgs();
    } catch {
      toast.error('Failed to create partner organization');
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Partner Organizations
        </h1>
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-1" /> Add Partner
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search partners..."
          className="pl-9"
        />
      </div>

      <div className="grid gap-3">
        {filtered.map(org => (
          <Card
            key={org.id}
            className="p-4 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(`/coordination/partners/${org.id}`)}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">{org.name}</h3>
                <p className="text-sm text-slate-500">{org.community}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={cn('text-xs', STATUS_BADGE_COLORS[org.status])}>
                  {org.status}
                </Badge>
              </div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-slate-400 py-8">No partner organizations found</p>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Partner Organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Organization Name *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Community *</Label>
              <Input value={form.community} onChange={e => setForm({ ...form, community: e.target.value })} placeholder="e.g. Carroll, Fort Dodge" />
            </div>
            <div>
              <Label>Status</Label>
              <select
                value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value })}
                className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
              >
                <option value="prospect">Prospect</option>
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
