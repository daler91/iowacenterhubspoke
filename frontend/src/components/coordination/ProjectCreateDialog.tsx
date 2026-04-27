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
import { describeApiError } from '../../lib/error-messages';
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

// Our ``validation_exception_handler`` (backend/server.py) reshapes 422s
// to ``{ detail: "Validation Error", errors: [{loc, msg, type}, ...] }``
// — so ``describeApiError`` (which only reads ``detail``/``message``)
// stops at the generic string. Surface the first entry's field + msg
// directly so users see *which* field is wrong.
function firstValidationFieldError(err: unknown): string | null {
  const errors = (err as { response?: { data?: { errors?: unknown } } })
    ?.response?.data?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const first = errors[0] as { loc?: unknown[]; msg?: unknown };
  if (typeof first.msg !== 'string') return null;
  const loc = Array.isArray(first.loc) ? first.loc : [];
  const last = loc.at(-1);
  const hasField = typeof last === 'string' || typeof last === 'number';
  return hasField ? `${String(last)} — ${first.msg}` : first.msg;
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
    } catch (err: unknown) {
      const fieldMsg = firstValidationFieldError(err);
      toast.error(fieldMsg ?? describeApiError(err, 'Failed to create project'));
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
            <Label htmlFor="project-title">Title *</Label>
            <Input
              id="project-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => markTouched('title')}
              placeholder="e.g. AI for Small Business Workshop"
              className={cn(showError('title', title) && 'border-danger focus:ring-danger')}
              aria-invalid={showError('title', title)}
              aria-describedby={showError('title', title) ? 'project-title-error' : undefined}
            />
            {showError('title', title) && <p id="project-title-error" className="text-xs text-danger-strong mt-1">Title is required</p>}
          </div>
          <div>
            <Label htmlFor="project-template">Template</Label>
            <p className="text-xs text-muted-foreground mb-1">Templates pre-fill tasks for your project. You can customize them afterward.</p>
            <SearchableSelect
              id="project-template"
              options={templates.map(t => ({ value: t.id, label: `${t.name} (${t.default_tasks.length} tasks)` }))}
              value={templateId}
              onValueChange={setTemplateId}
              placeholder="No template (blank project)"
              searchPlaceholder="Search templates..."
            />
          </div>
          <div>
            <Label htmlFor="project-event-format">Event Format *</Label>
            <SearchableSelect
              id="project-event-format"
              options={Object.entries(EVENT_FORMAT_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              value={eventFormat}
              onValueChange={setEventFormat}
              placeholder="Select format..."
              searchPlaceholder="Search formats..."
            />
          </div>
          <div>
            <Label htmlFor="project-partner">Partner Organization *</Label>
            <SearchableSelect
              id="project-partner"
              options={partnerOrgs.map(org => ({ value: org.id, label: org.name, sublabel: org.community }))}
              value={partnerOrgId}
              onValueChange={(v) => { setPartnerOrgId(v); markTouched('partnerOrgId'); }}
              placeholder="Select partner..."
              searchPlaceholder="Search partners..."
              aria-invalid={showError('partnerOrgId', partnerOrgId)}
              aria-describedby={showError('partnerOrgId', partnerOrgId) ? 'project-partner-error' : undefined}
            />
            {showError('partnerOrgId', partnerOrgId) && <p id="project-partner-error" className="text-xs text-danger-strong mt-1">Partner organization is required</p>}
          </div>
          <div>
            <Label htmlFor="project-class">Class</Label>
            <SearchableSelect
              id="project-class"
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              value={classId}
              onValueChange={setClassId}
              placeholder="No class selected"
              searchPlaceholder="Search classes..."
            />
          </div>
          <div>
            <Label htmlFor="project-schedule">Link to Existing Schedule (optional)</Label>
            <SearchableSelect
              id="project-schedule"
              options={schedules.map(s => ({ value: s.id, label: `${s.date} — ${s.class_name || 'Unclassified'}`, sublabel: s.location_name || '' }))}
              value={scheduleId}
              onValueChange={handleScheduleSelect}
              placeholder="No linked schedule"
              searchPlaceholder="Search schedules..."
            />
          </div>
          <div>
            <Label htmlFor="project-event-date">Event Date *</Label>
            <Input
              id="project-event-date"
              type="date"
              value={eventDate}
              onChange={e => setEventDate(e.target.value)}
              onBlur={() => markTouched('eventDate')}
              className={cn(showError('eventDate', eventDate) && 'border-danger focus:ring-danger')}
              aria-invalid={showError('eventDate', eventDate)}
              aria-describedby={showError('eventDate', eventDate) ? 'project-event-date-error' : undefined}
            />
            {showError('eventDate', eventDate) && <p id="project-event-date-error" className="text-xs text-danger-strong mt-1">Event date is required</p>}
          </div>
          <TooltipProvider>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="project-community" className="flex items-center gap-1">
                  Community
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Auto-populated from the selected Partner Organization. Change the partner above to update.</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <Input
                  id="project-community"
                  value={community}
                  disabled
                  className="bg-muted/50 dark:bg-muted text-foreground/80"
                  placeholder="Auto-filled from partner"
                />
              </div>
              <div>
                <Label htmlFor="project-venue" className="flex items-center gap-1">
                  Venue
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Auto-populated from the selected Partner Organization. Change the partner above to update.</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <Input
                  id="project-venue"
                  value={venueName}
                  disabled
                  className="bg-muted/50 dark:bg-muted text-foreground/80"
                  placeholder="Auto-filled from partner"
                />
              </div>
            </div>
          </TooltipProvider>

          {/* Auto-create schedule section */}
          {showAutoScheduleSection && (
            <div className="border rounded-lg p-3 space-y-3 bg-hub-soft/50 dark:bg-hub-soft/20">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCreateSchedule}
                  onChange={e => setAutoCreateSchedule(e.target.checked)}
                  className="accent-hub"
                />
                <CalendarPlus className="w-4 h-4 text-hub" />
                <span className="text-sm font-medium">Also create a class schedule</span>
              </label>

              {autoCreateSchedule && (
                <div className="space-y-3 pl-6">
                  <p className="text-xs text-foreground/80">
                    A schedule will be created at the partner&apos;s location.
                  </p>
                  <div>
                    <Label htmlFor="project-employees" className="text-xs">Employees *</Label>
                    <EmployeeMultiSelect
                      id="project-employees"
                      employees={employees}
                      selectedIds={selectedEmployeeIds}
                      onSelectionChange={setSelectedEmployeeIds}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="project-start-time" className="text-xs">Start Time</Label>
                      <Input id="project-start-time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="project-end-time" className="text-xs">End Time</Label>
                      <Input id="project-end-time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading} className="bg-hub hover:bg-hub-strong text-white">
              {loading ? 'Creating...' : 'Create Project'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
