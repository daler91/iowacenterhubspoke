import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { ArrowLeft, Plus, User, MapPin, Calendar } from 'lucide-react';
import { usePartnerOrg } from '../../hooks/useCoordinationData';
import { partnerOrgsAPI } from '../../lib/coordination-api';
import {
  STATUS_BADGE_COLORS, PHASE_LABELS, PHASE_COLORS,
  EVENT_FORMAT_LABELS,
} from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

export default function PartnerProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { partnerOrg, mutatePartnerOrg, isLoading } = usePartnerOrg(id);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', role: '', is_primary: false });
  const [addingContact, setAddingContact] = useState(false);

  const handleAddContact = async () => {
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
      mutatePartnerOrg();
    } catch {
      toast.error('Failed to add contact');
    } finally {
      setAddingContact(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!partnerOrg || !id) {
    return <div className="p-6 text-slate-500">Partner organization not found</div>;
  }

  const orgId = id;

  return (
    <div className="p-6 max-w-4xl">
      <button
        onClick={() => navigate('/coordination/partners')}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to partners
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
          {partnerOrg.name}
        </h1>
        <Badge className={cn('text-xs', STATUS_BADGE_COLORS[partnerOrg.status])}>
          {partnerOrg.status}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Org Details */}
        <Card className="p-5">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Organization Details
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Community</span>
              <span className="font-medium">{partnerOrg.community}</span>
            </div>
            {partnerOrg.co_branding && (
              <div className="flex justify-between">
                <span className="text-slate-500">Co-branding</span>
                <span className="font-medium">{partnerOrg.co_branding}</span>
              </div>
            )}
            {partnerOrg.notes && (
              <div>
                <span className="text-slate-500 block mb-1">Notes</span>
                <p className="text-slate-700 dark:text-slate-300">{partnerOrg.notes}</p>
              </div>
            )}
          </div>

          {/* Venue Details */}
          {partnerOrg.venue_details && Object.values(partnerOrg.venue_details).some(Boolean) && (
            <div className="mt-4 pt-4 border-t">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Venue Details</h3>
              <div className="space-y-1 text-sm">
                {partnerOrg.venue_details.capacity && (
                  <p className="text-slate-500">Capacity: <span className="font-medium text-slate-700 dark:text-slate-300">{partnerOrg.venue_details.capacity}</span></p>
                )}
                {partnerOrg.venue_details.av_setup && (
                  <p className="text-slate-500">AV: <span className="font-medium text-slate-700 dark:text-slate-300">{partnerOrg.venue_details.av_setup}</span></p>
                )}
                {partnerOrg.venue_details.wifi !== undefined && (
                  <p className="text-slate-500">Wi-Fi: <span className="font-medium text-slate-700 dark:text-slate-300">{partnerOrg.venue_details.wifi ? 'Yes' : 'No'}</span></p>
                )}
                {partnerOrg.venue_details.parking && (
                  <p className="text-slate-500">Parking: <span className="font-medium text-slate-700 dark:text-slate-300">{partnerOrg.venue_details.parking}</span></p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Contacts */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <User className="w-4 h-4" /> Contacts
            </h2>
            <Button size="sm" variant="outline" onClick={() => setShowAddContact(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>
          <div className="space-y-3">
            {(partnerOrg.contacts ?? []).map(contact => (
              <div key={contact.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center text-purple-700 dark:text-purple-300 font-semibold text-sm shrink-0">
                  {contact.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {contact.name}
                    {contact.is_primary && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">Primary</Badge>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">{contact.email}</p>
                  {contact.role && <p className="text-xs text-slate-400">{contact.role}</p>}
                </div>
              </div>
            ))}
            {(!partnerOrg.contacts || partnerOrg.contacts.length === 0) && (
              <p className="text-sm text-slate-400 text-center py-4">No contacts yet</p>
            )}
          </div>
        </Card>
      </div>

      {/* Project History */}
      <Card className="p-5 mt-6">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4" /> Project History
        </h2>
        {(partnerOrg.projects ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 font-medium">Title</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Phase</th>
                </tr>
              </thead>
              <tbody>
                {partnerOrg.projects!.map(project => (
                  <tr
                    key={project.id}
                    className="border-b last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                    onClick={() => navigate(`/coordination/projects/${project.id}`)}
                  >
                    <td className="py-2.5 font-medium text-slate-800 dark:text-slate-100">{project.title}</td>
                    <td className="py-2.5 text-slate-500">
                      {EVENT_FORMAT_LABELS[project.event_format] || project.event_format}
                    </td>
                    <td className="py-2.5 text-slate-500">{new Date(project.event_date).toLocaleDateString()}</td>
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
        ) : (
          <p className="text-sm text-slate-400 text-center py-4">No projects yet</p>
        )}
      </Card>

      {/* Add Contact Dialog */}
      <Dialog open={showAddContact} onOpenChange={setShowAddContact}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Name *</Label>
              <Input value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })} />
            </div>
            <div>
              <Label>Email *</Label>
              <Input type="email" value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} />
              </div>
              <div>
                <Label>Role</Label>
                <Input value={contactForm.role} onChange={e => setContactForm({ ...contactForm, role: e.target.value })} placeholder="e.g. venue manager" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={contactForm.is_primary}
                onChange={e => setContactForm({ ...contactForm, is_primary: e.target.checked })}
                className="rounded"
              />
              <Label className="cursor-pointer">Primary contact</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAddContact(false)}>Cancel</Button>
              <Button onClick={handleAddContact} disabled={addingContact} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {addingContact ? 'Adding...' : 'Add Contact'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
