import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { projectsAPI, templatesAPI } from '../../lib/coordination-api';
import { schedulesAPI } from '../../lib/api';
import { usePartnerOrgs } from '../../hooks/useCoordinationData';
import { EVENT_FORMAT_LABELS } from '../../lib/coordination-types';
import type { ProjectTemplate } from '../../lib/coordination-types';
import type { ClassType, Employee } from '../../lib/types';
import { toast } from 'sonner';
import { CalendarPlus } from 'lucide-react';

interface ScheduleOption {
  id: string;
  date: string;
  class_name?: string;
  location_name?: string;
}

interface Props {
  readonly onClose: () => void;
  readonly onCreated: () => void;
  readonly classes?: ClassType[];
  readonly employees?: Employee[];
}

export default function ProjectCreateDialog({ onClose, onCreated, classes = [], employees = [] }: Props) {
  const { partnerOrgs } = usePartnerOrgs();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [schedules, setSchedules] = useState<ScheduleOption[]>([]);
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [eventFormat, setEventFormat] = useState('workshop');
  const [partnerOrgId, setPartnerOrgId] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [community, setCommunity] = useState('');
  const [venueName, setVenueName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [classId, setClassId] = useState('');

  // Auto-schedule creation state
  const [autoCreateSchedule, setAutoCreateSchedule] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('12:00');

  useEffect(() => {
    templatesAPI.getAll().then(res => {
      const items = res.data?.items ?? res.data;
      if (Array.isArray(items)) setTemplates(items);
    }).catch(() => {});

    // Fetch upcoming schedules for linking
    schedulesAPI.getAll({ status: 'upcoming', limit: 200 }).then(res => {
      const items = res.data?.items ?? res.data;
      if (Array.isArray(items)) setSchedules(items);
    }).catch(() => {});
  }, []);

  // Auto-fill community and venue when partner org selected
  useEffect(() => {
    if (partnerOrgId) {
      const org = partnerOrgs.find(o => o.id === partnerOrgId);
      if (org) {
        setVenueName(org.name);
        // Use community from org (backend will resolve from location if available)
        setCommunity(org.community);
      }
    }
  }, [partnerOrgId, partnerOrgs]);

  // Auto-fill event date when schedule is linked
  const handleScheduleSelect = (id: string) => {
    setScheduleId(id);
    if (id) {
      const schedule = schedules.find(s => s.id === id);
      if (schedule?.date) {
        setEventDate(schedule.date);
      }
      // Disable auto-create when linking to an existing schedule
      setAutoCreateSchedule(false);
    }
  };

  const handleSubmit = async () => {
    if (!title || !partnerOrgId || !eventDate) {
      toast.error('Please fill in title, partner organization, and event date');
      return;
    }
    if (autoCreateSchedule && (!classId || selectedEmployeeIds.length === 0)) {
      toast.error('Select a class and at least one employee to auto-create a schedule');
      return;
    }
    setLoading(true);
    try {
      const res = await projectsAPI.create({
        title,
        event_format: eventFormat,
        partner_org_id: partnerOrgId,
        event_date: new Date(eventDate).toISOString(),
        // community/venue_name sent if user typed them, otherwise backend derives
        community: community || undefined,
        venue_name: venueName || undefined,
        template_id: templateId || undefined,
        schedule_id: scheduleId || undefined,
        class_id: classId || undefined,
        // Auto-schedule fields
        auto_create_schedule: autoCreateSchedule && !scheduleId,
        employee_ids: autoCreateSchedule ? selectedEmployeeIds : undefined,
        start_time: autoCreateSchedule ? startTime : undefined,
        end_time: autoCreateSchedule ? endTime : undefined,
      });
      if (res.data?.schedule_warning) {
        toast.warning(res.data.schedule_warning);
      }
      toast.success('Project created');
      onCreated();
    } catch {
      toast.error('Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const showAutoScheduleSection = classId && !scheduleId;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Coordination Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. AI for Small Business Workshop" />
          </div>
          <div>
            <Label>Event Format *</Label>
            <select
              value={eventFormat}
              onChange={e => setEventFormat(e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
            >
              {Object.entries(EVENT_FORMAT_LABELS).map(([k, v]) => (
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
            <Label>Class</Label>
            <select
              value={classId}
              onChange={e => setClassId(e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
            >
              <option value="">No class selected</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Link to Existing Schedule (optional)</Label>
            <select
              value={scheduleId}
              onChange={e => handleScheduleSelect(e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
            >
              <option value="">No linked schedule</option>
              {schedules.map(s => (
                <option key={s.id} value={s.id}>
                  {s.date} — {s.class_name || 'Unclassified'} at {s.location_name || 'Unknown'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Event Date *</Label>
            <Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Community</Label>
              <Input
                value={community}
                disabled
                className="bg-slate-50 dark:bg-slate-800 text-slate-500"
                placeholder="Auto-filled from partner"
              />
            </div>
            <div>
              <Label>Venue</Label>
              <Input
                value={venueName}
                disabled
                className="bg-slate-50 dark:bg-slate-800 text-slate-500"
                placeholder="Auto-filled from partner"
              />
            </div>
          </div>

          {/* Auto-create schedule section */}
          {showAutoScheduleSection && (
            <div className="border rounded-lg p-3 space-y-3 bg-indigo-50/50 dark:bg-indigo-950/20">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCreateSchedule}
                  onChange={e => setAutoCreateSchedule(e.target.checked)}
                  className="accent-indigo-600"
                />
                <CalendarPlus className="w-4 h-4 text-indigo-600" />
                <span className="text-sm font-medium">Also create a class schedule</span>
              </label>

              {autoCreateSchedule && (
                <div className="space-y-3 pl-6">
                  <p className="text-xs text-slate-500">
                    A schedule will be created at the partner&apos;s location.
                  </p>
                  <div>
                    <Label className="text-xs">Employees *</Label>
                    <select
                      multiple
                      value={selectedEmployeeIds}
                      onChange={e => {
                        const opts = Array.from(e.target.selectedOptions, o => o.value);
                        setSelectedEmployeeIds(opts);
                      }}
                      className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700 h-24"
                    >
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-400 mt-0.5">Hold Ctrl/Cmd to select multiple</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Start Time</Label>
                      <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">End Time</Label>
                      <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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
