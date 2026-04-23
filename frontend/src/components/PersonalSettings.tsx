import { useState, useEffect } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { User, Lock, Calendar, Mail, Unlink, Info, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { authAPI, employeesAPI, systemAPI } from '../lib/api';
import { useAuth } from '../lib/auth';
import { extractErrorMessage } from '../lib/types';
import type { LinkedEmployee } from '../lib/types';
import NotificationPreferences from './NotificationPreferences';

export default function PersonalSettings() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hash } = useLocation();

  // Scroll to the #notifications anchor when the panel links here directly.
  useEffect(() => {
    if (hash === '#notifications') {
      const el = document.getElementById('notifications');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [hash]);

  // Employee linked to current user
  const [employee, setEmployee] = useState<LinkedEmployee | null>(null);
  const [employeeLoading, setEmployeeLoading] = useState(true);

  // System config flags
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [outlookEnabled, setOutlookEnabled] = useState(false);

  // Password form
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [passwordLoading, setPasswordLoading] = useState(false);

  const fetchMyEmployee = async () => {
    try {
      const res = await authAPI.myEmployee();
      setEmployee(res.data.employee);
    } catch {
      setEmployee(null);
    } finally {
      setEmployeeLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      authAPI.myEmployee({ signal })
        .then(res => { if (!signal.aborted) setEmployee(res.data.employee); })
        .catch(err => {
          if (signal.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') return;
          setEmployee(null);
        }),
      systemAPI.getConfig({ signal })
        .then(res => {
          if (signal.aborted) return;
          setGoogleEnabled(res.data.google_oauth_enabled);
          setOutlookEnabled(res.data.outlook_oauth_enabled || res.data.outlook_enabled);
        })
        .catch(err => {
          if (signal.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') return;
          console.warn('Failed to load system config for calendar integrations');
        }),
    ]).finally(() => {
      if (!signal.aborted) setEmployeeLoading(false);
    });
    return () => controller.abort();
  }, []);

  // Handle OAuth callback query params
  useEffect(() => {
    const googleOAuth = searchParams.get('google_oauth');
    const outlookOAuth = searchParams.get('outlook_oauth');
    const message = searchParams.get('message');
    if (googleOAuth) {
      if (googleOAuth === 'success') {
        toast.success(message || 'Google Calendar connected');
        fetchMyEmployee();
      } else {
        toast.error(message || 'Google Calendar authorization failed');
      }
      searchParams.delete('google_oauth');
      searchParams.delete('message');
      setSearchParams(searchParams, { replace: true });
    }
    if (outlookOAuth) {
      if (outlookOAuth === 'success') {
        toast.success(message || 'Outlook Calendar connected');
        fetchMyEmployee();
      } else {
        toast.error(message || 'Outlook Calendar authorization failed');
      }
      searchParams.delete('outlook_oauth');
      searchParams.delete('message');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast.error('New passwords do not match');
      return;
    }
    if (passwordForm.new_password.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    setPasswordLoading(true);
    try {
      await authAPI.changePassword({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      toast.success('Password changed successfully');
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to change password'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleGoogleConnect = async () => {
    if (!employee) return;
    try {
      const res = await employeesAPI.googleAuthorize(employee.id);
      globalThis.location.href = res.data.auth_url;
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to start Google Calendar authorization'));
    }
  };

  const handleGoogleDisconnect = async () => {
    if (!employee) return;
    try {
      await employeesAPI.googleDisconnect(employee.id);
      toast.success('Google Calendar disconnected');
      fetchMyEmployee();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to disconnect Google Calendar'));
    }
  };

  const handleOutlookConnect = async () => {
    if (!employee) return;
    try {
      const res = await employeesAPI.outlookAuthorize(employee.id);
      globalThis.location.href = res.data.auth_url;
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to start Outlook Calendar authorization'));
    }
  };

  const handleOutlookDisconnect = async () => {
    if (!employee) return;
    try {
      await employeesAPI.outlookDisconnect(employee.id);
      toast.success('Outlook Calendar disconnected');
      fetchMyEmployee();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to disconnect Outlook Calendar'));
    }
  };

  const renderCalendarContent = () => {
    if (employeeLoading) {
      return (
        <output
          className="flex items-center justify-center py-8"
          aria-label="Loading calendar connections"
        >
          <span className="w-6 h-6 border-2 border-hub border-t-transparent rounded-full animate-spin" />
        </output>
      );
    }

    if (!employee) {
      return (
        <div className="flex items-start gap-3 p-4 bg-muted/50 dark:bg-muted rounded-lg">
          <Info className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-foreground/80 dark:text-muted-foreground">
              No employee record found matching your email (<span className="font-medium">{user?.email}</span>).
            </p>
            <p className="text-sm text-foreground/80 dark:text-muted-foreground mt-1">
              To connect a calendar, ask an admin to create an employee with this email address.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {googleEnabled && (
          <div className="flex items-center justify-between p-4 bg-muted/50 dark:bg-muted rounded-lg">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-spoke" />
              <div>
                <p className="text-sm font-medium text-foreground">Google Calendar</p>
                {employee.google_calendar_connected ? (
                  <p className="text-xs text-spoke">
                    Connected{employee.google_calendar_email ? ` — ${employee.google_calendar_email}` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-foreground/80 dark:text-muted-foreground">Not connected</p>
                )}
              </div>
            </div>
            {employee.google_calendar_connected ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoogleDisconnect}
                className="text-danger hover:text-danger hover:bg-danger-soft"
              >
                <Unlink className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleGoogleConnect}
                className="bg-spoke hover:bg-spoke text-white"
              >
                Connect
              </Button>
            )}
          </div>
        )}

        {outlookEnabled && (
          <div className="flex items-center justify-between p-4 bg-muted/50 dark:bg-muted rounded-lg">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-info" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">Outlook Calendar</p>
                {employee.outlook_calendar_connected ? (
                  <p className="text-xs text-info">
                    Connected{employee.outlook_calendar_email ? ` — ${employee.outlook_calendar_email}` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-foreground/80 dark:text-muted-foreground">Not connected</p>
                )}
              </div>
            </div>
            {employee.outlook_calendar_connected ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOutlookDisconnect}
                className="text-danger hover:text-danger hover:bg-danger-soft"
              >
                <Unlink className="w-4 h-4 mr-2" aria-hidden="true" />
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleOutlookConnect}
                className="bg-info hover:bg-info/90 text-white"
              >
                Connect
              </Button>
            )}
          </div>
        )}

        {!googleEnabled && !outlookEnabled && (
          <div className="flex items-start gap-3 p-4 bg-muted/50 dark:bg-muted rounded-lg">
            <Info className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-foreground/80 dark:text-muted-foreground">
              No calendar integrations are configured. Contact your administrator to enable Google or Outlook calendar connections.
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-slide-in max-w-2xl">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground dark:text-white font-display">Settings</h2>
        <p className="text-sm text-foreground/80 dark:text-muted-foreground mt-1">Manage your account and calendar connections</p>
      </div>

      {/* Profile Info */}
      <div className="bg-white dark:bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <User className="w-5 h-5 text-hub" />
          <h3 className="text-lg font-semibold text-foreground dark:text-white font-display">Profile</h3>
        </div>
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full bg-hub-soft/50 flex items-center justify-center text-hub-strong dark:text-hub-soft font-bold text-lg"
            >
              {user?.name?.charAt(0)?.toUpperCase()}
            </div>
            <div>
              <p className="font-medium text-foreground">{user?.name}</p>
              <p className="text-sm text-foreground/80 dark:text-muted-foreground">{user?.email}</p>
            </div>
            <span className="ml-auto text-xs px-2 py-1 rounded-full bg-muted text-foreground/80 dark:text-muted-foreground font-bold uppercase tracking-wider">
              {user?.role}
            </span>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-white dark:bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <Lock className="w-5 h-5 text-hub" />
          <h3 className="text-lg font-semibold text-foreground dark:text-white font-display">Change Password</h3>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              value={passwordForm.current_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
              required
              className="bg-muted/50 dark:bg-muted max-w-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={passwordForm.new_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
              required
              className="bg-muted/50 dark:bg-muted max-w-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={passwordForm.confirm_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
              required
              className="bg-muted/50 dark:bg-muted max-w-sm"
            />
          </div>
          <Button
            type="submit"
            disabled={passwordLoading}
            className="bg-hub hover:bg-hub-strong text-white"
          >
            {passwordLoading ? 'Changing...' : 'Change Password'}
          </Button>
        </form>
      </div>

      {/* Calendar Connections */}
      <div className="bg-white dark:bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="w-5 h-5 text-hub" />
          <h3 className="text-lg font-semibold text-foreground dark:text-white font-display">Calendar Connections</h3>
        </div>

        {renderCalendarContent()}
      </div>

      {/* Notification Preferences */}
      <div id="notifications" className="bg-white dark:bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-3 mb-1">
          <Bell className="w-5 h-5 text-hub" />
          <h3 className="text-lg font-semibold text-foreground dark:text-white font-display">Notifications</h3>
        </div>
        <p className="text-sm text-foreground/80 dark:text-muted-foreground mb-4">
          Choose which notifications you receive and how.
        </p>
        <NotificationPreferences mode="internal" />
      </div>
    </div>
  );
}
