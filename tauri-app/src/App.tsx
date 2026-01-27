import { useState, useEffect } from 'react';
import {
    getPortfolio,
    formatCurrency,
    formatPercent,
    getAssetTypeName,
    getApiBaseUrl,
    setApiBaseUrl,
    login,
    isLoggedIn,
    clearAuthToken,
    setAuthToken,
    getAllExchangeRates,
    getCurrentUser,
    UserProfile,
} from './lib/api';
import { listen } from '@tauri-apps/api/event';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import type { PortfolioResponse, PortfolioAsset, Transaction } from './types';
import TransactionList from './components/TransactionList';
import TransactionForm from './components/TransactionForm';
import AnalysisPage from './components/AnalysisPage';
import AssetDetailsModal from './components/AssetDetailsModal';
import AssetLogo from './components/AssetLogo';

type TabType = 'portfolio' | 'transactions' | 'analysis' | 'settings';

function App() {
    const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [apiUrl, setApiUrlState] = useState(getApiBaseUrl());
    const [loggedIn, setLoggedIn] = useState(isLoggedIn());
    const [activeTab, setActiveTab] = useState<TabType>('portfolio');

    // Transaction states
    const [showTransactionForm, setShowTransactionForm] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Asset details modal state
    const [selectedAsset, setSelectedAsset] = useState<PortfolioAsset | null>(null);

    // Summary detail modal state
    const [summaryDetail, setSummaryDetail] = useState<{ title: string; data: { label: string; value: string; color?: string }[] } | null>(null);

    // Settings state
    const [displayCurrency, setDisplayCurrency] = useState<'THB' | 'USD' | 'BTC'>(() => {
        return (localStorage.getItem('displayCurrency') as 'THB' | 'USD' | 'BTC') || 'THB';
    });
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

    // Login form state
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loginError, setLoginError] = useState<string | null>(null);
    const [loginLoading, setLoginLoading] = useState(false);
    const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'error'>('checking');
    const [authProviders, setAuthProviders] = useState<{ google: boolean; oidc?: { name: string; enabled: boolean }; local: boolean } | null>(null);

    // Check backend connectivity
    const checkBackendStatus = async () => {
        // Don't check if empty
        if (!apiUrl) return;

        setBackendStatus('checking');
        try {
            // Use apiUrl state which reflects current input
            const response = await fetch(`${apiUrl}/api/status`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            setBackendStatus(response.ok ? 'connected' : 'error');
        } catch {
            setBackendStatus('error');
        }
    };

    // Check backend on mount and when API URL changes
    useEffect(() => {
        if (!loggedIn) {
            const timer = setTimeout(() => {
                // Don't check if empty or too short
                if (!apiUrl || apiUrl.length < 7) {
                    setBackendStatus('error');
                    return;
                }

                checkBackendStatus();
                // Fetch auth providers from current API URL
                fetch(`${apiUrl}/api/auth/providers`)
                    .then(res => res.ok ? res.json() : null)
                    .then(data => setAuthProviders(data))
                    .catch(() => setAuthProviders(null));
            }, 500);

            // Check for token in URL (OAuth callback for web)
            const urlParams = new URLSearchParams(window.location.search);
            const tokenFromUrl = urlParams.get('token');
            if (tokenFromUrl) {
                setAuthToken(tokenFromUrl);
                setLoggedIn(true);
                window.history.replaceState({}, document.title, window.location.pathname);
            }
            return () => clearTimeout(timer);
        }
    }, [loggedIn, apiUrl]);

    // Listen for OAuth deep link callback (Tauri)
    useEffect(() => {
        let unlisten: (() => void) | undefined;

        const setupListener = async () => {
            try {
                unlisten = await listen<string>('oauth-callback', (event) => {
                    const url = event.payload;
                    console.log('🔗 OAuth Callback URL:', url); // Debug Log

                    // Parse token from URL: portfolio-tracking://auth/callback?token=xxx
                    // Stop at & or # (fragment)
                    const match = url.match(/[?&]token=([^&#]+)/);
                    if (match && match[1]) {
                        try {
                            const raw = match[1];
                            const decoded = decodeURIComponent(raw);
                            console.log('🔑 Received Token (Raw):', raw);
                            console.log('🔑 Received Token (Decoded):', decoded);
                            setAuthToken(decoded);
                            setLoggedIn(true);
                        } catch (e) {
                            console.error('Failed to decode token:', e);
                        }
                    }
                });
            } catch (e) {
                // Not in Tauri environment
                console.log('Not in Tauri environment');
            }
        };

        setupListener();

        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    const fetchPortfolio = async () => {
        if (!loggedIn) return;
        try {
            setLoading(true);
            setError(null);
            const data = await getPortfolio();
            setPortfolio(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch portfolio');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (loggedIn) {
            fetchPortfolio();
            // Fetch exchange rates
            getAllExchangeRates('THB').then(data => {
                setExchangeRates(data.rates);
            }).catch(console.error);
            // Fetch user profile
            getCurrentUser().then(user => {
                setUserProfile(user);
            }).catch(console.error);
        }
    }, [loggedIn]);

    // Refresh user profile when entering settings
    useEffect(() => {
        if (loggedIn && activeTab === 'settings') {
            getCurrentUser().then(user => {
                setUserProfile(user);
            }).catch(e => console.error('Failed to refresh user profile:', e));
        }
    }, [activeTab, loggedIn]);

    // Currency conversion helper
    const convertValue = (value: number, fromCurrency: string = 'THB'): number => {
        if (displayCurrency === fromCurrency) return value;
        if (Object.keys(exchangeRates).length === 0) return value;

        // Normalize stablecoins to USD
        let from = fromCurrency.toUpperCase();
        if (['USDT', 'USDC', 'BUSD', 'DAI'].includes(from)) from = 'USD';

        // Convert to THB first (base currency)
        let valueInTHB = value;
        if (from !== 'THB') {
            const rate = exchangeRates[from];
            if (rate) valueInTHB = value / rate;
        }

        // Convert from THB to target
        if (displayCurrency === 'THB') return valueInTHB;
        const targetRate = exchangeRates[displayCurrency];
        return targetRate ? valueInTHB * targetRate : valueInTHB;
    };

    const formatDisplayValue = (value: number, fromCurrency: string = 'THB'): string => {
        const converted = convertValue(value, fromCurrency);
        if (displayCurrency === 'BTC') {
            return `₿ ${converted.toFixed(6)}`;
        }
        return formatCurrency(converted, displayCurrency);
    };

    const handleLogin = async () => {
        try {
            setLoginLoading(true);
            setLoginError(null);
            await login(email, password);
            setLoggedIn(true);
            setEmail('');
            setPassword('');
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Login failed';
            setLoginError(errorMsg);
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = () => {
        clearAuthToken();
        setLoggedIn(false);
        setPortfolio(null);
    };

    const handleTransactionSuccess = () => {
        setShowTransactionForm(false);
        setEditingTransaction(null);
        setRefreshTrigger(prev => prev + 1);
        fetchPortfolio(); // Refresh portfolio data
    };

    const handleEditTransaction = (tx: Transaction) => {
        setEditingTransaction(tx);
        setShowTransactionForm(true);
    };

    // Login Screen
    if (!loggedIn) {
        return (
            <div className="min-h-screen bg-dark-900 flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
                            <span className="text-white font-bold text-3xl">PT</span>
                        </div>
                        <h1 className="text-2xl font-bold text-white">Portfolio Tracking</h1>
                        <p className="text-dark-400">Sign in to continue</p>
                    </div>

                    <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
                        <div className="mb-4">
                            <label className="block text-sm text-dark-400 mb-1">API Server</label>
                            <input
                                type="text"
                                value={apiUrl}
                                onChange={(e) => setApiUrlState(e.target.value)}
                                onBlur={() => {
                                    setApiBaseUrl(apiUrl);
                                    checkBackendStatus();
                                }}
                                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500 text-sm"
                                placeholder="http://192.168.1.210:3001"
                            />
                            <div className="flex items-center gap-2 mt-2">
                                <div className={`w-2 h-2 rounded-full ${backendStatus === 'connected' ? 'bg-green-500' : backendStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`}></div>
                                <span className={`text-xs ${backendStatus === 'connected' ? 'text-green-400' : backendStatus === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
                                    {backendStatus === 'connected' ? 'Connected' : backendStatus === 'error' ? 'Cannot connect' : 'Checking...'}
                                </span>
                            </div>
                        </div>

                        <div className="mb-4">
                            <label className="block text-sm text-dark-400 mb-1">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                                placeholder="your@email.com"
                            />
                        </div>

                        <div className="mb-4">
                            <label className="block text-sm text-dark-400 mb-1">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                                placeholder="••••••••"
                            />
                        </div>

                        {loginError && (
                            <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-300 text-sm">
                                {loginError}
                            </div>
                        )}

                        <button
                            onClick={handleLogin}
                            disabled={loginLoading || !email || !password}
                            className="w-full py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-dark-600 text-white rounded-lg font-semibold transition-colors"
                        >
                            {loginLoading ? 'Signing in...' : 'Sign In'}
                        </button>

                        {/* OAuth Divider */}
                        {authProviders && (authProviders.google || authProviders.oidc?.enabled) && (
                            <>
                                <div className="flex items-center gap-3 my-4">
                                    <div className="flex-1 h-px bg-dark-600"></div>
                                    <span className="text-dark-400 text-sm">or</span>
                                    <div className="flex-1 h-px bg-dark-600"></div>
                                </div>

                                {/* Google Login */}
                                {authProviders.google && (
                                    <button
                                        onClick={() => {
                                            const redirectUri = encodeURIComponent('portfolio-tracking://auth/callback');
                                            shellOpen(`${getApiBaseUrl()}/api/auth/google?redirect_uri=${redirectUri}`);
                                        }}
                                        className="w-full py-3 bg-white hover:bg-gray-100 text-gray-800 rounded-lg font-semibold transition-colors flex items-center justify-center gap-3 mb-3"
                                    >
                                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                        </svg>
                                        Continue with Google
                                    </button>
                                )}

                                {/* OIDC Login */}
                                {authProviders.oidc?.enabled && (
                                    <button
                                        onClick={() => {
                                            const redirectUri = encodeURIComponent('portfolio-tracking://auth/callback');
                                            shellOpen(`${getApiBaseUrl()}/api/auth/oidc?redirect_uri=${redirectUri}`);
                                        }}
                                        className="w-full py-3 bg-dark-600 hover:bg-dark-500 text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-3"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                        </svg>
                                        Continue with {authProviders.oidc.name || 'SSO'}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Transaction Form Modal
    if (showTransactionForm) {
        return (
            <div className="min-h-screen bg-dark-900 p-4">
                <TransactionForm
                    editTransaction={editingTransaction}
                    onSuccess={handleTransactionSuccess}
                    onClose={() => {
                        setShowTransactionForm(false);
                        setEditingTransaction(null);
                    }}
                />
            </div>
        );
    }

    // Main App with Tab Navigation
    return (
        <div className="min-h-screen bg-dark-900 pb-20">
            {/* Header */}
            <header className="bg-dark-900/80 backdrop-blur-md border-b border-dark-700/50 sticky top-0 z-10 transition-all duration-200">
                <div className="px-4 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center">
                                <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-white">Portfolio Tracking</h1>
                            </div>
                        </div>
                        <button
                            onClick={fetchPortfolio}
                            className="p-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="px-4 py-4">
                {activeTab === 'portfolio' && (
                    <>
                        {loading ? (
                            <div className="flex items-center justify-center h-32">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                            </div>
                        ) : error ? (
                            <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-4 text-center">
                                <p className="text-red-300 text-sm">{error}</p>
                            </div>
                        ) : portfolio ? (
                            <>
                                {/* Summary Cards */}
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <SummaryCard
                                        title="Net Worth"
                                        value={formatDisplayValue(portfolio.summary.total_current_value, 'THB')}
                                        color="primary"
                                        onClick={() => {
                                            const byType = portfolio.assets.reduce((acc, a) => {
                                                const type = getAssetTypeName(a.asset_type);
                                                acc[type] = (acc[type] || 0) + a.current_value;
                                                return acc;
                                            }, {} as Record<string, number>);
                                            setSummaryDetail({
                                                title: 'Net Worth Breakdown',
                                                data: Object.entries(byType).map(([label, val]) => ({
                                                    label,
                                                    value: formatDisplayValue(val, 'THB'),
                                                }))
                                            });
                                        }}
                                    />
                                    <SummaryCard
                                        title="Total Invested"
                                        value={formatDisplayValue(portfolio.summary.total_invested, 'THB')}
                                        color="blue"
                                        onClick={() => {
                                            const byType = portfolio.assets.reduce((acc, a) => {
                                                const type = getAssetTypeName(a.asset_type);
                                                acc[type] = (acc[type] || 0) + a.total_cost;
                                                return acc;
                                            }, {} as Record<string, number>);
                                            setSummaryDetail({
                                                title: 'Investment Breakdown',
                                                data: Object.entries(byType).map(([label, val]) => ({
                                                    label,
                                                    value: formatDisplayValue(val, 'THB'),
                                                }))
                                            });
                                        }}
                                    />
                                    <SummaryCard
                                        title="Unrealized P&L"
                                        value={formatDisplayValue(portfolio.summary.total_unrealized_pnl, 'THB')}
                                        subtitle={formatPercent(portfolio.summary.total_unrealized_pnl_percent)}
                                        color={portfolio.summary.total_unrealized_pnl >= 0 ? 'green' : 'red'}
                                        onClick={() => {
                                            const byAsset = portfolio.assets
                                                .filter(a => a.unrealized_pnl !== 0)
                                                .sort((a, b) => b.unrealized_pnl - a.unrealized_pnl)
                                                .slice(0, 10)
                                                .map(a => ({
                                                    label: a.symbol,
                                                    value: formatDisplayValue(a.unrealized_pnl, a.currency),
                                                    color: a.unrealized_pnl >= 0 ? 'green' : 'red',
                                                }));
                                            setSummaryDetail({ title: 'Unrealized P&L by Asset', data: byAsset });
                                        }}
                                    />
                                    <SummaryCard
                                        title="Realized P&L"
                                        value={formatDisplayValue(portfolio.summary.total_realized_pnl, 'THB')}
                                        color={portfolio.summary.total_realized_pnl >= 0 ? 'green' : 'red'}
                                        onClick={() => {
                                            const breakdown = portfolio.summary.realized_pnl_breakdown;
                                            if (breakdown) {
                                                setSummaryDetail({
                                                    title: 'Realized P&L Breakdown',
                                                    data: Object.entries(breakdown).map(([label, val]) => ({
                                                        label: getAssetTypeName(label as any),
                                                        value: formatDisplayValue(val, 'THB'),
                                                        color: val >= 0 ? 'green' : 'red',
                                                    }))
                                                });
                                            }
                                        }}
                                    />
                                    {portfolio.summary.total_dividend && portfolio.summary.total_dividend > 0 && (
                                        <SummaryCard
                                            title="Dividend"
                                            value={formatDisplayValue(portfolio.summary.total_dividend, 'THB')}
                                            color="green"
                                            onClick={() => {
                                                const byAsset = portfolio.assets
                                                    .filter(a => a.realized_dividend && a.realized_dividend > 0)
                                                    .sort((a, b) => (b.realized_dividend || 0) - (a.realized_dividend || 0))
                                                    .map(a => ({
                                                        label: a.symbol,
                                                        value: formatDisplayValue(a.realized_dividend || 0, a.currency),
                                                        color: 'green' as const,
                                                    }));
                                                setSummaryDetail({ title: 'Dividend by Asset', data: byAsset });
                                            }}
                                        />
                                    )}
                                </div>

                                {/* Assets List */}
                                <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                                    <div className="px-4 py-3 border-b border-dark-700">
                                        <h2 className="text-base font-semibold text-white">Holdings ({portfolio.assets.length})</h2>
                                    </div>
                                    <div className="divide-y divide-dark-700 max-h-[50vh] overflow-y-auto">
                                        {portfolio.assets.length === 0 ? (
                                            <div className="px-4 py-8 text-center text-dark-400 text-sm">
                                                No assets yet
                                            </div>
                                        ) : (
                                            portfolio.assets.map((asset, index) => (
                                                <AssetRow
                                                    key={`${asset.symbol}-${asset.market}-${asset.position_type || 'spot'}-${index}`}
                                                    asset={asset}
                                                    onClick={() => setSelectedAsset(asset)}
                                                    formatValue={(v: number, c: string) => formatDisplayValue(v, c)}
                                                />
                                            ))
                                        )}
                                    </div>
                                </div>
                            </>
                        ) : null}
                    </>
                )}

                {activeTab === 'transactions' && (
                    <TransactionList
                        onAddNew={() => setShowTransactionForm(true)}
                        onEdit={handleEditTransaction}
                        refreshTrigger={refreshTrigger}
                    />
                )}

                {activeTab === 'analysis' && (
                    <AnalysisPage />
                )}

                {activeTab === 'settings' && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-white">Settings</h2>

                        {/* User Profile */}
                        {userProfile && (
                            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
                                        <span className="text-white text-xl font-bold">
                                            {(userProfile.name || userProfile.email).charAt(0).toUpperCase()}
                                        </span>
                                    </div>
                                    <div>
                                        <div className="text-white font-semibold">
                                            {userProfile.name || 'User'}
                                        </div>
                                        <div className="text-dark-400 text-sm">{userProfile.email}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
                            <label className="block text-sm text-dark-400 mb-2">API Server</label>
                            <input
                                type="text"
                                value={apiUrl}
                                onChange={(e) => setApiUrlState(e.target.value)}
                                onBlur={() => {
                                    setApiBaseUrl(apiUrl);
                                    fetchPortfolio();
                                }}
                                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                            />
                        </div>

                        <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
                            <label className="block text-sm text-dark-400 mb-2">Display Currency</label>
                            <div className="grid grid-cols-3 gap-2">
                                {(['THB', 'USD', 'BTC'] as const).map((curr) => (
                                    <button
                                        key={curr}
                                        onClick={() => {
                                            setDisplayCurrency(curr);
                                            localStorage.setItem('displayCurrency', curr);
                                        }}
                                        className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${displayCurrency === curr
                                            ? 'bg-primary-600 text-white'
                                            : 'bg-dark-700 text-dark-300 hover:bg-dark-600'
                                            }`}
                                    >
                                        {curr === 'THB' ? '฿ THB' : curr === 'USD' ? '$ USD' : '₿ BTC'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={handleLogout}
                            className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
                        >
                            Logout
                        </button>
                    </div>
                )}
            </main>

            {/* Bottom Tab Bar */}
            <nav className="fixed bottom-0 left-0 right-0 bg-dark-800 border-t border-dark-700 px-4 py-2 safe-area-pb">
                <div className="flex items-center justify-around">
                    <TabButton
                        icon={
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                        }
                        label="Portfolio"
                        active={activeTab === 'portfolio'}
                        onClick={() => setActiveTab('portfolio')}
                    />
                    <TabButton
                        icon={
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                        }
                        label="Transactions"
                        active={activeTab === 'transactions'}
                        onClick={() => setActiveTab('transactions')}
                    />
                    <TabButton
                        icon={
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                        }
                        label="Analysis"
                        active={activeTab === 'analysis'}
                        onClick={() => setActiveTab('analysis')}
                    />
                    <TabButton
                        icon={
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        }
                        label="Settings"
                        active={activeTab === 'settings'}
                        onClick={() => setActiveTab('settings')}
                    />
                </div>
            </nav>

            {/* Asset Details Modal */}
            {selectedAsset && (
                <AssetDetailsModal
                    asset={selectedAsset}
                    onClose={() => setSelectedAsset(null)}
                />
            )}

            {/* Summary Detail Modal */}
            {summaryDetail && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" onClick={() => setSummaryDetail(null)}>
                    <div
                        className="fixed inset-x-0 bottom-0 bg-dark-900 rounded-t-3xl max-h-[60vh] overflow-hidden flex flex-col border-t border-dark-700"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex justify-center py-3">
                            <div className="w-10 h-1 bg-dark-600 rounded-full"></div>
                        </div>
                        <div className="px-4 pb-2">
                            <h2 className="text-lg font-bold text-white">{summaryDetail.title}</h2>
                        </div>
                        <div className="flex-1 overflow-y-auto px-4 pb-6">
                            <div className="space-y-2">
                                {summaryDetail.data.map((item, i) => (
                                    <div key={i} className="flex items-center justify-between py-2 border-b border-dark-700">
                                        <span className="text-dark-300">{item.label}</span>
                                        <span className={`font-medium ${item.color === 'green' ? 'text-green-400' : item.color === 'red' ? 'text-red-400' : 'text-white'}`}>
                                            {item.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Tab Button Component
function TabButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`flex flex-col items-center gap-1 py-1 px-4 ${active ? 'text-primary-400' : 'text-dark-400'}`}
        >
            {icon}
            <span className="text-xs">{label}</span>
        </button>
    );
}

// Summary Card Component
interface SummaryCardProps {
    title: string;
    value: string;
    subtitle?: string;
    color: 'primary' | 'blue' | 'green' | 'red';
    onClick?: () => void;
}

function SummaryCard({ title, value, subtitle, color, onClick }: SummaryCardProps) {
    const colorClasses = {
        primary: 'from-primary-500/20 to-primary-600/10 border-primary-500/30',
        blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
        green: 'from-green-500/20 to-green-600/10 border-green-500/30',
        red: 'from-red-500/20 to-red-600/10 border-red-500/30',
    };

    const textColors = {
        primary: 'text-primary-400',
        blue: 'text-blue-400',
        green: 'text-green-400',
        red: 'text-red-400',
    };

    return (
        <div
            className={`bg-gradient-to-br ${colorClasses[color]} border rounded-xl p-3 ${onClick ? 'cursor-pointer active:opacity-80' : ''}`}
            onClick={onClick}
        >
            <div className="text-dark-400 text-xs mb-1">{title}</div>
            <div className={`text-sm font-bold ${textColors[color]}`}>{value}</div>
            {subtitle && <div className="text-dark-400 text-xs mt-1">{subtitle}</div>}
        </div>
    );
}

// Asset Row Component
function AssetRow({ asset, onClick, formatValue }: {
    asset: PortfolioAsset;
    onClick?: () => void;
    formatValue?: (value: number, currency: string) => string;
}) {
    const isProfit = asset.unrealized_pnl >= 0;
    const displayValue = formatValue
        ? formatValue(asset.current_value, asset.currency)
        : formatCurrency(asset.current_value, asset.currency);

    return (
        <div className="px-4 py-3 active:bg-dark-700 cursor-pointer" onClick={onClick}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <AssetLogo
                        symbol={asset.symbol}
                        assetType={asset.asset_type}
                        size="md"
                    />
                    <div>
                        <div className="font-semibold text-white text-sm">{asset.symbol}</div>
                        <div className="text-xs text-dark-400">
                            {getAssetTypeName(asset.asset_type)}
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <div className="font-semibold text-white text-sm">
                        {displayValue}
                    </div>
                    <div className={`text-xs ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}{formatValue ? formatValue(asset.unrealized_pnl, asset.currency) : formatCurrency(asset.unrealized_pnl, asset.currency)}
                        <span className="opacity-75 ml-1">
                            ({formatPercent(asset.unrealized_pnl_percent)})
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;
