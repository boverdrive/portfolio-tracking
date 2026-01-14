'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/contexts/SettingsContext';

interface HeaderProps {
    currentPage?: 'home' | 'transactions' | 'reports' | 'analysis' | 'settings' | 'profile';
    showCurrencySelector?: boolean;
    currencyValue?: string;
    onCurrencyChange?: (value: string) => void;
    currencyOptions?: { value: string; icon: string }[];
}

export default function Header({
    currentPage,
    showCurrencySelector = false,
    currencyValue,
    onCurrencyChange,
    currencyOptions = []
}: HeaderProps) {
    const { user, logout, isAuthenticated } = useAuth();
    const { t } = useSettings();
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

    const navItems = [
        { key: 'home', href: '/', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: { th: 'หน้าแรก', en: 'Home' } },
        { key: 'transactions', href: '/transactions', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', label: { th: 'รายการซื้อขาย', en: 'Transactions' } },
        { key: 'reports', href: '/reports', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', label: { th: 'รายงาน', en: 'Reports' } },
        { key: 'analysis', href: '/analysis', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: { th: 'วิเคราะห์', en: 'Analysis' } },
        { key: 'settings', href: '/settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', label: { th: 'ตั้งค่า', en: 'Settings' }, secondPath: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    ];

    // Filter nav items based on user role (all visible now)
    const visibleNavItems = navItems;

    const getPageLabel = () => {
        const item = navItems.find(n => n.key === currentPage);
        if (item) return t(item.label.th, item.label.en);
        if (currentPage === 'profile') return t('โปรไฟล์', 'Profile');
        return '';
    };

    return (
        <header className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
            <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center gap-3">
                        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                            {/* OLD LOGO (Commented out for backup)
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                            </div>
                            */}
                            {/* NEW LOGO */}
                            <div className="w-10 h-10 relative">
                                <img src="/logo.svg" alt="PT Logo" className="w-full h-full object-contain" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-white">PT - Portfolio Tracking</h1>
                                {currentPage && <p className="text-xs text-gray-500">{getPageLabel()}</p>}
                            </div>
                        </Link>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Currency Selector */}
                        {showCurrencySelector && currencyOptions.length > 0 && (
                            <div className="relative">
                                <select
                                    value={currencyValue}
                                    onChange={(e) => onCurrencyChange?.(e.target.value)}
                                    className="appearance-none bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer"
                                >
                                    {currencyOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.icon} {opt.value}
                                        </option>
                                    ))}
                                </select>
                                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>
                        )}

                        {/* Navigation Items */}
                        {visibleNavItems.map((item) => (
                            item.key === currentPage ? (
                                <div
                                    key={item.key}
                                    className="p-2 text-emerald-400 bg-emerald-500/20 rounded-lg"
                                    title={t(item.label.th, item.label.en)}
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                                        {item.secondPath && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.secondPath} />}
                                    </svg>
                                </div>
                            ) : (
                                <Link
                                    key={item.key}
                                    href={item.href}
                                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
                                    title={t(item.label.th, item.label.en)}
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                                        {item.secondPath && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.secondPath} />}
                                    </svg>
                                </Link>
                            )
                        ))}

                        {/* Profile dropdown */}
                        {isAuthenticated && (
                            <div className="relative">
                                <button
                                    onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                                    className={`p-2 rounded-lg transition-all flex items-center gap-1 ${currentPage === 'profile'
                                        ? 'text-emerald-400 bg-emerald-500/20 hover:bg-emerald-500/30'
                                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                                        }`}
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>

                                {isProfileMenuOpen && (
                                    <>
                                        {/* Backdrop to close menu */}
                                        <div
                                            className="fixed inset-0 z-40"
                                            onClick={() => setIsProfileMenuOpen(false)}
                                        />
                                        {/* Dropdown menu */}
                                        <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                                            <div className="px-4 py-3 border-b border-gray-700">
                                                <p className="text-sm text-white font-medium truncate">{user?.name || user?.email}</p>
                                                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                                            </div>
                                            <div className="py-1">
                                                <Link
                                                    href="/profile"
                                                    onClick={() => setIsProfileMenuOpen(false)}
                                                    className="flex items-center gap-3 px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-all"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                    </svg>
                                                    {t('โปรไฟล์', 'Profile')}
                                                </Link>
                                                {user?.role === 'admin' && (
                                                    <Link
                                                        href="/admin/users"
                                                        onClick={() => setIsProfileMenuOpen(false)}
                                                        className="flex items-center gap-3 px-4 py-2 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300 transition-all"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                                        </svg>
                                                        {t('จัดการผู้ใช้', 'Manage Users')}
                                                    </Link>
                                                )}
                                                <button
                                                    onClick={() => { setIsProfileMenuOpen(false); logout(); }}
                                                    className="w-full flex items-center gap-3 px-4 py-2 text-rose-400 hover:bg-rose-500/10 transition-all"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                                    </svg>
                                                    {t('ออกจากระบบ', 'Logout')}
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Login button for non-authenticated users */}
                        {!isAuthenticated && (
                            <Link
                                href="/login"
                                className="px-3 py-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all text-sm"
                            >
                                {t('เข้าสู่ระบบ', 'Login')}
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}
