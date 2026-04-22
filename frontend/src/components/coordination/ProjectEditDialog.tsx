import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { projectsAPI } from '../../lib/coordination-api';
import { usePartnerOrgs } from '../../hooks/useCoordinationData';
import { EVENT_FORMAT_LABELS, type Project } from '../../lib/coordination-types';
import { toast } from 'sonner';
import { SearchableSelect } from '../ui/searchable-select';

interface Props {
  readonly project: Project;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
  readonly classes?: Array<{ id: string; name: string }>;
}

export default function ProjectEditDialog({ project, onClose, onUpdated, classes = [] }: Props) {
  const { partnerOrgs } = usePartnerOrgs();
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState(project.title);
  const [eventFormat, setEventFormat] = useState(project.event_format);
  const [partnerOrgId, setPartnerOrgId] = useState(project.partner_org_id);
  const [eventDate, setEventDate] = useState(project.event_date?.split('T')[0] || '');
  const [classId, setClassId] = useState(project.class_id || '');
  const [community, setCommunity] = useState(project.community || '');
  const [venueName, setVenueName] = useState(project.venue_name || '');

  // Auto-fill community and venue when partner org changes
  useEffect(() => {
    if (partnerOrgId && partnerOrgId !== project.partner_org_id) {
      const org = partnerOrgs.find(o => o.id === partnerOrgId);
      if (org) {
        setVenueName(org.name);
        setCommunity(org.community);
      }
    }
  }, [partnerOrgId, partnerOrgs, project.partner_org_id]);

  const handleSubmit = async () => {
    if (!title || !partnerOrgId || !eventDate) {
      toast.error('Please fill in title, partner organization, and event date');
      return;
    }
    setLoading(true);
    try {
      const updates: Record<string, unknown> = {};

      if (title !== project.title) updates.title = title;
      if (eventFormat !== project.event_format) updates.event_format = eventFormat;
      if (partnerOrgId !== project.partner_org_id) updates.partner_org_id = partnerOrgId;
      if (classId !== (project.class_id || '')) updates.class_id = classId || null;

      const newDate = new Date(eventDate).toISOString();
      if (newDate !== project.event_date) updates.event_date = newDate;

      if (Object.keys(updates).length === 0) {
        toast.info('No changes to save');
        onClose();
        return;
      }

      await projectsAPI.update(project.id, updates);
      toast.success('Project updated');
      onUpdated();
    } catch {
      toast.error('Failed to update project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Project Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label htmlFor="project-edit-title">Title *</Label>
            <Input
              id="project-edit-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Project title"
            />
          </div>
          <div>
            <Label htmlFor="project-edit-event-format">Event Format *</Label>
            <SearchableSelect
              id="project-edit-event-format"
              options={Object.entries(EVENT_FORMAT_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              value={eventFormat}
              onValueChange={setEventFormat}
              placeholder="Select format..."
              searchPlaceholder="Search formats..."
            />
          </div>
          <div>
            <Label htmlFor="project-edit-partner">Partner Organization *</Label>
            <SearchableSelect
              id="project-edit-partner"
              options={partnerOrgs.map(org => ({ value: org.id, label: org.name, sublabel: org.community }))}
              value={partnerOrgId}
              onValueChange={setPartnerOrgId}
              placeholder="Select partner..."
              searchPlaceholder="Search partners..."
            />
          </div>
          <div>
            <Label htmlFor="project-edit-class">Class</Label>
            <SearchableSelect
              id="project-edit-class"
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              value={classId}
              onValueChange={setClassId}
              placeholder="No class selected"
              searchPlaceholder="Search classes..."
            />
          </div>
          <div>
            <Label htmlFor="project-edit-event-date">Event Date *</Label>
            <Input
              id="project-edit-event-date"
              type="date"
              value={eventDate}
              onChange={e => setEventDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="project-edit-community" className="text-xs text-slate-600">Community (auto-derived)</Label>
              <Input
                id="project-edit-community"
                value={community}
                disabled
                className="bg-slate-50 dark:bg-slate-800 text-slate-600"
              />
            </div>
            <div>
              <Label htmlFor="project-edit-venue" className="text-xs text-slate-600">Venue (auto-derived)</Label>
              <Input
                id="project-edit-venue"
                value={venueName}
                disabled
                className="bg-slate-50 dark:bg-slate-800 text-slate-600"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
