'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

// Crypto symbol to CoinGecko ID mapping (common ones)
const CRYPTO_ID_MAP: Record<string, string> = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'USDT': 'tether',
    'USDC': 'usd-coin',
    'BNB': 'binancecoin',
    'XRP': 'ripple',
    'ADA': 'cardano',
    'DOGE': 'dogecoin',
    'SOL': 'solana',
    'DOT': 'polkadot',
    'MATIC': 'matic-network',
    'LTC': 'litecoin',
    'SHIB': 'shiba-inu',
    'TRX': 'tron',
    'AVAX': 'avalanche-2',
    'LINK': 'chainlink',
    'ATOM': 'cosmos',
    'UNI': 'uniswap',
    'XLM': 'stellar',
    'ALGO': 'algorand',
    'NEAR': 'near',
    'FTM': 'fantom',
    'SAND': 'the-sandbox',
    'MANA': 'decentraland',
    'APE': 'apecoin',
    'CRO': 'crypto-com-chain',
    'AAVE': 'aave',
    'MKR': 'maker',
    'COMP': 'compound-governance-token',
    'SNX': 'havven',
    'YFI': 'yearn-finance',
    'SUSHI': 'sushi',
    'CAKE': 'pancakeswap-token',
    'KUB': 'bitkub-coin',
    'THB': 'thai-baht',
};

// US Stock domain mapping for Google Favicon
const US_STOCK_DOMAINS: Record<string, string> = {
    // Tech
    'AAPL': 'apple.com',
    'MSFT': 'microsoft.com',
    'GOOGL': 'google.com',
    'GOOG': 'google.com',
    'AMZN': 'amazon.com',
    'META': 'meta.com',
    'TSLA': 'tesla.com',
    'NVDA': 'nvidia.com',
    'AMD': 'amd.com',
    'INTC': 'intel.com',
    'NFLX': 'netflix.com',
    'CRM': 'salesforce.com',
    'ORCL': 'oracle.com',
    'IBM': 'ibm.com',
    'CSCO': 'cisco.com',
    'QCOM': 'qualcomm.com',
    'ADBE': 'adobe.com',
    'UBER': 'uber.com',
    'ABNB': 'airbnb.com',
    'SQ': 'squareup.com',
    'SHOP': 'shopify.com',
    'SPOT': 'spotify.com',
    'SNAP': 'snap.com',
    'TWTR': 'twitter.com',
    'ZM': 'zoom.us',
    'COIN': 'coinbase.com',
    // Industrial & Conglomerate
    'GE': 'ge.com',
    'HON': 'honeywell.com',
    'MMM': '3m.com',
    'CAT': 'caterpillar.com',
    'DE': 'deere.com',
    'BA': 'boeing.com',
    'LMT': 'lockheedmartin.com',
    'RTX': 'rtx.com',
    'UPS': 'ups.com',
    'FDX': 'fedex.com',
    // Automotive
    'GM': 'gm.com',
    'F': 'ford.com',
    'TM': 'toyota.com',
    'HMC': 'honda.com',
    // Finance
    'V': 'visa.com',
    'MA': 'mastercard.com',
    'JPM': 'jpmorganchase.com',
    'BAC': 'bankofamerica.com',
    'WFC': 'wellsfargo.com',
    'C': 'citigroup.com',
    'GS': 'goldmansachs.com',
    'MS': 'morganstanley.com',
    'AXP': 'americanexpress.com',
    'PYPL': 'paypal.com',
    // Retail & Consumer
    'WMT': 'walmart.com',
    'COST': 'costco.com',
    'HD': 'homedepot.com',
    'LOW': 'lowes.com',
    'TGT': 'target.com',
    'DIS': 'disney.com',
    'NKE': 'nike.com',
    'SBUX': 'starbucks.com',
    'MCD': 'mcdonalds.com',
    'KO': 'coca-cola.com',
    'PEP': 'pepsico.com',
    // Energy
    'XOM': 'exxonmobil.com',
    'CVX': 'chevron.com',
    'COP': 'conocophillips.com',
    // Healthcare
    'JNJ': 'jnj.com',
    'PFE': 'pfizer.com',
    'MRK': 'merck.com',
    'ABBV': 'abbvie.com',
    'UNH': 'unitedhealthgroup.com',
    // Note: Thai stocks removed - Google Favicon returns low-quality 16x16 icons
    // They will use the text placeholder fallback instead
};

interface AssetLogoProps {
    symbol: string;
    assetType: string; // 'stock' | 'crypto' | 'gold' | 'tfex' | 'fund' | 'bond' | 'foreign_stock' | 'other'
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

// Asset type color mapping
const getAssetTypeColor = (assetType: string): string => {
    switch (assetType) {
        case 'stock': return 'bg-blue-500';
        case 'foreign_stock': return 'bg-cyan-500';
        case 'crypto': return 'bg-orange-500';
        case 'gold': return 'bg-yellow-500';
        case 'tfex': return 'bg-purple-500';
        case 'fund': return 'bg-teal-500';
        case 'bond': return 'bg-indigo-500';
        default: return 'bg-gray-500';
    }
};

// Get size classes
const getSizeClasses = (size: 'sm' | 'md' | 'lg') => {
    switch (size) {
        case 'sm': return { container: 'w-8 h-8', text: 'text-xs', imgSize: 32 };
        case 'md': return { container: 'w-12 h-12', text: 'text-sm', imgSize: 48 };
        case 'lg': return { container: 'w-16 h-16', text: 'text-base', imgSize: 64 };
    }
};

// Generate logo URL based on asset type
const getLogoUrl = (symbol: string, assetType: string): string | null => {
    const upperSymbol = symbol.toUpperCase();

    switch (assetType) {
        case 'crypto': {
            // Try CoinGecko first via our mapping
            const coinId = CRYPTO_ID_MAP[upperSymbol];
            if (coinId) {
                // Use CoinGecko CDN for images
                return `https://assets.coingecko.com/coins/images/1/small/${coinId}.png`;
            }
            // Fallback: Try CryptoCompare API (no auth needed)
            return `https://www.cryptocompare.com/media/37746238/${upperSymbol.toLowerCase()}.png`;
        }
        case 'stock': {
            // Check if it's a US stock with known domain (some Thai stocks might be in the list too)
            const domain = US_STOCK_DOMAINS[upperSymbol];
            if (domain) {
                // Use Google Favicon API (free, no auth required, reliable)
                return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
            }
            // For Thai stocks, there's no reliable free API
            return null;
        }
        case 'foreign_stock': {
            // Foreign stocks - try with known domains
            const domain = US_STOCK_DOMAINS[upperSymbol];
            if (domain) {
                return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
            }
            return null;
        }
        case 'gold':
            // Use a gold icon
            return null; // We'll use emoji fallback
        case 'fund':
        case 'bond':
        case 'tfex':
        default:
            return null;
    }
};

// Gold emoji/icon
const GoldIcon = () => (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L4 8v8l8 6 8-6V8l-8-6zm0 2.5L18 9v6l-6 4.5L6 15V9l6-4.5z" fill="#FFD700" />
        <path d="M12 6l-4 3v6l4 3 4-3V9l-4-3zm0 1.5l2.5 2v4l-2.5 2-2.5-2v-4l2.5-2z" fill="#FFC107" />
    </svg>
);

export default function AssetLogo({ symbol, assetType, size = 'md', className = '' }: AssetLogoProps) {
    const [imgError, setImgError] = useState(false);
    const [imgLoaded, setImgLoaded] = useState(false);

    const sizeClasses = getSizeClasses(size);
    const logoUrl = getLogoUrl(symbol, assetType);

    // Reset error state when symbol changes
    useEffect(() => {
        setImgError(false);
        setImgLoaded(false);
    }, [symbol, assetType]);

    // Fallback: Show text placeholder
    const renderFallback = () => (
        <div
            className={`${sizeClasses.container} rounded-full ${getAssetTypeColor(assetType)} flex items-center justify-center text-white shadow-lg ${className}`}
        >
            {assetType === 'gold' ? (
                // Simple outline gold bar icon (white lines on gold background)
                <svg className={size === 'sm' ? 'w-5 h-5' : size === 'md' ? 'w-7 h-7' : 'w-9 h-9'} viewBox="0 0 24 24" fill="none">
                    {/* Gold bar outline - isometric style */}
                    <path
                        d="M4 16L8 18L20 12L16 10L4 16Z"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        fill="none"
                    />
                    <path
                        d="M4 16L4 14L8 16L8 18L4 16Z"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        fill="none"
                    />
                    <path
                        d="M8 18L8 16L20 10L20 12L8 18Z"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        fill="none"
                    />
                    <path
                        d="M4 14L8 16L20 10L16 8L4 14Z"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        fill="none"
                    />
                    {/* Top face inner line */}
                    <path
                        d="M6 14.5L8 15.5L18 10.5L16 9.5L6 14.5Z"
                        stroke="white"
                        strokeWidth="0.75"
                        strokeLinejoin="round"
                        fill="none"
                        opacity="0.6"
                    />
                </svg>
            ) : (
                <span className={`font-bold ${sizeClasses.text}`}>{symbol.slice(0, 3)}</span>
            )}
        </div>
    );

    // If no logo URL or error, show fallback
    if (!logoUrl || imgError) {
        return renderFallback();
    }

    return (
        <div className={`${sizeClasses.container} relative rounded-full overflow-hidden bg-white shadow-lg ${className}`}>
            {/* Show fallback while loading */}
            {!imgLoaded && (
                <div className="absolute inset-0">
                    {renderFallback()}
                </div>
            )}
            {/* Actual image */}
            <Image
                src={logoUrl}
                alt={`${symbol} logo`}
                width={sizeClasses.imgSize}
                height={sizeClasses.imgSize}
                className={`w-full h-full object-contain p-1.5 ${imgLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
                unoptimized // External URLs need this
            />
        </div>
    );
}

// Export helper to get logo URL directly (for use in other components)
export { getLogoUrl, getAssetTypeColor, CRYPTO_ID_MAP, US_STOCK_DOMAINS };
