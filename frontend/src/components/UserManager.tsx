import { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { PageShell } from './ui/page-shell';
import { CheckCircle, XCircle, Trash2, Shield, Clock, UserPlus, Copy, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { usersAPI } from '../lib/api';
import { useAuth } from '../lib/auth';
import { extractErrorMessage } from '../lib/types';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'scheduler', label: 'Scheduler' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

const STATUS_STYLES = {
  pending: 'bg-warn-soft text-warn',
  approved: 'bg-spoke-soft text-spoke',
  rejected: 'bg-danger-soft text-danger',
};

const INVITE_STATUS_STYLES = {
  pending: 'bg-info-soft text-info',
  accepted: 'bg-spoke-soft text-spoke',
  revoked: 'bg-danger-soft text-danger',
};

export default function UserManager() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'viewer' });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState(null);
  const [invitations, setInvitations] = useState([]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await usersAPI.getAll();
      setUsers(Array.isArray(res.data.users) ? res.data.users : []);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInvitations = useCallback(async () => {
    try {
      const res = await usersAPI.getInvitations();
      setInvitations(Array.isArray(res.data.invitations) ? res.data.invitations : []);
    } catch {
      // silently fail - invitations are supplementary
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchInvitations();
  }, [fetchUsers, fetchInvitations]);

  const handleApprove = async (userId) => {
    try {
      await usersAPI.approve(userId);
      toast.success('User approved');
      fetchUsers();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to approve user'));
    }
  };

  const handleReject = async (userId) => {
    try {
      await usersAPI.reject(userId);
      toast.success('User rejected');
      fetchUsers();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to reject user'));
    }
  };

  const handleRoleChange = async (userId, role) => {
    try {
      await usersAPI.updateRole(userId, role);
      toast.success(`Role updated to ${role}`);
      fetchUsers();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to update role'));
    }
  };

  const handleDelete = async (userId) => {
    try {
      await usersAPI.delete(userId);
      toast.success('User deleted');
      fetchUsers();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to delete user'));
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteForm.email) {
      toast.error('Email is required');
      return;
    }
    setInviteLoading(true);
    try {
      const res = await usersAPI.invite({
        email: inviteForm.email,
        name: inviteForm.name || null,
        role: inviteForm.role,
      });
      const link = `${globalThis.location.origin}/login?invite=${res.data.token}`;
      setGeneratedLink(link);
      toast.success('Invitation created');
      fetchInvitations();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to create invitation'));
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleRevokeInvitation = async (inviteId) => {
    try {
      await usersAPI.revokeInvitation(inviteId);
      toast.success('Invitation revoked');
      fetchInvitations();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to revoke invitation'));
    }
  };

  const closeInviteDialog = () => {
    setInviteDialogOpen(false);
    setGeneratedLink(null);
    setInviteForm({ email: '', name: '', role: 'viewer' });
  };

  if (user?.role !== 'admin') {
    return (
      <PageShell
        breadcrumbs={[{ label: 'Admin' }, { label: 'Users' }]}
        title="User Management"
        status={{
          kind: 'error',
          error: new Error('You do not have permission to view this page.'),
        }}
      />
    );
  }

  const pendingUsers = users.filter(u => u.status === 'pending');
  const otherUsers = users.filter(u => u.status !== 'pending');
  const pendingInvitations = invitations.filter(i => i.status === 'pending');

  return (
    <>
    <PageShell
      breadcrumbs={[{ label: 'Admin' }, { label: 'Users' }]}
      title="User Management"
      subtitle={`${users.length} total users`}
      status={loading ? { kind: 'loading', variant: 'rows' } : { kind: 'ready' }}
      actions={
        <Button
          onClick={() => setInviteDialogOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all"
        >
          <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
          Invite User
        </Button>
      }
    >
      {/* While loading, PageShell substitutes skeleton rows and these
          children are skipped. The Dialog is hoisted outside PageShell
          below so it stays mounted during loading. */}
      <>
          {pendingUsers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <h2 className="text-lg font-semibold text-slate-800">Pending Approval ({pendingUsers.length})</h2>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                {pendingUsers.map(u => (
                  <div key={u.id} className="flex items-center justify-between bg-white rounded-lg p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-semibold text-sm">
                        {u.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{u.name}</p>
                        <p className="text-sm text-slate-500">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(u.id)}
                        className="bg-spoke hover:bg-spoke/90 text-white"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReject(u.id)}
                        className="border-danger/30 text-danger hover:bg-danger-soft"
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingInvitations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-info" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-slate-800">Pending Invitations ({pendingInvitations.length})</h2>
              </div>
              <div className="bg-info-soft border border-info/20 rounded-lg p-4 space-y-3">
                {pendingInvitations.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between bg-white rounded-lg p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-info-soft flex items-center justify-center text-info font-semibold text-sm">
                        {(inv.name || inv.email)?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{inv.name || 'No name'}</p>
                        <p className="text-sm text-slate-500">{inv.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium px-2 py-1 rounded-full bg-indigo-100 text-indigo-700">
                        {inv.role}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRevokeInvitation(inv.id)}
                        className="text-danger hover:text-danger hover:bg-danger-soft"
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-800">All Users</h2>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">User</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Role</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {otherUsers.map(u => (
                    <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm">
                            {u.name?.charAt(0)?.toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 text-sm">{u.name}</p>
                            <p className="text-xs text-slate-500">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLES[u.status] || STATUS_STYLES.approved}`}>
                          {u.status || 'approved'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={u.role}
                          onValueChange={(value) => handleRoleChange(u.id, value)}
                          disabled={u.id === user.id}
                        >
                          <SelectTrigger className="w-32 h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map(r => (
                              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {u.id !== user.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(u.id)}
                            className="text-danger hover:text-danger hover:bg-danger-soft"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                        {u.id === user.id && (
                          <span className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                            <Shield className="w-3 h-3" /> You
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
    </PageShell>

      {/* Invite User Dialog — hoisted outside PageShell so it stays mounted
          during the loading state. */}
      <Dialog open={inviteDialogOpen} onOpenChange={closeInviteDialog}>
        <DialogContent className="sm:max-w-[440px] bg-white">
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              {generatedLink
                ? 'Share this link with the person you want to invite.'
                : 'Create an invitation link for a new user. They will be auto-approved when they register.'}
            </DialogDescription>
          </DialogHeader>

          {generatedLink ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-generated-link">Invitation Link</Label>
                <div className="flex gap-2">
                  <Input
                    id="invite-generated-link"
                    readOnly
                    value={generatedLink}
                    className="h-10 bg-gray-50 text-sm font-mono"
                  />
                  <Button
                    type="button"
                    onClick={handleCopyLink}
                    aria-label="Copy invitation link"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
                  >
                    <Copy className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  This link will allow the recipient to register and be automatically approved.
                </p>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  onClick={closeInviteDialog}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="user@company.com"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  required
                  className="h-10 bg-gray-50/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-name">Name (optional)</Label>
                <Input
                  id="invite-name"
                  placeholder="John Doe"
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  className="h-10 bg-gray-50/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={inviteForm.role}
                  onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
                >
                  <SelectTrigger id="invite-role" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={inviteLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {inviteLoading ? 'Creating...' : 'Create Invitation'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
