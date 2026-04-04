import { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Users, CheckCircle, XCircle, Trash2, Shield, Clock, UserPlus, Copy, Mail } from 'lucide-react';
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
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const INVITE_STATUS_STYLES = {
  pending: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  revoked: 'bg-red-100 text-red-700',
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
      <div className="flex items-center justify-center h-64 text-slate-500">
        You do not have permission to view this page.
      </div>
    );
  }

  const pendingUsers = users.filter(u => u.status === 'pending');
  const otherUsers = users.filter(u => u.status !== 'pending');
  const pendingInvitations = invitations.filter(i => i.status === 'pending');

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Manrope, sans-serif' }}>
              User Management
            </h1>
            <p className="text-sm text-slate-500">{users.length} total users</p>
          </div>
        </div>
        <Button
          onClick={() => setInviteDialogOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Invite User
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {pendingUsers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <h2 className="text-lg font-semibold text-slate-800">Pending Approval ({pendingUsers.length})</h2>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
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
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReject(u.id)}
                        className="border-red-300 text-red-600 hover:bg-red-50"
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
                <Mail className="w-4 h-4 text-blue-500" />
                <h2 className="text-lg font-semibold text-slate-800">Pending Invitations ({pendingInvitations.length})</h2>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                {pendingInvitations.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between bg-white rounded-lg p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm">
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
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
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
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
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
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                        {u.id === user.id && (
                          <span className="text-xs text-slate-400 flex items-center justify-end gap-1">
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
      )}

      {/* Invite User Dialog */}
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
                <Label>Invitation Link</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={generatedLink}
                    className="h-10 bg-gray-50 text-sm font-mono"
                  />
                  <Button
                    type="button"
                    onClick={handleCopyLink}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
                  >
                    <Copy className="w-4 h-4" />
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
                <Label>Role</Label>
                <Select
                  value={inviteForm.role}
                  onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
                >
                  <SelectTrigger className="h-10">
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
    </div>
  );
}
