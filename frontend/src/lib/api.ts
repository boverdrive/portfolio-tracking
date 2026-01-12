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
} from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const TOKEN_KEY = 'auth_token';

// Get auth token from localStorage
function getAuthToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
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

    // Add Authorization header if token exists
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers,
        ...options,
    });

    if (!response.ok) {
        if (response.status === 401) {
            // Token expired or invalid
            localStorage.removeItem(TOKEN_KEY);
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }

        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || error.message || `Request failed: ${response.status}`);
    }

    return response.json();
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

export async function getTransactionsByType(
    assetType: AssetType
): Promise<Transaction[]> {
    return fetchApi<Transaction[]>(`/api/transactions/type/${assetType}`);
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

export async function getPortfolioByMarket(
    market: Market
): Promise<PortfolioResponse> {
    return fetchApi<PortfolioResponse>(`/api/portfolio/market/${market}`);
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

export async function clearPriceCache(): Promise<void> {
    await fetchApi('/api/prices/cache/clear', {
        method: 'POST',
    });
}

// ==================== Exchange Rate API ====================

export type DisplayCurrency = 'THB' | 'USD' | 'BTC';

export interface ExchangeRateResponse {
    from: string;
    to: string;
    rate: number;
    amount: number;
    converted: number;
}

export interface ExchangeRatesResponse {
    base_currency: string;
    rates: Record<string, number>;
    updated_at: string;
}

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

// ==================== Utility Functions ====================

export function getEffectiveCurrency(tx: Transaction, defaultCurrency: string = 'THB'): string {
    // Priority 0: Explicit trusted currency (NOT THB)
    // If the user explicitly set EUR, JPY, etc., we trust it.
    // We only inspect 'THB' suspiciously because it's the system default.
    if (tx.currency && tx.currency !== 'THB') return tx.currency.toUpperCase();

    // Priority 1: Market-based inference (strongest signal)
    if (tx.market) {
        const m = tx.market.toLowerCase();
        // Global Crypto Exchanges typically trade in USDT/USDC pairs
        if (['binance', 'okx', 'htx', 'kucoin', 'bybit', 'gate', 'mexc'].includes(m)) return 'USDT';
        // US Markets / Global Markets typically trade in USD
        if (['nyse', 'nasdaq', 'amex', 'coinbase', 'comex', 'lbma', 'forex'].includes(m)) return 'USD';
        // Thai Markets typically trade in THB - Force return THB here and stop checking
        if (['set', 'mai', 'tfex', 'bitkub'].includes(m)) return 'THB';
    }

    // Priority 2: Asset Type Intelligence (New!)
    // If track record lacks market info but has asset_type, use it.
    // Crypto defaults to USDT (standard for portfolio tracking)
    if (tx.asset_type === 'crypto') return 'USDT';
    // Foreign Stocks default to USD
    if (tx.asset_type === 'foreign_stock') return 'USD';
    // Gold defaults to USD (XAU/USD)
    if (tx.asset_type === 'gold') return 'USD';

    // Priority 3: Symbol-based inference (Fallback)
    const sym = tx.symbol.toUpperCase();
    const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'BNB', 'TRX', 'MATIC', 'DOT', 'LTC', 'BCH', 'XLM', 'ATOM', 'UNI', 'ALGO', 'NEAR', 'VET', 'FTM', 'SAND', 'MANA', 'AXS', 'FIL', 'ICP', 'EGLD', 'AAVE', 'LINK', 'SUSHI', 'CRV', 'COMP', 'MKR', 'SNX', 'YFI', '1INCH', 'GRT', 'RUNE', 'CAKE', 'BAKE', 'DOGE', 'SHIB', 'PEPE', 'FLOKI'].includes(sym);
    if (isCrypto) return 'USDT';
    if (['XAU', 'XAG', 'USDT', 'USDC', 'BUSD', 'DAI'].includes(sym)) return 'USD';

    // Priority 4: Default fallback
    if (tx.currency) return tx.currency.toUpperCase();

    return defaultCurrency;
}

export function formatCurrency(
    amount: number,
    currency: string = 'THB'
): string {
    // Handle crypto currencies specially (not supported by Intl.NumberFormat)
    const cryptoCurrencies = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'DOGE'];
    if (cryptoCurrencies.includes(currency.toUpperCase())) {
        // For crypto, show more decimal places for small amounts
        const decimals = Math.abs(amount) < 1 ? 8 : Math.abs(amount) < 100 ? 6 : 2;
        return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals })}`;
    }

    // Handle different fiat currencies
    const currencyMap: Record<string, string> = {
        'THB': 'th-TH',
        'USD': 'en-US',
        'EUR': 'de-DE',
        'GBP': 'en-GB',
        'JPY': 'ja-JP',
        'HKD': 'zh-HK',
        'SGD': 'en-SG',
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
        // Fallback for unsupported currencies
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

export function getAssetTypeName(type: AssetType, language: string = 'th'): string {
    const names: Record<AssetType, { th: string; en: string }> = {
        stock: { th: 'หุ้นไทย', en: 'Thai Stock' },
        tfex: { th: 'TFEX', en: 'TFEX' },
        crypto: { th: 'Crypto', en: 'Crypto' },
        foreign_stock: { th: 'หุ้นต่างประเทศ', en: 'Foreign Stock' },
        gold: { th: 'ทองคำ', en: 'Gold' },
        commodity: { th: 'สินค้าโภคภัณฑ์', en: 'Commodity' },
    };
    const nameObj = names[type];
    return nameObj ? (language === 'th' ? nameObj.th : nameObj.en) : type;
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

export function getMarketName(market: Market, language: string = 'th'): string {
    const names: Record<Market, { th: string; en: string }> = {
        // Thai
        set: { th: 'SET (ตลาดหลักทรัพย์)', en: 'SET (Stock Exchange)' },
        mai: { th: 'MAI', en: 'MAI' },
        tfex: { th: 'TFEX', en: 'TFEX' },
        // US
        nyse: { th: 'NYSE (New York)', en: 'NYSE (New York)' },
        nasdaq: { th: 'NASDAQ', en: 'NASDAQ' },
        amex: { th: 'AMEX', en: 'AMEX' },
        // Europe
        lse: { th: 'LSE (London)', en: 'LSE (London)' },
        euronext: { th: 'Euronext', en: 'Euronext' },
        xetra: { th: 'Xetra (Frankfurt)', en: 'Xetra (Frankfurt)' },
        // Asia
        hkex: { th: 'HKEX (Hong Kong)', en: 'HKEX (Hong Kong)' },
        tse: { th: 'TSE (Tokyo)', en: 'TSE (Tokyo)' },
        sgx: { th: 'SGX (Singapore)', en: 'SGX (Singapore)' },
        krx: { th: 'KRX (Korea)', en: 'KRX (Korea)' },
        // Crypto
        binance: { th: 'Binance', en: 'Binance' },
        coinbase: { th: 'Coinbase', en: 'Coinbase' },
        bitkub: { th: 'Bitkub', en: 'Bitkub' },
        htx: { th: 'HTX', en: 'HTX' },
        okx: { th: 'OKX', en: 'OKX' },
        kucoin: { th: 'KuCoin', en: 'KuCoin' },
        // Commodities
        comex: { th: 'COMEX', en: 'COMEX' },
        lbma: { th: 'LBMA (London)', en: 'LBMA (London)' },
        other: { th: 'อื่นๆ', en: 'Other' },
    };
    const nameObj = names[market];
    return nameObj ? (language === 'th' ? nameObj.th : nameObj.en) : market;
}

export function getMarketsByAssetType(type: AssetType): Market[] {
    switch (type) {
        case 'stock':
            return ['set', 'mai'];
        case 'tfex':
            return ['tfex'];
        case 'crypto':
            return ['binance', 'coinbase', 'bitkub', 'htx', 'okx', 'kucoin'];
        case 'foreign_stock':
            return ['nyse', 'nasdaq', 'lse', 'hkex', 'tse', 'sgx', 'euronext', 'xetra'];
        case 'gold':
            return ['comex', 'lbma', 'other'];
        case 'commodity':
            return ['comex', 'other'];
        default:
            return ['other'];
    }
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

export async function reorderAccounts(ids: string[]): Promise<void> {
    await fetchApi('/api/accounts/reorder', {
        method: 'PUT',
        body: JSON.stringify(ids),
    });
}

// ==================== System API ====================

export interface SeedResponse {
    seeded: number;
    message: string;
}

export async function seedSymbols(): Promise<SeedResponse> {
    return fetchApi<SeedResponse>('/api/symbols/seed', {
        method: 'POST',
    });
}

// ==================== Portfolio Snapshots API ====================

export interface PortfolioSnapshotAsset {
    symbol: string;
    asset_type: string;
    market?: string;
    quantity: number;
    avg_cost: number;
    current_price: number;
    current_value: number;
    unrealized_pnl: number;
    unrealized_pnl_percent: number;
}

export interface PortfolioSnapshot {
    id: string;
    user_id: string;
    account_id?: string;
    date: string;
    total_invested: number;
    total_current_value: number;
    total_unrealized_pnl: number;
    total_unrealized_pnl_percent: number;
    total_realized_pnl: number;
    assets_count?: number | null;
    currency: string;
    assets?: PortfolioSnapshotAsset[];
}

export async function getSnapshots(days?: number): Promise<PortfolioSnapshot[]> {
    const params = days ? `?days=${days}` : '';
    return fetchApi<PortfolioSnapshot[]>(`/api/snapshots${params}`);
}

export async function getSnapshotsRange(from: string, to: string): Promise<PortfolioSnapshot[]> {
    return fetchApi<PortfolioSnapshot[]>(`/api/snapshots?from=${from}&to=${to}`);
}

export async function createSnapshotNow(): Promise<{ message: string; date: string }> {
    return fetchApi('/api/snapshots/now', {
        method: 'POST',
    });
}

// ==================== API Provider API ====================

export interface ApiProvider {
    id: string;
    market_id: string;
    provider_name: string;
    provider_type: string;
    api_url: string;
    priority: number;
    enabled: boolean;
    timeout_ms: number;
}

export interface CreateApiProviderRequest {
    market_id: string;
    provider_name: string;
    provider_type: string;
    api_url?: string;
    priority: number;
    enabled?: boolean;
    timeout_ms?: number;
}

export interface UpdateApiProviderRequest {
    provider_name?: string;
    provider_type?: string;
    api_url?: string;
    priority?: number;
    enabled?: boolean;
    timeout_ms?: number;
}

export interface ApiCallLog {
    id: string;
    provider_type: string;
    market_id?: string;
    symbol: string;
    status: string;
    response_time_ms: number;
    price?: number;
    currency?: string;
    error_message?: string;
    request_url?: string;
    created: string;
}

export interface ApiCallStats {
    provider_type: string;
    total_calls: number;
    success_count: number;
    error_count: number;
    success_rate: number;
    avg_response_time_ms: number;
}

export async function getApiProviders(): Promise<ApiProvider[]> {
    return fetchApi<ApiProvider[]>('/api/providers');
}

export async function getApiProvidersByMarket(marketId: string): Promise<ApiProvider[]> {
    return fetchApi<ApiProvider[]>(`/api/providers/market/${marketId}`);
}

export async function createApiProvider(data: CreateApiProviderRequest): Promise<ApiProvider> {
    return fetchApi<ApiProvider>('/api/providers', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function updateApiProvider(id: string, data: UpdateApiProviderRequest): Promise<ApiProvider> {
    return fetchApi<ApiProvider>(`/api/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

export async function deleteApiProvider(id: string): Promise<void> {
    await fetchApi(`/api/providers/${id}`, {
        method: 'DELETE',
    });
}

export async function reorderApiProviders(marketId: string, providerIds: string[]): Promise<void> {
    await fetchApi(`/api/providers/market/${marketId}/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ provider_ids: providerIds }),
    });
}

export async function getApiLogs(page: number = 1, perPage: number = 50): Promise<{
    items: ApiCallLog[];
    total: number;
    page: number;
    per_page: number;
}> {
    return fetchApi(`/api/logs?page=${page}&per_page=${perPage}`);
}

export async function getApiStats(): Promise<ApiCallStats[]> {
    return fetchApi<ApiCallStats[]>('/api/logs/stats');
}
