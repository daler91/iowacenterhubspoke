import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { authAPI, REPLAY_LOGOUT_FLAG } from '../lib/api';
import { describeApiError } from '../lib/error-messages';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { toast } from 'sonner';
import { MapPin, Clock, Users, ShieldAlert } from 'lucide-react';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [searchParams] = useSearchParams();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [replayLogout, setReplayLogout] = useState(false);
  const [inviteData, setInviteData] = useState<{ email: string; name?: string; role: string } | null>(null);
  const inviteToken = searchParams.get('invite');

  // Read the one-shot "refresh-token replay detected" flag set by the
  // api.ts interceptor and clear it so the banner only shows once.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(REPLAY_LOGOUT_FLAG)) {
        setReplayLogout(true);
        sessionStorage.removeItem(REPLAY_LOGOUT_FLAG);
      }
    } catch {
      // sessionStorage unavailable (private mode) — nothing to surface.
    }
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authAPI.validateInvite(inviteToken);
        if (cancelled) return;
        setInviteData(res.data);
        setIsLogin(false);
        setForm(prev => ({
          ...prev,
          email: res.data.email,
          name: res.data.name || '',
        }));
      } catch {
        if (!cancelled) {
          toast.error('This invitation link is invalid or has expired');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [inviteToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Self-service signups must accept the privacy notice; invitation flows
    // are exempt because the admin who issued the invite already agreed on
    // the user's behalf.
    if (!isLogin && !inviteData && !privacyAccepted) {
      toast.error('Please review and accept the privacy notice to continue.');
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        await login(form.email, form.password);
        toast.success('Welcome back!');
      } else {
        const result = await register(
          form.name,
          form.email,
          form.password,
          inviteToken || null,
          privacyAccepted,
        );
        if (result.pending) {
          toast.info('Registration submitted! An admin will review your account.');
          setIsLogin(true);
          setForm({ name: '', email: '', password: '' });
          setPrivacyAccepted(false);
        } else {
          toast.success('Account created successfully!');
        }
      }
    } catch (err: any) {
      if (err.response?.status === 403) {
        const detail = err.response?.data?.detail;
        toast.warning(typeof detail === 'string' && detail ? detail : 'Access denied');
      } else {
        toast.error(describeApiError(err, 'Something went wrong. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  };

  let pageTitle = 'Create account';
  let pageDescription = 'Get started with your scheduling hub';
  if (inviteData) {
    pageTitle = 'Accept Invitation';
    pageDescription = `You've been invited to join as ${inviteData.role}`;
  } else if (isLogin) {
    pageTitle = 'Sign in';
    pageDescription = 'Enter your credentials to access the scheduler';
  }

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#F9FAFB] dark:bg-gray-950 flex" data-testid="login-page">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-indigo-600 relative overflow-hidden flex-col justify-between p-12">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <MapPin className="w-6 h-6 text-white" />
            </div>
            <span className="text-white text-xl font-bold font-display">
              HubSpoke
            </span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-6 font-display">
            Smart Employee<br />Scheduling
          </h1>
          <p className="text-indigo-100 text-lg max-w-md leading-relaxed">
            Manage your hub-and-spoke travel model with automatic drive time blocking and intelligent scheduling.
          </p>
        </div>
        <div className="relative z-10 flex gap-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-indigo-200" />
            </div>
            <div>
              <p className="text-white font-semibold text-sm">Auto Travel</p>
              <p className="text-indigo-200 text-xs">Time blocking</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-indigo-200" />
            </div>
            <div>
              <p className="text-white font-semibold text-sm">Team View</p>
              <p className="text-indigo-200 text-xs">Weekly calendar</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-indigo-200" />
            </div>
            <div>
              <p className="text-white font-semibold text-sm">Map View</p>
              <p className="text-indigo-200 text-xs">Visual routes</p>
            </div>
          </div>
        </div>
        {/* Decorative circles */}
        <div className="absolute top-1/4 right-0 w-96 h-96 bg-indigo-500 rounded-full opacity-30 translate-x-1/2" />
        <div className="absolute bottom-0 left-1/4 w-64 h-64 bg-indigo-700 rounded-full opacity-40 translate-y-1/2" />
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-y-auto relative z-10">
        <Card className="w-full max-w-md border-0 shadow-lg bg-white dark:bg-gray-900">
          <CardHeader className="space-y-1 pb-6">
            <div className="lg:hidden flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                <MapPin className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-lg font-display">HubSpoke</span>
            </div>
            <CardTitle className="text-2xl font-bold font-display">
              {pageTitle}
            </CardTitle>
            <CardDescription>
              {pageDescription}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {replayLogout && (
              <div
                role="alert"
                className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-2"
                data-testid="replay-logout-banner"
              >
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm text-amber-800 font-medium">
                    All devices were signed out for safety
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    We detected a reused session cookie — if that wasn&rsquo;t you,
                    someone may have copied an old cookie. Sign in again to continue.
                  </p>
                </div>
              </div>
            )}
            {inviteData && (
              <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                <p className="text-sm text-indigo-700 font-medium">
                  Invitation for {inviteData.email}
                </p>
                <p className="text-xs text-indigo-500 mt-1">
                  Complete your registration below to get started.
                </p>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    data-testid="register-name-input"
                    placeholder="John Doe"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required={!isLogin}
                    className="h-11 bg-gray-50/50 dark:bg-gray-800/50"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  data-testid="login-email-input"
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  disabled={!!inviteData}
                  className={`h-11 bg-gray-50/50 dark:bg-gray-800/50 ${inviteData ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {isLogin && !inviteData && (
                    <Link
                      to="/forgot-password"
                      data-testid="forgot-password-link"
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  data-testid="login-password-input"
                  placeholder="Enter password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  className="h-11 bg-gray-50/50 dark:bg-gray-800/50"
                />
              </div>
              {!isLogin && !inviteData && (
                <label
                  htmlFor="privacy-consent"
                  className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer"
                >
                  <input
                    id="privacy-consent"
                    type="checkbox"
                    data-testid="register-privacy-checkbox"
                    checked={privacyAccepted}
                    onChange={(e) => setPrivacyAccepted(e.target.checked)}
                    className="mt-0.5"
                    required
                  />
                  <span>
                    I understand HubSpoke stores my name and email, and may share
                    location and calendar data with Google or Microsoft if I
                    connect those integrations.
                  </span>
                </label>
              )}
              <Button
                type="submit"
                data-testid="login-submit-button"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg"
              >
                {(() => {
                  if (loading) return 'Please wait...';
                  if (inviteData) return 'Create Account';
                  return isLogin ? 'Sign In' : 'Create Account';
                })()}
              </Button>
            </form>
            {!inviteData && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  data-testid="toggle-auth-mode"
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
