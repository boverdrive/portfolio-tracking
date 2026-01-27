// Auth Types
export interface User {
    id: string;
    email: string;
    name?: string;
    avatar_url?: string;
    role: string;
    has_local_password: boolean;
    created_at: string;
}

export interface AuthResponse {
    token: string;
    user: User;
}

export interface LinkedProvider {
    provider: string;
    email: string;
    linked_at: string;
}

export interface OidcProviderInfo {
    name: string;
    enabled: boolean;
}

export interface AuthProvidersResponse {
    google: boolean;
    oidc?: OidcProviderInfo;
    local: boolean;
}

// Asset types
export type AssetType = 'stock' | 'tfex' | 'crypto' | 'foreign_stock' | 'gold' | 'commodity';

export type TradeAction = 'buy' | 'sell' | 'long' | 'short' | 'close_long' | 'close_short' | 'dividend' | 'deposit' | 'withdraw' | 'transfer';

// Market/Exchange types
export type Market =
    // Thai markets
    | 'set' | 'mai' | 'tfex'
    // US markets
    | 'nyse' | 'nasdaq' | 'amex'
    // European markets
    | 'lse' | 'euronext' | 'xetra'
    // Asian markets
    | 'hkex' | 'tse' | 'sgx' | 'krx'
    // Crypto exchanges
    | 'binance' | 'coinbase' | 'bitkub' | 'htx' | 'okx' | 'kucoin'
    // Commodities
    | 'comex' | 'lbma'
    // Other
    | 'other' | 'local';

// Transaction model
export interface Transaction {
    id: string;
    asset_type: AssetType;
    symbol: string;
    symbol_name?: string;
    action: TradeAction;
    quantity: number;
    price: number;
    fees: number;
    timestamp: string;
    market?: Market;
    currency?: string;
    notes?: string;
    account_id?: string;
    tags?: string[];
    leverage?: number;
    initial_margin?: number;
    unit?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateTransactionRequest {
    asset_type: AssetType;
    symbol: string;
    symbol_name?: string;
    action: TradeAction;
    quantity: number;
    price: number;
    fees?: number;
    timestamp?: string;
    market?: Market;
    currency?: string;
    notes?: string;
    account_id?: string;
    tags?: string[];
    leverage?: number;
    initial_margin?: number;
    unit?: string;
}

export interface UpdateTransactionRequest {
    asset_type?: AssetType;
    symbol?: string;
    symbol_name?: string;
    action?: TradeAction;
    quantity?: number;
    price?: number;
    fees?: number;
    timestamp?: string;
    market?: Market;
    currency?: string;
    notes?: string;
    account_id?: string;
    tags?: string[];
    initial_margin?: number;
    unit?: string;
}

// Portfolio models
export interface PortfolioAsset {
    symbol: string;
    asset_type: AssetType;
    market?: Market;
    currency: string;
    unit?: string;
    quantity: number;
    avg_cost: number;
    total_fees: number;
    current_price: number;
    total_cost: number;
    current_value: number;
    unrealized_pnl: number;
    unrealized_pnl_percent: number;
    realized_pnl: number;
    leverage?: number;
    position_type?: string;
    realized_dividend?: number;
}

export interface PortfolioSummary {
    total_invested: number;
    total_current_value: number;
    total_unrealized_pnl: number;
    total_unrealized_pnl_percent: number;
    total_realized_pnl: number;
    realized_pnl_breakdown?: Record<string, number>;
    total_dividend?: number;
    assets_count: number;
}

export interface PortfolioResponse {
    summary: PortfolioSummary;
    assets: PortfolioAsset[];
}

// Price models
export interface PriceEntry {
    symbol: string;
    price: number;
    currency: string;
    updated_at: string;
}

// API response types
export interface ApiError {
    error: string;
    status: number;
}

// Account types
export interface Account {
    id: string;
    name: string;
    description?: string;
    color?: string;
    target_value?: number;
    target_currency: string;
    created_at: string;
    updated_at: string;
}

export interface CreateAccountRequest {
    name: string;
    description?: string;
    color?: string;
    target_value?: number;
    target_currency?: string;
}

export interface UpdateAccountRequest {
    name?: string;
    description?: string;
    color?: string;
    target_value?: number;
    target_currency?: string;
}

// Exchange Rate types
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
