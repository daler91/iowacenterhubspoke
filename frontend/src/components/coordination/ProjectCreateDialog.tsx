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
import { cn } from '../../lib/utils';
import { CalendarPlus, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { EmployeeMultiSelect } from '../ui/employee-multi-select';
import { SearchableSelect } from '../ui/searchable-select';

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

  // Validation state
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (field: string) => setTouched(prev => ({ ...prev, [field]: true }));
  const showError = (field: string, value: string) => touched[field] && !value;

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
    setTouched({ title: true, partnerOrgId: true, eventDate: true });
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
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => markTouched('title')}
              placeholder="e.g. AI for Small Business Workshop"
              className={cn(showError('title', title) && 'border-red-500 focus:ring-red-500')}
            />
            {showError('title', title) && <p className="text-xs text-red-500 mt-1">Title is required</p>}
          </div>
          <div>
            <Label>Template</Label>
            <p className="text-xs text-slate-400 mb-1">Templates pre-fill tasks for your project. You can customize them afterward.</p>
            <SearchableSelect
              options={templates.map(t => ({ value: t.id, label: `${t.name} (${t.default_tasks.length} tasks)` }))}
              value={templateId}
              onValueChange={setTemplateId}
              placeholder="No template (blank project)"
              searchPlaceholder="Search templates..."
            />
          </div>
          <div>
            <Label>Event Format *</Label>
            <SearchableSelect
              options={Object.entries(EVENT_FORMAT_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              value={eventFormat}
              onValueChange={setEventFormat}
              placeholder="Select format..."
              searchPlaceholder="Search formats..."
            />
          </div>
          <div>
            <Label>Partner Organization *</Label>
            <SearchableSelect
              options={partnerOrgs.map(org => ({ value: org.id, label: org.name, sublabel: org.community }))}
              value={partnerOrgId}
              onValueChange={(v) => { setPartnerOrgId(v); markTouched('partnerOrgId'); }}
              placeholder="Select partner..."
              searchPlaceholder="Search partners..."
            />
            {showError('partnerOrgId', partnerOrgId) && <p className="text-xs text-red-500 mt-1">Partner organization is required</p>}
          </div>
          <div>
            <Label>Class</Label>
            <SearchableSelect
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              value={classId}
              onValueChange={setClassId}
              placeholder="No class selected"
              searchPlaceholder="Search classes..."
            />
          </div>
          <div>
            <Label>Link to Existing Schedule (optional)</Label>
            <SearchableSelect
              options={schedules.map(s => ({ value: s.id, label: `${s.date} — ${s.class_name || 'Unclassified'}`, sublabel: s.location_name || '' }))}
              value={scheduleId}
              onValueChange={handleScheduleSelect}
              placeholder="No linked schedule"
              searchPlaceholder="Search schedules..."
            />
          </div>
          <div>
            <Label>Event Date *</Label>
            <Input
              type="date"
              value={eventDate}
              onChange={e => setEventDate(e.target.value)}
              onBlur={() => markTouched('eventDate')}
              className={cn(showError('eventDate', eventDate) && 'border-red-500 focus:ring-red-500')}
            />
            {showError('eventDate', eventDate) && <p className="text-xs text-red-500 mt-1">Event date is required</p>}
          </div>
          <TooltipProvider>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center gap-1">
                  Community
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-slate-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Auto-populated from the selected Partner Organization. Change the partner above to update.</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <Input
                  value={community}
                  disabled
                  className="bg-slate-50 dark:bg-slate-800 text-slate-500"
                  placeholder="Auto-filled from partner"
                />
              </div>
              <div>
                <Label className="flex items-center gap-1">
                  Venue
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-slate-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Auto-populated from the selected Partner Organization. Change the partner above to update.</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <Input
                  value={venueName}
                  disabled
                  className="bg-slate-50 dark:bg-slate-800 text-slate-500"
                  placeholder="Auto-filled from partner"
                />
              </div>
            </div>
          </TooltipProvider>

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
                    <EmployeeMultiSelect
                      employees={employees}
                      selectedIds={selectedEmployeeIds}
                      onSelectionChange={setSelectedEmployeeIds}
                    />
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
