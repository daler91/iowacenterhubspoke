import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { toast } from 'sonner';
import { MapPin } from 'lucide-react';

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
      const detail = err.response?.data?.detail;
      toast.error(detail || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#F9FAFB] flex items-center justify-center p-4 sm:p-8" data-testid="forgot-password-page">
      <Card className="w-full max-w-md border-0 shadow-lg bg-white">
        <CardHeader className="space-y-1 pb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: 'Manrope, sans-serif' }}>HubSpoke</span>
          </div>
          <CardTitle className="text-2xl font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Forgot password
          </CardTitle>
          <CardDescription>
            Enter the email on your account and we'll send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                <p className="text-sm text-indigo-700 font-medium">
                  Check your inbox
                </p>
                <p className="text-xs text-indigo-500 mt-1">
                  If an account exists for that email, a reset link has been sent. The link expires in 1 hour.
                </p>
              </div>
              <Link
                to="/login"
                className="block text-center text-sm text-indigo-600 hover:text-indigo-700 font-medium"
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
                  className="h-11 bg-gray-50/50"
                />
              </div>
              <Button
                type="submit"
                data-testid="forgot-submit-button"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </Button>
              <div className="text-center">
                <Link
                  to="/login"
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
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
