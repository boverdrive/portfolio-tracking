import {
    Transaction,
    CreateTransactionRequest,
    UpdateTransactionRequest,
    PortfolioResponse,
    PortfolioSummary,
    PriceEntry,
    AssetType,
    Market,
    Account,
    CreateAccountRequest,
    UpdateAccountRequest,
    ExchangeRateResponse,
    ExchangeRatesResponse,
} from '@/types';

// API Base URL - configurable via settings
const API_BASE_URL_KEY = 'api_base_url';
const TOKEN_KEY = 'auth_token';

export function getApiBaseUrl(): string {
    const stored = localStorage.getItem(API_BASE_URL_KEY);
    return stored || 'http://localhost:3001';
}

export function setApiBaseUrl(url: string): void {
    localStorage.setItem(API_BASE_URL_KEY, url);
}

function getAuthToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
    localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
    return !!getAuthToken();
}

// Login with email/password
export async function login(email: string, password: string): Promise<{ token: string; user: { email: string; name?: string } }> {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/local/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Login failed' }));
        throw new Error(error.error || 'Login failed');
    }

    const data = await response.json();
    setAuthToken(data.token);
    return data;
}

// Generic fetch wrapper with error handling and auth
async function fetchApi<T>(
    endpoint: string,
    options?: RequestInit
): Promise<T> {
    const token = getAuthToken();

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string>),
    };

    if (token) {
        // Debug Log
        console.log('📡 Fetch API with Token:', token.substring(0, 15) + '... (len=' + token.length + ')');
        headers['Authorization'] = `Bearer ${token}`;
    } else {
        console.log('⚠️ Fetch API WITHOUT Token');
    }

    const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
        headers,
        ...options,
    });

    if (!response.ok) {
        if (response.status === 401) {
            clearAuthToken();
            throw new Error('Unauthorized');
        }

        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || error.message || `Request failed: ${response.status}`);
    }

    return response.json();
}

// Get current user profile
export interface UserProfile {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
}

export async function getCurrentUser(): Promise<UserProfile> {
    return fetchApi<UserProfile>('/api/auth/me');
}

// ==================== Transaction API ====================

export async function getTransactions(): Promise<Transaction[]> {
    return fetchApi<Transaction[]>('/api/transactions');
}

export async function getTransaction(id: string): Promise<Transaction> {
    return fetchApi<Transaction>(`/api/transactions/${id}`);
}

export async function createTransaction(
    data: CreateTransactionRequest
): Promise<Transaction> {
    return fetchApi<Transaction>('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function createTransactionsBulk(
    data: CreateTransactionRequest[]
): Promise<{ success: boolean; count: number; errors: string[] }> {
    return fetchApi<{ success: boolean; count: number; errors: string[] }>('/api/transactions/bulk', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function updateTransaction(
    id: string,
    data: UpdateTransactionRequest
): Promise<Transaction> {
    return fetchApi<Transaction>(`/api/transactions/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

export async function deleteTransaction(id: string): Promise<void> {
    await fetchApi(`/api/transactions/${id}`, {
        method: 'DELETE',
    });
}

// ==================== Portfolio API ====================

export async function getPortfolio(options?: { includeClosedPositions?: boolean }): Promise<PortfolioResponse> {
    const params = new URLSearchParams();
    if (options?.includeClosedPositions) {
        params.set('include_closed', 'true');
    }
    const queryString = params.toString() ? `?${params.toString()}` : '';
    return fetchApi<PortfolioResponse>(`/api/portfolio${queryString}`);
}

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
    return fetchApi<PortfolioSummary>('/api/portfolio/summary');
}

export async function getPortfolioByType(
    assetType: AssetType
): Promise<PortfolioResponse> {
    return fetchApi<PortfolioResponse>(`/api/portfolio/type/${assetType}`);
}

// ==================== Price API ====================

export async function getPrice(
    symbol: string,
    assetType: AssetType,
    market?: Market
): Promise<PriceEntry> {
    let url = `/api/prices/${symbol}?asset_type=${assetType}`;
    if (market) {
        url += `&market=${market}`;
    }
    return fetchApi<PriceEntry>(url);
}

export async function getPricesBatch(
    symbols: { symbol: string; asset_type: AssetType; market?: Market }[]
): Promise<Record<string, PriceEntry | { error: string }>> {
    return fetchApi('/api/prices/batch', {
        method: 'POST',
        body: JSON.stringify({ symbols }),
    });
}

// ==================== Exchange Rate API ====================

export async function getExchangeRate(
    from: string,
    to: string,
    amount: number = 1
): Promise<ExchangeRateResponse> {
    return fetchApi<ExchangeRateResponse>(
        `/api/exchange-rate?from=${from}&to=${to}&amount=${amount}`
    );
}

export async function getAllExchangeRates(base: string): Promise<ExchangeRatesResponse> {
    return fetchApi<ExchangeRatesResponse>(`/api/exchange-rate/${base}`);
}

export async function convertCurrency(
    amount: number,
    from: string,
    to: string
): Promise<number> {
    const result = await getExchangeRate(from, to, amount);
    return result.converted;
}

// ==================== Account API ====================

export async function getAccounts(): Promise<Account[]> {
    return fetchApi<Account[]>('/api/accounts');
}

export async function getAccount(id: string): Promise<Account> {
    return fetchApi<Account>(`/api/accounts/${id}`);
}

export async function createAccount(
    data: CreateAccountRequest
): Promise<Account> {
    return fetchApi<Account>('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function updateAccount(
    id: string,
    data: UpdateAccountRequest
): Promise<Account> {
    return fetchApi<Account>(`/api/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

export async function deleteAccount(id: string): Promise<void> {
    await fetchApi(`/api/accounts/${id}`, {
        method: 'DELETE',
    });
}

// ==================== Utility Functions ====================

export function formatCurrency(
    amount: number,
    currency: string = 'THB'
): string {
    const cryptoCurrencies = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'DOGE'];
    if (cryptoCurrencies.includes(currency.toUpperCase())) {
        const decimals = Math.abs(amount) < 1 ? 8 : Math.abs(amount) < 100 ? 6 : 2;
        return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals })}`;
    }

    const currencyMap: Record<string, string> = {
        'THB': 'th-TH',
        'USD': 'en-US',
        'EUR': 'de-DE',
        'GBP': 'en-GB',
        'JPY': 'ja-JP',
    };

    const locale = currencyMap[currency] || 'en-US';

    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        return `${currency} ${amount.toFixed(2)}`;
    }
}

export function formatPercent(value: number): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
}

export function formatNumber(value: number, decimals: number = 2): string {
    return new Intl.NumberFormat('th-TH', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(value);
}

export function getAssetTypeName(type: AssetType): string {
    const names: Record<AssetType, string> = {
        stock: 'หุ้นไทย',
        tfex: 'TFEX',
        crypto: 'Crypto',
        foreign_stock: 'หุ้นต่างประเทศ',
        gold: 'ทองคำ',
        commodity: 'สินค้าโภคภัณฑ์',
    };
    return names[type] || type;
}

export function getAssetTypeColor(type: AssetType): string {
    const colors: Record<AssetType, string> = {
        stock: 'bg-blue-500',
        tfex: 'bg-purple-500',
        crypto: 'bg-orange-500',
        foreign_stock: 'bg-emerald-500',
        gold: 'bg-yellow-500',
        commodity: 'bg-amber-600',
    };
    return colors[type] || 'bg-gray-500';
}
