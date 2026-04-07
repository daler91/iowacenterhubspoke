import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { projectsAPI, templatesAPI } from '../../lib/coordination-api';
import { usePartnerOrgs } from '../../hooks/useCoordinationData';
import { CLASS_TYPE_LABELS } from '../../lib/coordination-types';
import type { ProjectTemplate } from '../../lib/coordination-types';
import { toast } from 'sonner';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function ProjectCreateDialog({ onClose, onCreated }: Props) {
  const { partnerOrgs } = usePartnerOrgs();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [classType, setClassType] = useState('workshop');
  const [partnerOrgId, setPartnerOrgId] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [community, setCommunity] = useState('');
  const [venueName, setVenueName] = useState('');
  const [templateId, setTemplateId] = useState('');

  useEffect(() => {
    templatesAPI.getAll().then(res => {
      const items = res.data?.items ?? res.data;
      if (Array.isArray(items)) setTemplates(items);
    }).catch(() => {});
  }, []);

  // Auto-fill community when partner org selected
  useEffect(() => {
    if (partnerOrgId) {
      const org = partnerOrgs.find(o => o.id === partnerOrgId);
      if (org) {
        setCommunity(org.community);
        setVenueName(org.name);
      }
    }
  }, [partnerOrgId, partnerOrgs]);

  const handleSubmit = async () => {
    if (!title || !partnerOrgId || !eventDate || !community || !venueName) {
      toast.error('Please fill in all required fields');
      return;
    }
    setLoading(true);
    try {
      await projectsAPI.create({
        title,
        class_type: classType,
        partner_org_id: partnerOrgId,
        event_date: new Date(eventDate).toISOString(),
        community,
        venue_name: venueName,
        template_id: templateId || undefined,
      });
      toast.success('Project created');
      onCreated();
    } catch {
      toast.error('Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Coordination Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. AI for Small Business Workshop" />
          </div>
          <div>
            <Label>Class Type *</Label>
            <select
              value={classType}
              onChange={e => setClassType(e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
            >
              {Object.entries(CLASS_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Partner Organization *</Label>
            <select
              value={partnerOrgId}
              onChange={e => setPartnerOrgId(e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
            >
              <option value="">Select partner...</option>
              {partnerOrgs.map(org => (
                <option key={org.id} value={org.id}>{org.name} ({org.community})</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Event Date *</Label>
            <Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Community *</Label>
              <Input value={community} onChange={e => setCommunity(e.target.value)} />
            </div>
            <div>
              <Label>Venue Name *</Label>
              <Input value={venueName} onChange={e => setVenueName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Template (optional)</Label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
            >
              <option value="">No template (blank project)</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.default_tasks.length} tasks)
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {loading ? 'Creating...' : 'Create Project'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
