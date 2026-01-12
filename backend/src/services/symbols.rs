//! Symbols service for PocketBase storage

use crate::error::AppError;
use crate::services::PocketBaseClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Symbol stored in PocketBase
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Symbol {
    #[serde(default)]
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub asset_type: String,
    #[serde(default)]
    pub market: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub sector: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
}

/// PocketBase list response
#[derive(Debug, Deserialize)]
struct PBListResponse {
    items: Vec<Symbol>,
}

/// Symbols service for PocketBase operations
#[derive(Clone)]
pub struct SymbolsService {
    pocketbase_url: String,
    http_client: reqwest::Client,
    pb_client: PocketBaseClient,
    cache: Arc<RwLock<Vec<Symbol>>>,
    loaded: Arc<RwLock<bool>>,
}

impl SymbolsService {
    pub fn new(pocketbase_url: String, pb_client: PocketBaseClient) -> Self {
        Self {
            pocketbase_url,
            http_client: reqwest::Client::new(),
            pb_client,
            cache: Arc::new(RwLock::new(Vec::new())),
            loaded: Arc::new(RwLock::new(false)),
        }
    }

    /// Load symbols from PocketBase
    pub async fn load_symbols(&self) -> Result<(), AppError> {
        let loaded = *self.loaded.read().await;
        if loaded {
            return Ok(());
        }

        let token = self.pb_client.get_token().await;
        let url = format!("{}/api/collections/symbols/records?perPage=2000", self.pocketbase_url);

        let request = self.http_client.get(&url);
        let request = if !token.is_empty() { request.header("Authorization", token) } else { request };

        match request.send().await {
            Ok(response) => {
                if response.status().is_success() {
                    if let Ok(data) = response.json::<PBListResponse>().await {
                        let mut cache = self.cache.write().await;
                        let mut items = data.items;
                        
                        // Merge with static crypto symbols
                        let static_cryptos = Self::get_static_crypto_symbols();
                        for static_item in static_cryptos {
                            if !items.iter().any(|i| i.symbol == static_item.symbol && i.asset_type == static_item.asset_type) {
                                items.push(static_item);
                            }
                        }

                        // Merge with static thai stocks
                        let static_thai = Self::get_static_thai_stocks();
                        for static_item in static_thai {
                            if !items.iter().any(|i| i.symbol == static_item.symbol && i.asset_type == static_item.asset_type) {
                                items.push(static_item);
                            }
                        }

                        // Merge with static foreign stocks
                        let static_foreign = Self::get_static_foreign_stocks();
                         for static_item in static_foreign {
                            if !items.iter().any(|i| i.symbol == static_item.symbol && i.asset_type == static_item.asset_type) {
                                items.push(static_item);
                            }
                        }

                        // Merge with static tfex
                        let static_tfex = Self::get_static_tfex();
                        for static_item in static_tfex {
                            if !items.iter().any(|i| i.symbol == static_item.symbol && i.asset_type == static_item.asset_type) {
                                items.push(static_item);
                            }
                        }
                        
                        *cache = items;
                        tracing::info!("📦 Loaded {} symbols (including static)", cache.len());
                    }
                } else {
                    tracing::warn!("⚠️ Could not load symbols from PocketBase: {}", response.status());
                }
            }
            Err(e) => {
                tracing::warn!("⚠️ Could not connect to PocketBase for symbols: {}", e);
            }
        }

        *self.loaded.write().await = true;
        Ok(())
    }

    /// Get symbols by asset type
    pub async fn get_by_asset_type(&self, asset_type: &str, query: Option<&str>, market: Option<&str>, limit: usize) -> Vec<Symbol> {
        let _ = self.load_symbols().await;
        let cache = self.cache.read().await;

        let filtered: Vec<Symbol> = cache
            .iter()
            .filter(|s| s.asset_type == asset_type)
            .filter(|s| {
                match market {
                    Some(m) if !m.is_empty() => s.market.as_deref() == Some(m),
                    _ => true,
                }
            })
            .filter(|s| {
                match query {
                    Some(q) if !q.is_empty() => {
                        let search = q.to_uppercase();
                        s.symbol.to_uppercase().contains(&search) || s.name.to_uppercase().contains(&search)
                    }
                    _ => true,
                }
            })
            .take(limit)
            .cloned()
            .collect();

        filtered
    }

    /// Lookup a single symbol by exact match
    pub async fn lookup_symbol(&self, symbol: &str) -> Option<Symbol> {
        let _ = self.load_symbols().await;
        let cache = self.cache.read().await;
        let target = symbol.trim().to_uppercase(); 
        
        cache.iter()
            .find(|s| s.symbol.trim().to_uppercase() == target)
            .cloned()
    }

    /// Check if symbols are loaded
    pub async fn has_symbols(&self) -> bool {
        let _ = self.load_symbols().await;
        let cache = self.cache.read().await;
        !cache.is_empty()
    }

    /// Seed symbols to PocketBase
    pub async fn seed_symbols(&self, symbols: Vec<Symbol>) -> Result<usize, AppError> {
        let url = format!("{}/api/collections/symbols/records", self.pocketbase_url);
        let mut count = 0;
        let pb_client = self.pb_client.clone();
        
        let client = self.http_client.clone();
        
        // We can't use parallel iter here easily with async token fetch per item if we want efficiency.
        // Actually, we can just get token once.
        let token = pb_client.get_token().await;

        for symbol in symbols {
            // Create payload without ID (let PocketBase generate it)
            let payload = serde_json::json!({
                "symbol": symbol.symbol,
                "name": symbol.name,
                "asset_type": symbol.asset_type,
                "market": symbol.market,
                "category": symbol.category,
                "sector": symbol.sector,
                "icon_url": symbol.icon_url,
            });

            let req = client.post(&url);
            let req = if !token.is_empty() { req.header("Authorization", &token) } else { req };

            match req.json(&payload).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        count += 1;
                    }
                }
                Err(_) => continue,
            }
        }

        // Reload cache
        *self.loaded.write().await = false;
        let _ = self.load_symbols().await;

        Ok(count)
    }

    /// Get static list of crypto symbols (fallback)
    fn get_static_crypto_symbols() -> Vec<Symbol> {
        vec![
            ("BTC", "Bitcoin", "Layer 1"), ("ETH", "Ethereum", "Layer 1"), ("BNB", "Binance Coin", "Exchange"),
            ("XRP", "Ripple", "Payment"), ("SOL", "Solana", "Layer 1"), ("ADA", "Cardano", "Layer 1"),
            ("DOGE", "Dogecoin", "Meme"), ("TRX", "TRON", "Layer 1"), ("TON", "Toncoin", "Layer 1"),
            ("DOT", "Polkadot", "Layer 0"), ("MATIC", "Polygon", "Layer 2"), ("LTC", "Litecoin", "Payment"),
            ("SHIB", "Shiba Inu", "Meme"), ("BCH", "Bitcoin Cash", "Payment"), ("AVAX", "Avalanche", "Layer 1"),
            ("LINK", "Chainlink", "Oracle"), ("XLM", "Stellar", "Payment"), ("UNI", "Uniswap", "DeFi"),
            ("ATOM", "Cosmos", "Layer 0"), ("XMR", "Monero", "Privacy"), ("ETC", "Ethereum Classic", "Layer 1"),
            ("HBAR", "Hedera", "Layer 1"), ("FIL", "Filecoin", "Storage"), ("APT", "Aptos", "Layer 1"),
            ("ARB", "Arbitrum", "Layer 2"), ("OP", "Optimism", "Layer 2"), ("NEAR", "NEAR Protocol", "Layer 1"),
            ("VET", "VeChain", "Supply Chain"), ("ICP", "Internet Computer", "Layer 1"), ("INJ", "Injective", "DeFi"),
            ("AAVE", "Aave", "DeFi"), ("MKR", "Maker", "DeFi"), ("ALGO", "Algorand", "Layer 1"),
            ("GRT", "The Graph", "Infrastructure"), ("FTM", "Fantom", "Layer 1"), ("SAND", "The Sandbox", "Metaverse"),
            ("MANA", "Decentraland", "Metaverse"), ("AXS", "Axie Infinity", "Gaming"), ("GALA", "Gala", "Gaming"),
            ("IMX", "Immutable X", "Gaming"), ("CRV", "Curve DAO", "DeFi"), ("LDO", "Lido DAO", "DeFi"),
            ("SNX", "Synthetix", "DeFi"), ("COMP", "Compound", "DeFi"), ("SUSHI", "SushiSwap", "DeFi"),
            ("1INCH", "1inch", "DeFi"), ("PEPE", "Pepe", "Meme"), ("FLOKI", "Floki", "Meme"),
            ("WIF", "dogwifhat", "Meme"), ("BONK", "Bonk", "Meme"), ("XAG", "Silver", "Commodity"),
            ("XAU", "Gold", "Commodity"), ("USDT", "Tether", "Stablecoin"), ("USDC", "USD Coin", "Stablecoin"),
            ("DAI", "Dai", "Stablecoin"), ("BUSD", "Binance USD", "Stablecoin"), ("RNDR", "Render", "AI"),
            ("FET", "Fetch.ai", "AI"), ("OCEAN", "Ocean Protocol", "AI"), ("AGIX", "SingularityNET", "AI"),
            ("TAO", "Bittensor", "AI"), ("KUB", "Bitkub Coin", "Exchange"), ("SIX", "SIX Network", "Thai"),
            ("JFIN", "JFIN Coin", "Thai")
        ].into_iter().map(|(s, n, c)| Symbol {
             id: String::new(),
             symbol: s.to_string(),
             name: n.to_string(),
             asset_type: "crypto".to_string(),
             market: None,
             category: Some(c.to_string()),
             sector: None,
             icon_url: None,
        }).collect()
    }

    fn get_static_thai_stocks() -> Vec<Symbol> {
        vec![
            ("PTT", "PTT Public Company Limited"), ("PTTEP", "PTT Exploration and Production"), ("PTTGC", "PTT Global Chemical"),
            ("GPSC", "Global Power Synergy"), ("GULF", "Gulf Energy Development"), ("BGRIM", "B.Grimm Power"),
            ("BANPU", "Banpu Public Company"), ("EGCO", "Electricity Generating"), ("RATCH", "Ratch Group"), ("EA", "Energy Absolute"),
            ("SCB", "SCB X Public Company"), ("KBANK", "Kasikornbank"), ("BBL", "Bangkok Bank"), ("KTB", "Krungthai Bank"),
            ("TTB", "TMBThanachart Bank"), ("TISCO", "TISCO Financial Group"), ("KKP", "Kiatnakin Phatra Bank"),
            ("ADVANC", "Advanced Info Service"), ("TRUE", "True Corporation"), ("INTUCH", "Intouch Holdings"),
            ("DELTA", "Delta Electronics Thailand"), ("HANA", "Hana Microelectronics"), ("JTS", "Jasmine Technology Solution"),
            ("BDMS", "Bangkok Dusit Medical Services"), ("BH", "Bumrungrad Hospital"), ("BCH", "Bangkok Chain Hospital"),
            ("CHG", "Chularat Hospital Group"), ("PR9", "Praram 9 Hospital"), ("CPN", "Central Pattana"), ("LH", "Land and Houses"),
            ("AP", "AP Thailand"), ("SPALI", "Supalai"), ("PSH", "Pruksa Holding"), ("SC", "SC Asset Corporation"),
            ("ORI", "Origin Property"), ("SIRI", "Sansiri"), ("WHA", "WHA Corporation"), ("SCC", "Siam Cement Group"),
            ("CPALL", "CP ALL"), ("CPF", "Charoen Pokphand Foods"), ("MAKRO", "Siam Makro"), ("BJC", "Berli Jucker"),
            ("HMPRO", "Home Product Center"), ("GLOBAL", "Siam Global House"), ("BEAUTY", "Beauty Community"), ("COM7", "Com7"),
            ("MINT", "Minor International"), ("BCP", "Bangchak Corporation"), ("TU", "Thai Union Group"), ("CBG", "Carabao Group"),
            ("OSP", "Osotspa"), ("AOT", "Airports of Thailand"), ("BEM", "Bangkok Expressway and Metro"), ("BTS", "BTS Group Holdings"),
            ("AAV", "Asia Aviation"), ("IVL", "Indorama Ventures"), ("IRPC", "IRPC"), ("TOP", "Thai Oil"), ("SCGP", "SCG Packaging"),
            ("BLA", "Bangkok Life Assurance"), ("TLI", "Thai Life Insurance"), ("TIPH", "Dhipaya Group Holdings"),
            ("MAJOR", "Major Cineplex Group"), ("VGI", "VGI"), ("PLANB", "Plan B Media"), ("CENTEL", "Central Plaza Hotel"),
            ("ERW", "The Erawan Group"), ("AWC", "Asset World Corp"), ("SAWAD", "Srisawad Corporation"), ("MTC", "Muangthai Capital"),
            ("TIDLOR", "Ngern Tid Lor"), ("KCE", "KCE Electronics"), ("STGT", "Sri Trang Gloves Thailand"), ("RS", "RS"),
            ("JMT", "JMT Network Services"), ("STA", "Sri Trang Agro-Industry"), ("THG", "Thonburi Healthcare Group"),
            ("SINGER", "Singer Thailand"), ("SAPPE", "Sappe"), ("SABINA", "Sabina"), ("AMATA", "Amata Corporation"),
            ("GUNKUL", "Gunkul Engineering"), ("MEGA", "Mega Lifesciences"), ("THANI", "Ratchathani Leasing"),
            ("TKN", "Thai Krungthai Capital"), ("EPG", "Eastern Polymer Group"), ("BPP", "Banpu Power"), ("STARK", "Stark Corporation")
        ].into_iter().map(|(s, n)| Symbol {
            id: String::new(), symbol: s.to_string(), name: n.to_string(), asset_type: "stock".to_string(),
            market: Some("SET".to_string()), category: None, sector: None, icon_url: None,
        }).collect()
    }

    fn get_static_foreign_stocks() -> Vec<Symbol> {
        vec![
            ("AAPL", "Apple Inc."), ("MSFT", "Microsoft Corporation"), ("GOOGL", "Alphabet Inc. Class A"), ("GOOG", "Alphabet Inc. Class C"),
            ("AMZN", "Amazon.com Inc."), ("META", "Meta Platforms Inc."), ("NVDA", "NVIDIA Corporation"), ("TSLA", "Tesla Inc."),
            ("AMD", "Advanced Micro Devices"), ("INTC", "Intel Corporation"), ("NFLX", "Netflix Inc."), ("AVGO", "Broadcom Inc."),
            ("ADBE", "Adobe Inc."), ("CRM", "Salesforce Inc."), ("CSCO", "Cisco Systems Inc."), ("ORCL", "Oracle Corporation"),
            ("QCOM", "Qualcomm Inc."), ("PYPL", "PayPal Holdings Inc."), ("COIN", "Coinbase Global Inc."), ("UBER", "Uber Technologies Inc."),
            ("ABNB", "Airbnb Inc."), ("SQ", "Block Inc."), ("SHOP", "Shopify Inc."), ("ZM", "Zoom Video Communications"),
            ("PLTR", "Palantir Technologies"), ("JPM", "JPMorgan Chase & Co."), ("V", "Visa Inc."), ("MA", "Mastercard Inc."),
            ("JNJ", "Johnson & Johnson"), ("WMT", "Walmart Inc."), ("PG", "Procter & Gamble Co."), ("UNH", "UnitedHealth Group"),
            ("HD", "The Home Depot Inc."), ("BAC", "Bank of America Corp."), ("DIS", "The Walt Disney Company"), ("KO", "The Coca-Cola Company"),
            ("PEP", "PepsiCo Inc."), ("XOM", "Exxon Mobil Corporation"), ("CVX", "Chevron Corporation"), ("NKE", "Nike Inc."),
            ("MCD", "McDonald's Corporation"), ("COST", "Costco Wholesale Corp."), ("BA", "The Boeing Company"), ("GS", "Goldman Sachs Group"),
            ("MS", "Morgan Stanley"), ("GE", "GE Aerospace"), ("C", "Citigroup Inc."), ("WFC", "Wells Fargo & Co."), ("CAT", "Caterpillar Inc."),
            ("IBM", "IBM Corporation"), ("MMM", "3M Company"), ("VZ", "Verizon Communications"), ("T", "AT&T Inc."), ("HON", "Honeywell International"),
            ("UPS", "United Parcel Service"), ("FDX", "FedEx Corporation"), ("TXN", "Texas Instruments"), ("LMT", "Lockheed Martin"),
            ("RTX", "RTX Corporation"), ("F", "Ford Motor Company"), ("GM", "General Motors"), ("SBUX", "Starbucks Corporation"),
            ("LOW", "Lowe's Companies"), ("TGT", "Target Corporation"), ("CVS", "CVS Health Corporation"), ("PFE", "Pfizer Inc."),
            ("MRK", "Merck & Co."), ("ABBV", "AbbVie Inc."), ("LLY", "Eli Lilly and Company"), ("ARM", "Arm Holdings"),
            ("SMCI", "Super Micro Computer"), ("MU", "Micron Technology"), ("ASML", "ASML Holding NV"), ("TSM", "Taiwan Semiconductor"),
            ("MRVL", "Marvell Technology"), ("BABA", "Alibaba Group"), ("JD", "JD.com Inc."), ("PDD", "PDD Holdings"),
            ("BIDU", "Baidu Inc."), ("NIO", "NIO Inc."), ("LI", "Li Auto Inc."), ("XPEV", "XPeng Inc."), ("SE", "Sea Limited"),
            ("GRAB", "Grab Holdings"), ("SPY", "SPDR S&P 500 ETF"), ("QQQ", "Invesco QQQ Trust"), ("VOO", "Vanguard S&P 500 ETF"),
            ("VTI", "Vanguard Total Stock Market ETF"), ("ARKK", "ARK Innovation ETF"), ("IWM", "iShares Russell 2000 ETF"),
            ("DIA", "SPDR Dow Jones Industrial ETF"), ("SOXX", "iShares Semiconductor ETF"), ("XLF", "Financial Select Sector SPDR"),
            ("XLE", "Energy Select Sector SPDR")
        ].into_iter().map(|(s, n)| Symbol {
            id: String::new(), symbol: s.to_string(), name: n.to_string(), asset_type: "foreign_stock".to_string(),
            market: Some("US".to_string()), category: None, sector: None, icon_url: None,
        }).collect()
    }

    fn get_static_tfex() -> Vec<Symbol> {
         vec![
            ("S50H24", "SET50 Index Futures Mar 2024", "Index Futures"), ("S50M24", "SET50 Index Futures Jun 2024", "Index Futures"),
            ("S50U24", "SET50 Index Futures Sep 2024", "Index Futures"), ("S50Z24", "SET50 Index Futures Dec 2024", "Index Futures"),
            ("S50H25", "SET50 Index Futures Mar 2025", "Index Futures"), ("S50M25", "SET50 Index Futures Jun 2025", "Index Futures"),
            ("S50U25", "SET50 Index Futures Sep 2025", "Index Futures"), ("S50Z25", "SET50 Index Futures Dec 2025", "Index Futures"),
            ("S50H26", "SET50 Index Futures Mar 2026", "Index Futures"), ("S50M26", "SET50 Index Futures Jun 2026", "Index Futures"),
            ("GFH24", "Gold Futures Mar 2024", "Gold Futures"), ("GFM24", "Gold Futures Jun 2024", "Gold Futures"), ("GFU24", "Gold Futures Sep 2024", "Gold Futures"),
            ("GFZ24", "Gold Futures Dec 2024", "Gold Futures"), ("GFH25", "Gold Futures Mar 2025", "Gold Futures"), ("GFM25", "Gold Futures Jun 2025", "Gold Futures"),
            ("GFU25", "Gold Futures Sep 2025", "Gold Futures"), ("GFZ25", "Gold Futures Dec 2025", "Gold Futures"), ("GFH26", "Gold Futures Mar 2026", "Gold Futures"),
            ("GFM26", "Gold Futures Jun 2026", "Gold Futures"),
            ("GDH24", "Gold-D Mar 2024", "Gold-D"), ("GDM24", "Gold-D Jun 2024", "Gold-D"), ("GDU24", "Gold-D Sep 2024", "Gold-D"), ("GDZ24", "Gold-D Dec 2024", "Gold-D"),
            ("GDH25", "Gold-D Mar 2025", "Gold-D"), ("GDM25", "Gold-D Jun 2025", "Gold-D"), ("GDU25", "Gold-D Sep 2025", "Gold-D"), ("GDZ25", "Gold-D Dec 2025", "Gold-D"),
            ("GDH26", "Gold-D Mar 2026", "Gold-D"), ("GDM26", "Gold-D Jun 2026", "Gold-D"),
            ("SVH24", "Silver Futures Mar 2024", "Silver Futures"), ("SVM24", "Silver Futures Jun 2024", "Silver Futures"),
            ("SVU24", "Silver Futures Sep 2024", "Silver Futures"), ("SVZ24", "Silver Futures Dec 2024", "Silver Futures"),
            ("SVH25", "Silver Futures Mar 2025", "Silver Futures"), ("SVM25", "Silver Futures Jun 2025", "Silver Futures"),
            ("SVU25", "Silver Futures Sep 2025", "Silver Futures"), ("SVZ25", "Silver Futures Dec 2025", "Silver Futures"),
            ("SVH26", "Silver Futures Mar 2026", "Silver Futures"), ("SVM26", "Silver Futures Jun 2026", "Silver Futures"),
            ("SVU26", "Silver Futures Sep 2026", "Silver Futures"), ("SVZ26", "Silver Futures Dec 2026", "Silver Futures"),
            ("SVFH26", "Silver Futures H26", "Silver Futures"), ("SVFM26", "Silver Futures M26", "Silver Futures"),
            ("SVFU26", "Silver Futures U26", "Silver Futures"), ("SVFZ26", "Silver Futures Z26", "Silver Futures"),
            ("USDH24", "USD Futures Mar 2024", "Currency Futures"), ("USDM24", "USD Futures Jun 2024", "Currency Futures"),
            ("USDU24", "USD Futures Sep 2024", "Currency Futures"), ("USDZ24", "USD Futures Dec 2024", "Currency Futures"),
            ("USDH25", "USD Futures Mar 2025", "Currency Futures"), ("USDM25", "USD Futures Jun 2025", "Currency Futures"),
            ("USDU25", "USD Futures Sep 2025", "Currency Futures"), ("USDZ25", "USD Futures Dec 2025", "Currency Futures"),
            ("USDH26", "USD Futures Mar 2026", "Currency Futures"), ("USDM26", "USD Futures Jun 2026", "Currency Futures")
         ].into_iter().map(|(s, n, c)| Symbol {
            id: String::new(), symbol: s.to_string(), name: n.to_string(), asset_type: "tfex".to_string(),
            market: None, category: Some(c.to_string()), sector: None, icon_url: None,
        }).collect()
    }
}
