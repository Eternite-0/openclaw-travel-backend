import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Compass, Eye, EyeOff } from 'lucide-react';
import { login } from '../api';

interface LoginViewProps {
  onLogin: () => void;
}

export function LoginView({ onLogin }: LoginViewProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('请填写邮箱和密码');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Support both email and username login
      await login({ username: email.trim(), password: password.trim() });
      onLogin();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败';
      // Extract user-friendly message from API error
      try {
        const parsed = JSON.parse(msg.split(': ')[1] || '{}');
        setError(parsed.detail || '邮箱/用户名或密码错误');
      } catch {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [email, password, onLogin]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
    >
      {/* Background */}
      <div className="fixed inset-0 z-0">
        <img
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuBGwuKUccWftu-bShmj0cm0IOTBZax-Ztyij55wIIg0k6qEooFzuOnTRo0y8pjb4pC-bosPaN8afEdoi-Z2f9fURCoqDXLwc2gLdVTwnW7Kn3wYAhnVWH4t8yI1d1xiV2wPm6jvP2WW7tg06gv_wdvKRBaf-Oo-YmfVPywz4JSnEtQNktd_-3n4CQ151VAhruhxVfwoTW77NqjHxQLJHngOWVa55XqOA1WQ2hsxyN8kBcEm5JJAQlJ_sTjg9WKrPY1iCnCxLNjBnC49"
          alt="Travel landscape background"
          className="w-full h-full object-cover brightness-90 blur-[6px]"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/10" />
      </div>

      {/* Login Card */}
      <main className="relative z-10 w-full max-w-[1000px] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
          className="w-full grid grid-cols-12 rounded-3xl overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.25)] border border-white/40 enhanced-glass"
          style={{ minHeight: '560px' }}
        >
          {/* Left Branding */}
          <div className="hidden md:flex col-span-5 flex-col justify-between p-12 bg-white/20 border-r border-white/30">
            <div>
              <div className="flex items-center gap-2 mb-8">
                <Compass className="w-8 h-8 text-primary fill-primary/20" strokeWidth={1.5} />
                <h1 className="font-headline font-extrabold text-2xl tracking-tighter text-on-surface">
                  OpenTrip
                </h1>
              </div>
              <p className="font-headline text-4xl font-bold text-on-surface leading-tight">
                Your Journey,<br />
                <span className="text-primary-dim">Perfectly Orated.</span>
              </p>
            </div>
            <div>
              <span className="font-label text-xs tracking-widest text-on-surface-variant uppercase">
                Digital Concierge
              </span>
              <p className="text-sm text-on-surface-variant mt-2 font-medium">
                Curated travel planning for the modern professional.
              </p>
            </div>
          </div>

          {/* Right Form */}
          <div className="col-span-12 md:col-span-7 bg-white/60 p-8 md:p-12 flex flex-col justify-center">
            <div className="max-w-sm mx-auto w-full">
              <header className="mb-8 md:mb-10 text-center md:text-left">
                {/* Mobile logo */}
                <div className="md:hidden flex justify-center items-center gap-2 mb-6">
                  <Compass className="w-6 h-6 text-primary" strokeWidth={1.5} />
                  <h1 className="font-headline font-black text-xl tracking-tighter">OpenTrip</h1>
                </div>
                <h2 className="font-headline text-2xl font-bold text-on-surface mb-1">
                  Welcome back
                </h2>
                <p className="text-on-surface-variant text-sm font-medium">
                  Digital Concierge Access
                </p>
              </header>

              {/* Form */}
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-1.5">
                  <label
                    htmlFor="email"
                    className="font-label text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider px-1"
                  >
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="alex@concierge.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl bg-white/50 border border-white/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all text-on-surface text-sm placeholder:text-outline-variant"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-end px-1">
                    <label
                      htmlFor="password"
                      className="font-label text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider"
                    >
                      Password
                    </label>
                    <a
                      href="#"
                      className="text-[11px] font-medium text-primary-dim hover:text-primary transition-colors"
                      onClick={e => e.preventDefault()}
                    >
                      Forgot Password?
                    </a>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full h-12 px-4 pr-11 rounded-xl bg-white/50 border border-white/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all text-on-surface text-sm placeholder:text-outline-variant"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-outline-variant hover:text-on-surface transition-colors"
                    >
                      {showPassword
                        ? <EyeOff className="w-5 h-5" />
                        : <Eye className="w-5 h-5" />
                      }
                    </button>
                  </div>
                </div>

                {error && (
                  <p className="text-xs text-red-500 font-medium px-1">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 mt-4 bg-primary text-on-primary font-semibold rounded-xl shadow-lg shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
                    </svg>
                  ) : 'Login'}
                </button>
              </form>

              {/* Divider */}
              <div className="relative my-8 flex items-center">
                <div className="flex-grow border-t border-white/40" />
                <span className="flex-shrink mx-4 font-label text-[10px] text-on-surface-variant/60 uppercase tracking-[0.2em]">
                  Or continue with
                </span>
                <div className="flex-grow border-t border-white/40" />
              </div>

              {/* Social Login */}
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 h-11 rounded-xl bg-white/50 border border-white/40 hover:bg-white transition-colors group"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  <span className="text-xs font-semibold text-on-surface-variant group-hover:text-on-surface">
                    Google
                  </span>
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 h-11 rounded-xl bg-white/50 border border-white/40 hover:bg-white transition-colors group"
                >
                  <svg className="w-5 h-5" fill="#07C160" viewBox="0 0 24 24">
                    <path d="M12 1C5.92487 1 1 5.47715 1 11C1 14.0416 2.51824 16.7584 4.88701 18.5208C4.54226 19.8005 3.51347 21.6896 3.47355 21.761C3.42168 21.854 3.43564 21.9678 3.5085 22.0461C3.58136 22.1245 3.69614 22.1492 3.79496 22.1086C3.89379 22.068 6.43859 21.0371 7.91722 20.4449C9.18664 20.8037 10.5513 21 12 21C18.0751 21 23 16.5228 23 11C23 5.47715 18.0751 1 12 1ZM12 4C15.866 4 19 6.68629 19 10C19 13.3137 15.866 16 12 16C11.1278 16 10.3013 15.8624 9.55403 15.6133L9.36294 15.5492L7.33081 16.3653C7.57551 15.6315 7.84889 14.8105 8.01217 14.3061C6.15582 13.2952 5 11.7582 5 10C5 6.68629 8.13401 4 12 4Z" />
                  </svg>
                  <span className="text-xs font-semibold text-on-surface-variant group-hover:text-on-surface">
                    WeChat
                  </span>
                </button>
              </div>

              <footer className="mt-10 text-center">
                <p className="text-[11px] text-on-surface-variant font-medium">
                  Don't have an account?{' '}
                  <a
                    href="#"
                    onClick={e => e.preventDefault()}
                    className="text-primary font-bold hover:underline"
                  >
                    Join as a Planner
                  </a>
                </p>
              </footer>
            </div>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <div className="fixed bottom-6 w-full text-center px-4 hidden md:block">
        <p className="text-[10px] font-label tracking-widest text-white/50 uppercase">
          © 2024 OpenTrip Technology Inc. &nbsp;•&nbsp; Privacy Policy &nbsp;•&nbsp; Service Terms
        </p>
      </div>
    </motion.div>
  );
}
