'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/contexts/SettingsContext';

export function UserMenu() {
    const { user, isAuthenticated, isLoading, logout, login, providers } = useAuth();
    const { t } = useSettings();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (isLoading) {
        return (
            <div className="w-8 h-8 rounded-full bg-slate-700 animate-pulse"></div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="flex items-center gap-2">
                {providers?.google && (
                    <button
                        onClick={() => login('google')}
                        className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-lg transition-all duration-200 hover:shadow-lg"
                    >
                        {t('เข้าสู่ระบบ', 'Login')}
                    </button>
                )}
                {providers?.oidc?.enabled && (
                    <button
                        onClick={() => login('oidc')}
                        className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 rounded-lg transition-all duration-200 hover:shadow-lg"
                    >
                        Login with {providers.oidc.name || 'OIDC'}
                    </button>
                )}
                {!providers?.google && !providers?.oidc?.enabled && (
                    <a
                        href="/login"
                        className="px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-all duration-200"
                    >
                        {t('เข้าสู่ระบบ', 'Login')}
                    </a>
                )}
            </div>
        );
    }

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-700/50 transition-colors"
            >
                {user?.avatar_url ? (
                    <img
                        src={user.avatar_url}
                        alt={user.name || user.email}
                        className="w-8 h-8 rounded-full border-2 border-purple-500"
                    />
                ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
                        {(user?.name || user?.email)?.[0]?.toUpperCase() || '?'}
                    </div>
                )}
                <svg
                    className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50">
                    {/* User Info */}
                    <div className="px-4 py-3 border-b border-slate-700">
                        <div className="flex items-center gap-3">
                            {user?.avatar_url ? (
                                <img
                                    src={user.avatar_url}
                                    alt={user.name || user.email}
                                    className="w-10 h-10 rounded-full"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
                                    {(user?.name || user?.email)?.[0]?.toUpperCase() || '?'}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white truncate">
                                    {user?.name || 'User'}
                                </p>
                                <p className="text-xs text-slate-400 truncate">
                                    {user?.email}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Menu Items */}
                    <div className="py-1">
                        <a
                            href="/settings"
                            className="flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {t('ตั้งค่าบัญชี', 'Account Settings')}
                        </a>
                    </div>

                    {/* Logout */}
                    <div className="border-t border-slate-700 py-1">
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                logout();
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-slate-700/50 transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            {t('ออกจากระบบ', 'Logout')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
