'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/contexts/SettingsContext';
import ChangePasswordModal from '@/components/ChangePasswordModal';

export default function ProfilePage() {
    const { user, linkedProviders, providers, login, logout, logoutAll, unlinkProvider, refreshUser, isLoading } = useAuth();
    const { t } = useSettings();
    const router = useRouter();
    const [isEditing, setIsEditing] = useState(false);
    const [name, setName] = useState(user?.name || '');
    const [isSaving, setIsSaving] = useState(false);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);

    // Auto-redirect to login if not authenticated
    useEffect(() => {
        if (!isLoading && !user) {
            router.push('/login');
        }
    }, [isLoading, user, router]);

    if (isLoading || !user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
            </div>
        );
    }

    const handleSaveProfile = async () => {
        setIsSaving(true);
        try {
            // TODO: Implement profile update API
            await new Promise(resolve => setTimeout(resolve, 500));
            await refreshUser();
            setIsEditing(false);
        } catch (error) {
            console.error('Failed to save profile:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const getProviderIcon = (provider: string) => {
        if (!provider || typeof provider !== 'string') return '🔗';
        switch (provider.toLowerCase()) {
            case 'google': return '🔵';
            case 'oidc': return '🔐';
            default: return '🔗';
        }
    };

    const getProviderName = (provider: string) => {
        if (!provider || typeof provider !== 'string') return provider;
        switch (provider.toLowerCase()) {
            case 'google': return 'Google';
            case 'oidc': return providers?.oidc?.name || 'OIDC';
            default: return provider;
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            {/* Header */}
            <Header currentPage="profile" />

            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
                {/* Profile Info */}
                <section className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                    <div className="flex items-start justify-between mb-6">
                        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                            👤 {t('ข้อมูลส่วนตัว', 'Personal Information')}
                        </h2>
                        {!isEditing && (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="px-3 py-1.5 text-sm text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all"
                            >
                                ✏️ {t('แก้ไข', 'Edit')}
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-6 mb-6">
                        {/* Avatar */}
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
                            {user.avatar_url ? (
                                <img src={user.avatar_url} alt={user.name || 'Avatar'} className="w-full h-full object-cover" />
                            ) : (
                                user.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()
                            )}
                        </div>

                        <div className="flex-1">
                            {isEditing ? (
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={t('ชื่อของคุณ', 'Your name')}
                                    className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                />
                            ) : (
                                <h3 className="text-xl font-semibold text-white">
                                    {user.name || t('(ไม่ระบุชื่อ)', '(No name)')}
                                </h3>
                            )}
                            <p className="text-gray-400">{user.email}</p>
                            <p className="text-sm text-gray-500 mt-1">
                                {t('สมาชิกตั้งแต่', 'Member since')} {new Date(user.created_at).toLocaleDateString('th-TH')}
                            </p>
                        </div>
                    </div>

                    {isEditing && (
                        <div className="flex gap-3">
                            <button
                                onClick={handleSaveProfile}
                                disabled={isSaving}
                                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium transition-all disabled:opacity-50"
                            >
                                {isSaving ? t('กำลังบันทึก...', 'Saving...') : t('บันทึก', 'Save')}
                            </button>
                            <button
                                onClick={() => {
                                    setIsEditing(false);
                                    setName(user?.name || '');
                                }}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-all"
                            >
                                {t('ยกเลิก', 'Cancel')}
                            </button>
                        </div>
                    )}
                </section>

                {/* Linked Accounts */}
                <section className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                        🔗 {t('บัญชีที่เชื่อมต่อ', 'Linked Accounts')}
                    </h2>

                    <div className="space-y-3">
                        {linkedProviders.length > 0 ? (
                            linkedProviders.map((lp) => (
                                <div
                                    key={lp.provider}
                                    className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700/50"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-2xl">{getProviderIcon(lp.provider)}</span>
                                        <div>
                                            <div className="text-white font-medium">{getProviderName(lp.provider)}</div>
                                            <div className="text-sm text-gray-400">{lp.email}</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => unlinkProvider(lp.provider)}
                                        className="px-3 py-1.5 text-sm text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                                    >
                                        {t('ยกเลิกเชื่อม', 'Unlink')}
                                    </button>
                                </div>
                            ))
                        ) : (
                            <p className="text-gray-500 text-center py-4">
                                {t('ยังไม่มีบัญชีที่เชื่อมต่อ', 'No linked accounts')}
                            </p>
                        )}

                        {/* Add provider buttons */}
                        <div className="pt-3 border-t border-gray-700/50">
                            <p className="text-sm text-gray-400 mb-3">
                                {t('เชื่อมต่อบัญชีเพิ่มเติม:', 'Link additional accounts:')}
                            </p>
                            <div className="flex gap-3">
                                {providers?.google && !linkedProviders.find(lp => lp.provider === 'google') && (
                                    <button
                                        onClick={() => login('google')}
                                        className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg transition-all"
                                    >
                                        🔵 Google
                                    </button>
                                )}
                                {providers?.oidc?.enabled && !linkedProviders.find(lp => lp.provider === 'oidc') && (
                                    <button
                                        onClick={() => login('oidc')}
                                        className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-lg transition-all"
                                    >
                                        🔐 {providers.oidc.name}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Security / Sessions */}
                <section className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                        🔒 {t('ความปลอดภัย', 'Security')}
                    </h2>

                    <div className="space-y-4">
                        {/* Password status */}
                        <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
                            <div>
                                <div className="text-white font-medium">{t('รหัสผ่าน', 'Password')}</div>
                                <div className="text-sm text-gray-400">
                                    {user.has_local_password
                                        ? t('ตั้งค่าแล้ว', 'Set')
                                        : t('ยังไม่ได้ตั้งค่า', 'Not set')}
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    if (user.has_local_password) {
                                        setShowChangePasswordModal(true);
                                    } else {
                                        // TODO: Handle set password flow
                                        alert('ฟีเจอร์ตั้งรหัสผ่านยังไม่เปิดใช้งาน');
                                    }
                                }}
                                className="px-3 py-1.5 text-sm text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all"
                            >
                                {user.has_local_password
                                    ? t('เปลี่ยนรหัสผ่าน', 'Change password')
                                    : t('ตั้งรหัสผ่าน', 'Set password')}
                            </button>
                        </div>

                        {/* Logout all devices */}
                        <button
                            onClick={logoutAll}
                            className="w-full p-4 text-left bg-rose-500/10 hover:bg-rose-500/20 rounded-lg border border-rose-500/20 transition-all"
                        >
                            <div className="text-rose-400 font-medium">{t('ออกจากระบบทุกอุปกรณ์', 'Logout from all devices')}</div>
                            <div className="text-sm text-rose-400/70">
                                {t('จะออกจากระบบทุกที่ที่เคยเข้าสู่ระบบ', 'This will sign you out everywhere')}
                            </div>
                        </button>
                    </div>
                </section>

                {/* Admin Link - only show if user might be admin */}
                <section className="text-center pt-4">
                    <Link
                        href="/admin/users"
                        className="text-sm text-gray-500 hover:text-gray-400 transition-all"
                    >
                        👥 {t('จัดการผู้ใช้ (Admin)', 'User Management (Admin)')}
                    </Link>
                </section>
            </main>

            <ChangePasswordModal
                isOpen={showChangePasswordModal}
                onClose={() => setShowChangePasswordModal(false)}
            />
        </div>
    );
}
