import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { authAPI } from '../lib/api';
import { describeApiError } from '../lib/error-messages';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { toast } from 'sonner';
import { MapPin } from 'lucide-react';

type TokenState = 'checking' | 'valid' | 'invalid';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [tokenState, setTokenState] = useState<TokenState>('checking');
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenState('invalid');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await authAPI.validateResetToken(token);
        if (cancelled) return;
        setEmail(res.data.email ?? null);
        setTokenState('valid');
      } catch {
        if (!cancelled) setTokenState('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authAPI.resetPassword(token, password);
      toast.success('Password reset! You can now sign in.');
      navigate('/login', { replace: true });
    } catch (err: any) {
      toast.error(describeApiError(err, 'Couldn\u2019t reset password \u2014 the link may have expired.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#F9FAFB] dark:bg-gray-950 flex items-center justify-center p-4 sm:p-8" data-testid="reset-password-page">
      <Card className="w-full max-w-md border-0 shadow-lg bg-white dark:bg-gray-900">
        <CardHeader className="space-y-1 pb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: 'Manrope, sans-serif' }}>HubSpoke</span>
          </div>
          <CardTitle className="text-2xl font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Reset password
          </CardTitle>
          <CardDescription>
            {tokenState === 'valid' && email
              ? `Choose a new password for ${email}.`
              : 'Set a new password for your account.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tokenState === 'checking' && (
            <p className="text-sm text-slate-500 dark:text-gray-400 text-center py-8">Validating reset link...</p>
          )}
          {tokenState === 'invalid' && (
            <div className="space-y-4">
              <div className="p-3 bg-danger-soft border border-danger/30 rounded-lg" role="alert">
                <p className="text-sm text-danger font-medium">
                  Invalid or expired reset link
                </p>
                <p className="text-xs text-danger mt-1">
                  Reset links expire after 1 hour. Request a new one to continue.
                </p>
              </div>
              <Link
                to="/forgot-password"
                className="block text-center text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Request a new reset link
              </Link>
            </div>
          )}
          {tokenState === 'valid' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  data-testid="reset-password-input"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="h-11 bg-gray-50/50 dark:bg-gray-800/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  data-testid="reset-confirm-input"
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  className="h-11 bg-gray-50/50 dark:bg-gray-800/50"
                />
              </div>
              <Button
                type="submit"
                data-testid="reset-submit-button"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg"
              >
                {loading ? 'Saving...' : 'Set new password'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
