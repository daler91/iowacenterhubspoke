import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { PageShell } from './ui/page-shell';
import { CheckCircle, XCircle, Trash2, Shield, Clock, UserPlus, Mail, LogOut, Lock, Unlock } from 'lucide-react';
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

// Isolate one "All Users" row into its own memoized component so typing
// in the invite dialog, revoking a single invitation, or changing one
// role doesn't re-render the other N-1 rows. Paired with useCallback'd
// handlers on the parent, changing one user leaves the other rows'
// React output fully cached.
type UserRowProps = {
  u: { id: string; name?: string; email?: string; role?: string; status?: string };
  isSelf: boolean;
  onRoleChange: (userId: string, role: string) => void;
  onOpenSessions: (u: { id: string; email: string }) => void;
  onDelete: (userId: string) => void;
};

const UserRow = memo(function UserRow({
  u,
  isSelf,
  onRoleChange,
  onOpenSessions,
  onDelete,
}: UserRowProps) {
  return (
    <tr className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm">
            {u.name?.charAt(0)?.toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-slate-900 dark:text-gray-100 text-sm">{u.name}</p>
            <p className="text-xs text-slate-500 dark:text-gray-400">{u.email}</p>
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
          onValueChange={(value) => onRoleChange(u.id, value)}
          disabled={isSelf}
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
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenSessions({ id: u.id, email: u.email || '' })}
            aria-label={`View sessions for ${u.email || 'user'}`}
            title="View active sessions"
            className="text-muted-foreground hover:text-indigo-600"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
          </Button>
          {!isSelf && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(u.id)}
              aria-label={`Delete ${u.email || 'user'}`}
              className="text-danger hover:text-danger hover:bg-danger-soft"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </Button>
          )}
          {isSelf && (
            <span className="text-xs text-muted-foreground flex items-center justify-end gap-1 ml-1">
              <Shield className="w-3 h-3" /> You
            </span>
          )}
        </div>
      </td>
    </tr>
  );
});

export default function UserManager() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'viewer' });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [invitationSent, setInvitationSent] = useState<{ email: string; emailSent: boolean } | null>(null);
  const [invitations, setInvitations] = useState([]);

  // Sessions dialog — reached per-user via the "Sessions" button.
  const [sessionsFor, setSessionsFor] = useState<{ id: string; email: string } | null>(null);
  const [sessions, setSessions] = useState<Array<{ jti: string; jti_prefix: string; issued_at?: string; expires_at?: string }>>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);

  // Active brute-force lockouts. Fetched alongside users and rendered
  // inline above the user list when non-empty.
  const [lockouts, setLockouts] = useState<Array<{ email: string; email_masked: string; count: number; expires_at: string }>>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; email?: string; name?: string; role?: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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

  const fetchLockouts = useCallback(async () => {
    try {
      const res = await usersAPI.listLockouts();
      setLockouts(Array.isArray(res.data.lockouts) ? res.data.lockouts : []);
    } catch {
      // Silent — security lockouts are supplementary info on the page.
    }
  }, []);

  useEffect(() => {
    // Run the three independent fetches in parallel — serialising them
    // forced first paint to wait for ~3× the slowest single round-trip.
    Promise.all([fetchUsers(), fetchInvitations(), fetchLockouts()]).catch(() => {
      // Each fetch already surfaces its own error; nothing to do here.
    });
  }, [fetchUsers, fetchInvitations, fetchLockouts]);

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

  // useCallback so UserRow's React.memo comparison keeps sibling rows
  // from re-rendering when only one row mutates. fetchUsers is already
  // memoized, so each callback has a stable identity across renders.
  const handleRoleChange = useCallback(async (userId: string, role: string) => {
    try {
      await usersAPI.updateRole(userId, role);
      toast.success(`Role updated to ${role}`);
      fetchUsers();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to update role'));
    }
  }, [fetchUsers]);

  const handleDelete = useCallback(async (userId: string) => {
    try {
      await usersAPI.delete(userId);
      toast.success('User deleted');
      fetchUsers();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to delete user'));
    }
  }, [fetchUsers]);

  const requestDelete = useCallback((userId: string) => {
    const u = users.find(x => x.id === userId);
    if (!u) return;
    setDeleteConfirmText('');
    setDeleteTarget({ id: u.id, email: u.email, name: u.name, role: u.role });
  }, [users]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setDeleteConfirmText('');
    await handleDelete(target.id);
  }, [deleteTarget, handleDelete]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteForm.email) {
      toast.error('Email is required');
      return;
    }
    setInviteLoading(true);
    try {
      // Backend intentionally does NOT return the raw invite token any
      // more — it sends the email directly. We show a confirmation
      // panel; if the email fails the backend flags ``email_sent:false``
      // and the admin can resend from the invitations list.
      const res = await usersAPI.invite({
        email: inviteForm.email,
        name: inviteForm.name || null,
        role: inviteForm.role,
      });
      setInvitationSent({
        email: res.data.email,
        emailSent: Boolean(res.data.email_sent),
      });
      toast.success('Invitation created');
      fetchInvitations();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to create invitation'));
    } finally {
      setInviteLoading(false);
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
    setInvitationSent(null);
    setInviteForm({ email: '', name: '', role: 'viewer' });
  };

  const openSessions = useCallback(async (u: { id: string; email: string }) => {
    setSessionsFor(u);
    setSessions([]);
    setSessionsLoading(true);
    try {
      const res = await usersAPI.listSessions(u.id);
      setSessions(Array.isArray(res.data.sessions) ? res.data.sessions : []);
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to load sessions'));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const closeSessions = () => {
    setSessionsFor(null);
    setSessions([]);
  };

  const handleRevokeAllSessions = async () => {
    if (!sessionsFor) return;
    setRevokingSessions(true);
    try {
      const res = await usersAPI.revokeAllSessions(sessionsFor.id);
      toast.success(`Revoked ${res.data.revoked_count || 0} session(s)`);
      setSessions([]);
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to revoke sessions'));
    } finally {
      setRevokingSessions(false);
    }
  };

  const handleClearLockout = async (email: string) => {
    try {
      await usersAPI.clearLockout(email);
      toast.success(`Cleared lockout for ${email}`);
      fetchLockouts();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to clear lockout'));
    }
  };

  // Derived lists must be computed before any conditional return so the hook
  // call order stays stable across renders (rules-of-hooks).
  const { pendingUsers, otherUsers, pendingInvitations } = useMemo(() => ({
    pendingUsers: users.filter(u => u.status === 'pending'),
    otherUsers: users.filter(u => u.status !== 'pending'),
    pendingInvitations: invitations.filter(i => i.status === 'pending'),
  }), [users, invitations]);

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
                <h2 className="text-lg font-semibold text-slate-800 dark:text-gray-100">Pending Approval ({pendingUsers.length})</h2>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                {pendingUsers.map(u => (
                  <div key={u.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-lg p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-semibold text-sm">
                        {u.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-gray-100">{u.name}</p>
                        <p className="text-sm text-slate-500 dark:text-gray-400">{u.email}</p>
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
                <h2 className="text-lg font-semibold text-slate-800 dark:text-gray-100">Pending Invitations ({pendingInvitations.length})</h2>
              </div>
              <div className="bg-info-soft border border-info/20 rounded-lg p-4 space-y-3">
                {pendingInvitations.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-lg p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-info-soft flex items-center justify-center text-info font-semibold text-sm">
                        {(inv.name || inv.email)?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-gray-100">{inv.name || 'No name'}</p>
                        <p className="text-sm text-slate-500 dark:text-gray-400">{inv.email}</p>
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

          {lockouts.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-danger" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-slate-800 dark:text-gray-100">
                  Security Lockouts ({lockouts.length})
                </h2>
              </div>
              <div className="bg-danger-soft border border-danger/20 rounded-lg p-4 space-y-2">
                <p className="text-xs text-danger">
                  These accounts have hit the per-email failed-login threshold
                  and are temporarily blocked from signing in. Clear a
                  lockout if the user is locked out by mistake.
                </p>
                {lockouts.map((l) => (
                  <div
                    key={l.email}
                    className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-lg p-3 shadow-sm"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-gray-100">
                        {l.email}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-gray-400">
                        {l.count} failures &middot; unlocks {new Date(l.expires_at).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleClearLockout(l.email)}
                      className="border-spoke/30 text-spoke hover:bg-spoke-soft"
                    >
                      <Unlock className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                      Clear
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-gray-100">All Users</h2>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">User</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">Role</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {otherUsers.map(u => (
                    <UserRow
                      key={u.id}
                      u={u}
                      isSelf={u.id === user.id}
                      onRoleChange={handleRoleChange}
                      onOpenSessions={openSessions}
                      onDelete={requestDelete}
                    />
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
        <DialogContent className="sm:max-w-[440px] bg-white dark:bg-gray-900">
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              {invitationSent
                ? 'The invitation has been created.'
                : 'Create an invitation for a new user. We\u2019ll email them a signup link that auto-approves their account.'}
            </DialogDescription>
          </DialogHeader>

          {invitationSent ? (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-spoke-soft border border-spoke/20">
                <p className="text-sm font-medium text-spoke flex items-center gap-2">
                  <Mail className="w-4 h-4" aria-hidden="true" />
                  {invitationSent.emailSent
                    ? `Invitation emailed to ${invitationSent.email}`
                    : `Invitation created for ${invitationSent.email}`}
                </p>
                {!invitationSent.emailSent && (
                  <p className="text-xs text-amber-700 mt-2">
                    We couldn&rsquo;t send the email right now. The invitation is
                    still valid &mdash; you can resend it from the Pending
                    Invitations list below, or ask the user to check their
                    spam folder if they receive it later.
                  </p>
                )}
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
                  className="h-10 bg-gray-50/50 dark:bg-gray-800"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-name">Name (optional)</Label>
                <Input
                  id="invite-name"
                  placeholder="John Doe"
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  className="h-10 bg-gray-50/50 dark:bg-gray-800"
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

      {/* Active-session management for a single user. Opens when an admin
          clicks the logout-icon button on a row. "Revoke all" invalidates
          every refresh token for that user across every device; their
          current access token lives until it expires (typically 4h). */}
      <Dialog open={!!sessionsFor} onOpenChange={(o) => { if (!o) closeSessions(); }}>
        <DialogContent className="sm:max-w-[480px] bg-white dark:bg-gray-900">
          <DialogHeader>
            <DialogTitle>Active sessions</DialogTitle>
            <DialogDescription>
              {sessionsFor ? sessionsFor.email : ''}
            </DialogDescription>
          </DialogHeader>
          {sessionsLoading && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-center py-8 text-sm text-muted-foreground"
            >
              <span className="sr-only">Loading sessions</span>
              <span
                aria-hidden="true"
                className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"
              />
            </div>
          )}
          {!sessionsLoading && sessions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No active sessions.
            </p>
          )}
          {!sessionsLoading && sessions.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {sessions.map((s) => (
                <div
                  key={s.jti}
                  className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg p-3"
                >
                  <div>
                    <p className="text-sm font-mono text-slate-900 dark:text-gray-100">
                      {s.jti_prefix}&hellip;
                    </p>
                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      {s.issued_at
                        ? `issued ${new Date(s.issued_at).toLocaleString()}`
                        : 'issue time unknown'}
                    </p>
                  </div>
                  {s.expires_at && (
                    <p className="text-xs text-muted-foreground">
                      expires {new Date(s.expires_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeSessions}>
              Close
            </Button>
            <Button
              onClick={handleRevokeAllSessions}
              disabled={revokingSessions || sessions.length === 0}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              {revokingSessions ? 'Revoking\u2026' : 'Revoke all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteConfirmText(''); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.name || deleteTarget?.email || 'user'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.role === 'admin' ? (
                <>
                  <strong>{deleteTarget?.email}</strong> is an <strong>administrator</strong>.
                  Deleting this account revokes their access and cannot be undone.
                  Type <strong>DELETE</strong> below to confirm.
                </>
              ) : (
                <>
                  This removes <strong>{deleteTarget?.email}</strong> and revokes all their active sessions.
                  This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget?.role === 'admin' && (
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              aria-label="Type DELETE to confirm"
              autoComplete="off"
              className="mt-2"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteTarget?.role === 'admin' && deleteConfirmText !== 'DELETE'}
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
