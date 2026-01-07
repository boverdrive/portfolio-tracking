'use client';

import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function LoginPage() {
    const { providers, login, localLogin, localRegister, isAuthenticated, isLoading } = useAuth();
    const router = useRouter();

    // Local auth form state
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Redirect if already authenticated
    useEffect(() => {
        if (!isLoading && isAuthenticated) {
            router.push('/');
        }
    }, [isAuthenticated, isLoading, router]);

    const handleLocalAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        const result = isRegistering
            ? await localRegister(email, password, name || undefined)
            : await localLogin(email, password);

        setIsSubmitting(false);

        if (result.success) {
            router.push('/');
        } else {
            setError(result.error || 'Authentication failed');
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
            <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-8 w-full max-w-md shadow-2xl">
                {/* Logo/Brand */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl mb-4">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2">Portfolio Tracker</h1>
                    <p className="text-slate-400">ติดตามพอร์ตการลงทุนของคุณ</p>
                </div>

                {/* Local Auth Form */}
                {providers?.local && (
                    <form onSubmit={handleLocalAuth} className="space-y-4 mb-6">
                        {/* Name field - only show when registering */}
                        {isRegistering && (
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">ชื่อ</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="ชื่อของคุณ"
                                    className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all"
                                />
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="your@email.com"
                                required
                                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                minLength={6}
                                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all"
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-600 text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:scale-[1.02] disabled:scale-100"
                        >
                            {isSubmitting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    กำลังดำเนินการ...
                                </span>
                            ) : (
                                isRegistering ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'
                            )}
                        </button>

                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
                                className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
                            >
                                {isRegistering ? 'มีบัญชีแล้ว? เข้าสู่ระบบ' : 'ยังไม่มีบัญชี? สมัครสมาชิก'}
                            </button>
                        </div>
                    </form>
                )}

                {/* Divider - only show if both local and OAuth available */}
                {providers?.local && (providers?.google || providers?.oidc?.enabled) && (
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-600"></div>
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-4 bg-slate-800/50 text-slate-400">หรือเข้าสู่ระบบด้วย</span>
                        </div>
                    </div>
                )}

                {/* OAuth Buttons */}
                <div className="space-y-3">
                    {/* Google Login */}
                    {providers?.google && (
                        <button
                            onClick={() => login('google')}
                            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-gray-100 text-gray-800 font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:scale-[1.02]"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path
                                    fill="#4285F4"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                    fill="#34A853"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                                <path
                                    fill="#FBBC05"
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                />
                                <path
                                    fill="#EA4335"
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                />
                            </svg>
                            Continue with Google
                        </button>
                    )}

                    {/* Custom OIDC Login */}
                    {providers?.oidc?.enabled && (
                        <button
                            onClick={() => login('oidc')}
                            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:scale-[1.02]"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                            Continue with {providers.oidc.name || 'OIDC'}
                        </button>
                    )}
                </div>

                {/* No providers message */}
                {!providers?.google && !providers?.oidc?.enabled && !providers?.local && (
                    <div className="text-center py-8">
                        <div className="inline-flex items-center justify-center w-12 h-12 bg-yellow-500/20 rounded-full mb-4">
                            <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <p className="text-slate-400">ยังไม่ได้ตั้งค่า Authentication</p>
                        <p className="text-slate-500 text-sm mt-2">กรุณาตั้งค่า Local Auth หรือ OAuth ใน backend</p>
                    </div>
                )}

                {/* Footer */}
                <div className="mt-8 text-center text-sm text-slate-500">
                    <p>การเข้าสู่ระบบถือว่าคุณยอมรับ</p>
                    <p>
                        <a href="#" className="text-purple-400 hover:text-purple-300">เงื่อนไขการใช้งาน</a>
                        {' และ '}
                        <a href="#" className="text-purple-400 hover:text-purple-300">นโยบายความเป็นส่วนตัว</a>
                    </p>
                </div>
            </div>
        </div>
    );
}
