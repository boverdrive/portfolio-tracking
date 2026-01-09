'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { User, AuthProvidersResponse, LinkedProvider } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    providers: AuthProvidersResponse | null;
    linkedProviders: LinkedProvider[];
    login: (provider: 'google' | 'oidc') => void;
    localLogin: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    localRegister: (email: string, password: string, name?: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    refreshLinkedProviders: () => Promise<void>;
    unlinkProvider: (provider: string) => Promise<void>;
    logoutAll: () => Promise<void>;
    changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'auth_token';

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [providers, setProviders] = useState<AuthProvidersResponse | null>(null);
    const [linkedProviders, setLinkedProviders] = useState<LinkedProvider[]>([]);



    // Fetch available auth providers
    const fetchProviders = useCallback(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/providers`);
            if (response.ok) {
                const data = await response.json();
                setProviders(data);
            }
        } catch (error) {
            console.error('Failed to fetch auth providers:', error);
        }
    }, []);

    const router = useRouter();

    // ... (keep usage of router below)

    // Verify token and get user
    const verifyToken = useCallback(async (token: string) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            if (response.ok) {
                const userData = await response.json();
                setUser(userData);
                return true;
            } else if (response.status === 401) {
                // Token expired or invalid
                console.log('Token expired or invalid, redirecting to login...');
                localStorage.removeItem(TOKEN_KEY);
                setUser(null);
                router.push('/login');
                return false;
            }
        } catch (error) {
            console.error('Token verification failed:', error);
        }
        // Clear invalid token
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        return false;
    }, [router]);

    // Refresh user data
    const refreshUser = useCallback(async () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
            await verifyToken(token);
        }
    }, [verifyToken]);

    // Fetch linked providers for current user
    const refreshLinkedProviders = useCallback(async () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/linked-providers`, {
                headers: {
                    'Cookie': `auth_token=${token}`,
                },
                credentials: 'include',
            });
            if (response.ok) {
                const data = await response.json();
                setLinkedProviders(data);
            }
        } catch (error) {
            console.error('Failed to fetch linked providers:', error);
        }
    }, []);

    // Login with OAuth provider
    const login = useCallback((provider: 'google' | 'oidc') => {
        window.location.href = `${API_BASE_URL}/api/auth/${provider}`;
    }, []);

    // Local login with email/password
    const localLogin = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/local/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
                credentials: 'include',
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem(TOKEN_KEY, data.token);
                setUser(data.user);
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                return { success: false, error: errorData.error || 'Login failed' };
            }
        } catch (error) {
            console.error('Local login failed:', error);
            return { success: false, error: 'Login failed. Please try again.' };
        }
    }, []);

    // Local register with email/password
    const localRegister = useCallback(async (email: string, password: string, name?: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/local/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name }),
                credentials: 'include',
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem(TOKEN_KEY, data.token);
                setUser(data.user);
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                return { success: false, error: errorData.error || 'Registration failed' };
            }
        } catch (error) {
            console.error('Local register failed:', error);
            return { success: false, error: 'Registration failed. Please try again.' };
        }
    }, []);

    // Logout
    const logout = useCallback(async () => {
        try {
            await fetch(`${API_BASE_URL}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch (error) {
            console.error('Logout failed:', error);
        }
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        setLinkedProviders([]);

        // Show success message and redirect to login
        alert('ออกจากระบบเรียบร้อยแล้ว');
        router.push('/login');
    }, [router]);

    // Unlink OAuth provider
    const unlinkProvider = useCallback(async (provider: string) => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/unlink/${provider}`, {
                method: 'DELETE',
                headers: {
                    'Cookie': `auth_token=${token}`,
                },
                credentials: 'include',
            });
            if (response.ok) {
                await refreshLinkedProviders();
            }
        } catch (error) {
            console.error('Failed to unlink provider:', error);
        }
    }, [refreshLinkedProviders]);

    // Logout from all devices
    const logoutAll = useCallback(async () => {
        try {
            await fetch(`${API_BASE_URL}/api/auth/logout-all`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch (error) {
            console.error('Logout all failed:', error);
        }
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        setLinkedProviders([]);

        alert('ออกจากระบบทุกอุปกรณ์เรียบร้อยแล้ว');
        router.push('/login');
    }, [router]);

    // Change password
    const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
        try {
            const token = localStorage.getItem(TOKEN_KEY);
            const response = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}), // Also send header just in case
                },
                body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
                credentials: 'include',
            });

            if (response.ok) {
                // Auto logout after password change
                localStorage.removeItem(TOKEN_KEY);
                setUser(null);
                setLinkedProviders([]);
                alert('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว กรุณาเข้าสู่ระบบใหม่');
                router.push('/login');
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                return { success: false, error: errorData.error || 'Failed to change password' };
            }
        } catch (error) {
            console.error('Change password failed:', error);
            return { success: false, error: 'An error occurred. Please try again.' };
        }
    }, [router]);

    // Handle token from OAuth callback URL
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const urlParams = new URLSearchParams(window.location.search);
        const tokenFromUrl = urlParams.get('token');

        if (tokenFromUrl) {
            // Save token to localStorage
            localStorage.setItem(TOKEN_KEY, tokenFromUrl);

            // Clean URL immediately
            window.history.replaceState({}, document.title, window.location.pathname);

            // Verify the token and set user
            verifyToken(tokenFromUrl).then((success) => {
                if (success) {
                    refreshLinkedProviders();
                }
            });
        }
    }, []); // Run once on mount - the URL check happens before React finishes mounting

    // Initialize auth state (for page load without token in URL)
    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            await fetchProviders();

            // Only check localStorage if we didn't already handle URL token above
            const token = localStorage.getItem(TOKEN_KEY);
            if (token && !user) {
                await verifyToken(token);
                await refreshLinkedProviders();
            }
            setIsLoading(false);
        };
        init();
    }, [fetchProviders, verifyToken, refreshLinkedProviders, user]);

    const value: AuthContextType = {
        user,
        isLoading,
        isAuthenticated: !!user,
        providers,
        linkedProviders,
        login,
        localLogin,
        localRegister,
        logout,
        refreshUser,
        refreshLinkedProviders,
        unlinkProvider,
        logoutAll,
        changePassword,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export function useUser() {
    const { user } = useAuth();
    return user;
}

export function useRequireAuth() {
    const { user, isLoading } = useAuth();

    useEffect(() => {
        if (!isLoading && !user) {
            window.location.href = '/login';
        }
    }, [isLoading, user]);

    return user;
}
