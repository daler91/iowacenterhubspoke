import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authAPI } from '../lib/api';
import { describeApiError } from '../lib/error-messages';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Logo } from '../components/ui/logo';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authAPI.forgotPassword(email);
      setSubmitted(true);
      toast.success('If that email is registered, a reset link is on its way');
    } catch (err: any) {
      toast.error(describeApiError(err, 'Couldn\u2019t send reset link \u2014 please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-background flex items-center justify-center p-4 sm:p-8" data-testid="forgot-password-page">
      <Card className="w-full max-w-md border-0 shadow-lg bg-card">
        <CardHeader className="space-y-1 pb-6">
          <div className="flex items-center gap-2 mb-4">
            <Logo aria-hidden="true" className="size-8 text-hub" />
            <span className="font-bold text-lg font-display">HubSpoke</span>
          </div>
          <CardTitle className="text-2xl font-bold font-display">
            Forgot password
          </CardTitle>
          <CardDescription>
            Enter the email on your account and we'll send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <div className="p-3 bg-hub-soft border border-hub-soft rounded-lg">
                <p className="text-sm text-hub-strong font-medium">
                  Check your inbox
                </p>
                <p className="text-xs text-hub mt-1">
                  If an account exists for that email, a reset link has been sent. The link expires in 1 hour.
                </p>
              </div>
              <Link
                to="/login"
                className="block text-center text-sm text-hub hover:text-hub-strong font-medium"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  data-testid="forgot-email-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 bg-muted/50"
                />
              </div>
              <Button
                type="submit"
                data-testid="forgot-submit-button"
                disabled={loading}
                className="w-full h-11 bg-hub hover:bg-hub-strong text-white font-medium rounded-lg"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </Button>
              <div className="text-center">
                <Link
                  to="/login"
                  className="text-sm text-hub hover:text-hub-strong font-medium"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
