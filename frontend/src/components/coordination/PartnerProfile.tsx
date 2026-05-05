import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { PageShell } from '../ui/page-shell';
import { Plus, User, MapPin, Calendar, ChevronDown, Send } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '../ui/dropdown-menu';
import {
  usePartnerOrg,
  usePartnerContacts,
  usePartnerProjects,
} from '../../hooks/useCoordinationData';
import { partnerOrgsAPI } from '../../lib/coordination-api';
import {
  STATUS_BADGE_COLORS, PHASE_LABELS, PHASE_COLORS,
  EVENT_FORMAT_LABELS,
  type Project,
} from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { normalizeApiError } from '../../lib/api';
import { toast } from 'sonner';

// Shared class string for the empty/loading placeholder <p> inside
// each profile section. Hoisted so the four call sites agree on the
// styling without duplicating the literal.
const EMPTY_STATE_CLASSES = 'text-sm text-muted-foreground text-center py-4';

// Split out to avoid a nested ternary in the JSX: the project history
// body has three mutually-exclusive states (loading, populated table,
// empty).
function renderProjectHistory({
  projects,
  projectsLoading,
  navigate,
}: Readonly<{
  projects: Project[];
  projectsLoading: boolean;
  navigate: (to: string) => void;
}>) {
  if (projectsLoading && projects.length === 0) {
    return <p className={EMPTY_STATE_CLASSES}>Loading project history...</p>;
  }
  if (projects.length === 0) {
    return <p className={EMPTY_STATE_CLASSES}>No projects yet</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-foreground/80">
            <th className="pb-2 font-medium">Title</th>
            <th className="pb-2 font-medium">Type</th>
            <th className="pb-2 font-medium">Date</th>
            <th className="pb-2 font-medium">Phase</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(project => (
            <tr
              key={project.id}
              className="border-b last:border-0 cursor-pointer hover:bg-muted/50 dark:hover:bg-muted"
              onClick={() => navigate(`/coordination/projects/${project.id}`)}
            >
              <td className="py-2.5 font-medium text-foreground">{project.title}</td>
              <td className="py-2.5 text-foreground/80">
                {EVENT_FORMAT_LABELS[project.event_format] || project.event_format}
              </td>
              <td className="py-2.5 text-foreground/80">{new Date(project.event_date).toLocaleDateString()}</td>
              <td className="py-2.5">
                <Badge className={cn('text-[10px]', PHASE_COLORS[project.phase], 'text-white')}>
                  {PHASE_LABELS[project.phase]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PartnerProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { partnerOrg, mutatePartnerOrg, isLoading } = usePartnerOrg(id);
  // Contacts and recent-project history are fetched in parallel
  // alongside the core org request rather than bundled into it, so
  // the profile page renders the hero + org-details card as soon as
  // the (small) org doc arrives — the two list queries fill in
  // independently.
  const { contacts, mutateContacts, isLoading: contactsLoading } = usePartnerContacts(id);
  const { projects, isLoading: projectsLoading } = usePartnerProjects(id);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', role: '', is_primary: false });
  const [addingContact, setAddingContact] = useState(false);
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);

  // Alias ``id`` as ``orgId`` up front so both handlers below can
  // reference it safely. Previously ``orgId`` was declared further
  // down and ``handleAddContact`` crashed on invocation because the
  // const was TDZ'd at the point of use.
  const orgId = id;

  const handleSendInvite = async (contactId: string) => {
    if (!orgId) return;
    setSendingInvite(contactId);
    try {
      const res = await partnerOrgsAPI.sendInvite(orgId, contactId);
      toast.success(res.data.message, {
        description: 'Portal link has been generated and emailed.',
        duration: 6000,
      });
    } catch {
      toast.error('Failed to send portal invite');
    } finally {
      setSendingInvite(null);
    }
  };

  const handleAddContact = async () => {
    if (!orgId) {
      toast.error('Cannot add a contact without a partner organization');
      return;
    }
    if (!contactForm.name || !contactForm.email) {
      toast.error('Name and email are required');
      return;
    }
    setAddingContact(true);
    try {
      await partnerOrgsAPI.createContact(orgId, contactForm);
      toast.success('Contact added');
      setShowAddContact(false);
      setContactForm({ name: '', email: '', phone: '', role: '', is_primary: false });
      // Only refetch the contacts list — the main org doc and the
      // projects list haven't changed, so there's no reason to
      // invalidate them.
      mutateContacts();
    } catch {
      toast.error('Failed to add contact');
    } finally {
      setAddingContact(false);
    }
  };

  const STATUSES = ['prospect', 'onboarding', 'active', 'inactive'] as const;

  const handleStatusChange = async (newStatus: string) => {
    if (!id || !partnerOrg || newStatus === partnerOrg.status) return;
    try {
      await partnerOrgsAPI.update(id, { status: newStatus });
      toast.success(`Status updated to ${newStatus}`);
      mutatePartnerOrg();
    } catch (err: unknown) {
      const normalized = normalizeApiError(err, 'Failed to update status');
      const blockers = Array.isArray(normalized.detailPayload?.blockers) ? normalized.detailPayload.blockers : null;
      if (blockers && blockers.length > 0) {
        toast.error(blockers.join('. '));
      } else {
        toast.error(normalized.message);
      }
    }
  };

  let status: React.ComponentProps<typeof PageShell>['status'];
  if (isLoading) status = { kind: 'loading', variant: 'cards' };
  else if (!partnerOrg || !id) status = { kind: 'error', error: new Error('Partner organization not found') };
  else status = { kind: 'ready' };

  const statusActions = partnerOrg ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Partner status: ${partnerOrg.status}. Click to change.`}
          className="flex items-center gap-1 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1"
        >
          <Badge className={cn('text-xs', STATUS_BADGE_COLORS[partnerOrg.status])}>
            {partnerOrg.status}
          </Badge>
          <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATUSES.map(s => (
          <DropdownMenuItem
            key={s}
            onClick={() => handleStatusChange(s)}
            className={cn(s === partnerOrg.status && 'font-semibold bg-muted/50 dark:bg-muted')}
          >
            <Badge variant="outline" className={cn('text-xs mr-2', STATUS_BADGE_COLORS[s])}>{s}</Badge>
            {s === partnerOrg.status && '(current)'}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;

  return (
    <>
    <PageShell
      testId="partner-profile"
      breadcrumbs={[
        { label: 'Coordination' },
        { label: 'Partners', path: '/coordination/partners' },
        { label: partnerOrg?.name || 'Partner' },
      ]}
      title={partnerOrg?.name || 'Partner'}
      actions={statusActions}
      status={status}
    >
      {partnerOrg && orgId && (
        <>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Org Details */}
        <Card className="p-5">
          <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Organization Details
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground/80">Community</span>
              <span className="font-medium">{partnerOrg.community}</span>
            </div>
            {partnerOrg.co_branding && (
              <div className="flex justify-between">
                <span className="text-foreground/80">Co-branding</span>
                <span className="font-medium">{partnerOrg.co_branding}</span>
              </div>
            )}
            {partnerOrg.notes && (
              <div>
                <span className="text-foreground/80 block mb-1">Notes</span>
                <p className="text-foreground dark:text-muted-foreground">{partnerOrg.notes}</p>
              </div>
            )}
          </div>

          {/* Venue Details */}
          {partnerOrg.venue_details && Object.values(partnerOrg.venue_details).some(Boolean) && (
            <div className="mt-4 pt-4 border-t">
              <h3 className="text-sm font-semibold text-foreground mb-2">Venue Details</h3>
              <div className="space-y-1 text-sm">
                {partnerOrg.venue_details.capacity && (
                  <p className="text-foreground/80">Capacity: <span className="font-medium text-foreground dark:text-muted-foreground">{partnerOrg.venue_details.capacity}</span></p>
                )}
                {partnerOrg.venue_details.av_setup && (
                  <p className="text-foreground/80">AV: <span className="font-medium text-foreground dark:text-muted-foreground">{partnerOrg.venue_details.av_setup}</span></p>
                )}
                {partnerOrg.venue_details.wifi !== undefined && (
                  <p className="text-foreground/80">Wi-Fi: <span className="font-medium text-foreground dark:text-muted-foreground">{partnerOrg.venue_details.wifi ? 'Yes' : 'No'}</span></p>
                )}
                {partnerOrg.venue_details.parking && (
                  <p className="text-foreground/80">Parking: <span className="font-medium text-foreground dark:text-muted-foreground">{partnerOrg.venue_details.parking}</span></p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Contacts */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <User className="w-4 h-4" /> Contacts
            </h2>
            <Button size="sm" variant="outline" onClick={() => setShowAddContact(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>
          <div className="space-y-3">
            {contactsLoading && contacts.length === 0 ? (
              <p className={EMPTY_STATE_CLASSES}>Loading contacts...</p>
            ) : (
              <>
                {contacts.map(contact => (
                  <div key={contact.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 dark:hover:bg-muted">
                    <div className="w-8 h-8 rounded-full bg-spoke-soft flex items-center justify-center text-spoke-strong font-semibold text-sm shrink-0">
                      {contact.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {contact.name}
                        {contact.is_primary && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">Primary</Badge>
                        )}
                      </p>
                      <p className="text-xs text-foreground/80">{contact.email}</p>
                      {contact.role && <p className="text-xs text-muted-foreground">{contact.role}</p>}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 text-xs"
                      disabled={sendingInvite === contact.id}
                      onClick={() => handleSendInvite(contact.id)}
                    >
                      <Send className="w-3 h-3 mr-1" />
                      {sendingInvite === contact.id ? 'Sending...' : 'Invite'}
                    </Button>
                  </div>
                ))}
                {contacts.length === 0 && (
                  <p className={EMPTY_STATE_CLASSES}>No contacts yet</p>
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Project History */}
      <Card className="p-5 mt-6">
        <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4" /> Project History
        </h2>
        {renderProjectHistory({ projects, projectsLoading, navigate })}
      </Card>
        </>
      )}
    </PageShell>

      {/* Add Contact Dialog — hoisted outside PageShell so it stays
          mounted during loading and error states. */}
      <Dialog open={showAddContact} onOpenChange={setShowAddContact}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label htmlFor="contact-name">Name *</Label>
              <Input id="contact-name" value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="contact-email">Email *</Label>
              <Input id="contact-email" type="email" value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="contact-phone">Phone</Label>
                <Input id="contact-phone" value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="contact-role">Role</Label>
                <Input id="contact-role" value={contactForm.role} onChange={e => setContactForm({ ...contactForm, role: e.target.value })} placeholder="e.g. venue manager" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="contact-is-primary"
                type="checkbox"
                checked={contactForm.is_primary}
                onChange={e => setContactForm({ ...contactForm, is_primary: e.target.checked })}
                className="rounded"
              />
              <Label htmlFor="contact-is-primary" className="cursor-pointer">Primary contact</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAddContact(false)}>Cancel</Button>
              <Button onClick={handleAddContact} disabled={addingContact} className="bg-hub hover:bg-hub-strong text-white">
                {addingContact ? 'Adding...' : 'Add Contact'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
