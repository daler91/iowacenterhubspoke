import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { User, Lock, Calendar, Mail, Unlink, Info } from 'lucide-react';
import { toast } from 'sonner';
import { authAPI, employeesAPI, systemAPI } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function PersonalSettings() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Employee linked to current user
  const [employee, setEmployee] = useState<any>(null);
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
    fetchMyEmployee();
    systemAPI.getConfig().then((res) => {
      setGoogleEnabled(res.data.google_oauth_enabled);
      setOutlookEnabled(res.data.outlook_oauth_enabled || res.data.outlook_enabled);
    }).catch(() => {});
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
    if (passwordForm.new_password.length < 6) {
      toast.error('New password must be at least 6 characters');
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
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleGoogleConnect = async () => {
    if (!employee) return;
    try {
      const res = await employeesAPI.googleAuthorize(employee.id);
      globalThis.location.href = res.data.auth_url;
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to start Google Calendar authorization');
    }
  };

  const handleGoogleDisconnect = async () => {
    if (!employee) return;
    try {
      await employeesAPI.googleDisconnect(employee.id);
      toast.success('Google Calendar disconnected');
      fetchMyEmployee();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to disconnect Google Calendar');
    }
  };

  const handleOutlookConnect = async () => {
    if (!employee) return;
    try {
      const res = await employeesAPI.outlookAuthorize(employee.id);
      globalThis.location.href = res.data.auth_url;
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to start Outlook Calendar authorization');
    }
  };

  const handleOutlookDisconnect = async () => {
    if (!employee) return;
    try {
      await employeesAPI.outlookDisconnect(employee.id);
      toast.success('Outlook Calendar disconnected');
      fetchMyEmployee();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to disconnect Outlook Calendar');
    }
  };

  const renderCalendarContent = () => {
    if (employeeLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    if (!employee) {
      return (
        <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-gray-800 rounded-lg">
          <Info className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              No employee record found matching your email (<span className="font-medium">{user?.email}</span>).
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              To connect a calendar, ask an admin to create an employee with this email address.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {googleEnabled && (
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-gray-800 rounded-lg">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-teal-500" />
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Google Calendar</p>
                {employee.google_calendar_connected ? (
                  <p className="text-xs text-teal-600 dark:text-teal-400">
                    Connected{employee.google_calendar_email ? ` — ${employee.google_calendar_email}` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Not connected</p>
                )}
              </div>
            </div>
            {employee.google_calendar_connected ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoogleDisconnect}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <Unlink className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleGoogleConnect}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                Connect
              </Button>
            )}
          </div>
        )}

        {outlookEnabled && (
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-gray-800 rounded-lg">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Outlook Calendar</p>
                {employee.outlook_calendar_connected ? (
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    Connected{employee.outlook_calendar_email ? ` — ${employee.outlook_calendar_email}` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Not connected</p>
                )}
              </div>
            </div>
            {employee.outlook_calendar_connected ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOutlookDisconnect}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <Unlink className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleOutlookConnect}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Connect
              </Button>
            )}
          </div>
        )}

        {!googleEnabled && !outlookEnabled && (
          <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-gray-800 rounded-lg">
            <Info className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
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
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Settings</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage your account and calendar connections</p>
      </div>

      {/* Profile Info */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6">
        <div className="flex items-center gap-3 mb-4">
          <User className="w-5 h-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Profile</h3>
        </div>
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-lg"
            >
              {user?.name?.charAt(0)?.toUpperCase()}
            </div>
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-100">{user?.name}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
            </div>
            <span className="ml-auto text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">
              {user?.role}
            </span>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Lock className="w-5 h-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Change Password</h3>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-2">
            <Label>Current Password</Label>
            <Input
              type="password"
              value={passwordForm.current_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
              required
              className="bg-gray-50/50 dark:bg-gray-800 max-w-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>New Password</Label>
            <Input
              type="password"
              value={passwordForm.new_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
              required
              className="bg-gray-50/50 dark:bg-gray-800 max-w-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Confirm New Password</Label>
            <Input
              type="password"
              value={passwordForm.confirm_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
              required
              className="bg-gray-50/50 dark:bg-gray-800 max-w-sm"
            />
          </div>
          <Button
            type="submit"
            disabled={passwordLoading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {passwordLoading ? 'Changing...' : 'Change Password'}
          </Button>
        </form>
      </div>

      {/* Calendar Connections */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Calendar Connections</h3>
        </div>

        {renderCalendarContent()}
      </div>
    </div>
  );
}
