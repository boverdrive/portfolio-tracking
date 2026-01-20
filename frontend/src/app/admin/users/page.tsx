'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { User } from '@/types';
import Header from '@/components/Header';
import { getApiBaseUrl } from '@/lib/api';

interface AdminUser extends User {
    id: string;
    email: string;
    name?: string;
    role: string;
    has_local_password: boolean;
    created_at: string;
}

export default function AdminUsersPage() {
    const { user, isLoading: authLoading, isAuthenticated } = useAuth();
    const router = useRouter();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editRole, setEditRole] = useState('');
    const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    // Create user modal state
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserName, setNewUserName] = useState('');
    const [newUserPassword, setNewUserPassword] = useState('');
    const [newUserRole, setNewUserRole] = useState('user');



    const fetchUsers = useCallback(async () => {
        const token = localStorage.getItem('auth_token');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/admin/users`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to fetch users');
            }
            const data = await response.json();
            setUsers(data.users);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.push('/login');
            return;
        }
        if (!authLoading && user && user.role !== 'admin') {
            router.push('/');
            return;
        }
        if (isAuthenticated && user?.role === 'admin') {
            fetchUsers();
        }
    }, [authLoading, isAuthenticated, user, router, fetchUsers]);

    const handleEditRole = (u: AdminUser) => {
        setEditingId(u.id);
        setEditRole(u.role);
    };

    const handleSaveRole = async (userId: string) => {
        setSaving(true);
        setMessage('');
        const token = localStorage.getItem('auth_token');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/admin/users/${userId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ role: editRole }),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to update role');
            }
            setMessage('Role updated successfully');
            setEditingId(null);
            fetchUsers();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleResetPassword = async () => {
        if (!resetPasswordId || newPassword.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }
        setSaving(true);
        setMessage('');
        const token = localStorage.getItem('auth_token');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/admin/users/${resetPasswordId}/reset-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ new_password: newPassword }),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to reset password');
            }
            setMessage('Password reset successfully');
            setResetPasswordId(null);
            setNewPassword('');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        if (!confirm('Are you sure you want to delete this user?')) return;

        setSaving(true);
        const token = localStorage.getItem('auth_token');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to delete user');
            }
            setMessage('User deleted successfully');
            fetchUsers();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleCreateUser = async () => {
        if (!newUserEmail || !newUserPassword) {
            setError('Email and password are required');
            return;
        }
        if (newUserPassword.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }
        setSaving(true);
        setMessage('');
        const token = localStorage.getItem('auth_token');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/admin/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email: newUserEmail,
                    password: newUserPassword,
                    name: newUserName || undefined,
                    role: newUserRole,
                }),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to create user');
            }
            setMessage('User created successfully');
            setShowCreateModal(false);
            setNewUserEmail('');
            setNewUserName('');
            setNewUserPassword('');
            setNewUserRole('user');
            fetchUsers();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (authLoading || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            <Header />
            <main className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-white mb-2">👥 User Management</h1>
                        <p className="text-gray-400">Manage users, roles, and passwords</p>
                    </div>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        Create User
                    </button>
                </div>

                {error && (
                    <div className="mb-4 p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400">
                        {error}
                        <button onClick={() => setError('')} className="ml-4 text-red-300 hover:text-white">×</button>
                    </div>
                )}

                {message && (
                    <div className="mb-4 p-4 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400">
                        {message}
                        <button onClick={() => setMessage('')} className="ml-4 text-green-300 hover:text-white">×</button>
                    </div>
                )}

                {/* Create User Modal */}
                {showCreateModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-gray-800 p-6 rounded-xl max-w-md w-full mx-4 border border-gray-700">
                            <h3 className="text-lg font-semibold text-white mb-4">Create New User</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Email *</label>
                                    <input
                                        type="email"
                                        value={newUserEmail}
                                        onChange={(e) => setNewUserEmail(e.target.value)}
                                        placeholder="user@example.com"
                                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Name</label>
                                    <input
                                        type="text"
                                        value={newUserName}
                                        onChange={(e) => setNewUserName(e.target.value)}
                                        placeholder="John Doe"
                                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Password *</label>
                                    <input
                                        type="password"
                                        value={newUserPassword}
                                        onChange={(e) => setNewUserPassword(e.target.value)}
                                        placeholder="Min 6 characters"
                                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Role</label>
                                    <select
                                        value={newUserRole}
                                        onChange={(e) => setNewUserRole(e.target.value)}
                                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                                    >
                                        <option value="user">User</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-2 mt-6">
                                <button
                                    onClick={handleCreateUser}
                                    disabled={saving}
                                    className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
                                >
                                    {saving ? 'Creating...' : 'Create User'}
                                </button>
                                <button
                                    onClick={() => { setShowCreateModal(false); setNewUserEmail(''); setNewUserName(''); setNewUserPassword(''); setNewUserRole('user'); }}
                                    className="flex-1 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Reset Password Modal */}
                {resetPasswordId && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-gray-800 p-6 rounded-xl max-w-md w-full mx-4 border border-gray-700">
                            <h3 className="text-lg font-semibold text-white mb-4">Reset Password</h3>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="New password (min 6 chars)"
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white mb-4"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={handleResetPassword}
                                    disabled={saving}
                                    className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
                                >
                                    {saving ? 'Saving...' : 'Reset Password'}
                                </button>
                                <button
                                    onClick={() => { setResetPasswordId(null); setNewPassword(''); }}
                                    className="flex-1 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Users Table */}
                <div className="bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-xl overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-800/80">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Role</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Password</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {users.map((u) => (
                                <tr key={u.id} className="hover:bg-gray-700/30">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white">{u.email}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{u.name || '-'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {editingId === u.id ? (
                                            <select
                                                value={editRole}
                                                onChange={(e) => setEditRole(e.target.value)}
                                                className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                                            >
                                                <option value="user">User</option>
                                                <option value="admin">Admin</option>
                                            </select>
                                        ) : (
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${u.role === 'admin'
                                                ? 'bg-purple-500/20 text-purple-400'
                                                : 'bg-gray-600/50 text-gray-300'
                                                }`}>
                                                {u.role}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                                        {u.has_local_password ? '✓ Set' : '✗ Not set'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            {editingId === u.id ? (
                                                <>
                                                    <button
                                                        onClick={() => handleSaveRole(u.id)}
                                                        disabled={saving}
                                                        className="px-2 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs rounded transition-colors"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingId(null)}
                                                        className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => handleEditRole(u)}
                                                        className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded transition-colors"
                                                    >
                                                        Edit Role
                                                    </button>
                                                    <button
                                                        onClick={() => setResetPasswordId(u.id)}
                                                        className="px-2 py-1 bg-yellow-500 hover:bg-yellow-600 text-white text-xs rounded transition-colors"
                                                    >
                                                        Reset PW
                                                    </button>
                                                    {u.id !== user?.id && (
                                                        <button
                                                            onClick={() => handleDeleteUser(u.id)}
                                                            className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-colors"
                                                        >
                                                            Delete
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {users.length === 0 && (
                        <div className="p-8 text-center text-gray-400">
                            No users found
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
