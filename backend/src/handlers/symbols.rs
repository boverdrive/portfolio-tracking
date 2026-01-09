//! Symbols handler for stock symbol lookups and autocomplete

use axum::{Json, extract::{Query, State}};
use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::services::symbols::Symbol;

/// Thai stock symbol with name
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StockSymbol {
    pub symbol: String,
    pub name: String,
    pub market: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub limit: Option<usize>,
    pub market: Option<String>,
}

/// Get Thai stock symbols for autocomplete
pub async fn get_thai_stocks(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Json<Vec<StockSymbol>> {
    let limit = query.limit.unwrap_or(20);
    
    // Try PocketBase first
    let pb_symbols = state.symbols_service.get_by_asset_type(
        "stock", 
        query.q.as_deref(), 
        query.market.as_deref(), 
        limit
    ).await;
    
    if !pb_symbols.is_empty() {
        let symbols: Vec<StockSymbol> = pb_symbols.into_iter().map(|s| StockSymbol {
            symbol: s.symbol,
            name: s.name,
            market: s.market.unwrap_or_else(|| "SET".to_string()),
            icon_url: s.icon_url,
        }).collect();
        return Json(symbols);
    }
    
    // Fallback to static list
    let stocks = get_thai_stock_list();
    
    let filtered: Vec<StockSymbol> = match &query.q {
        Some(q) if !q.is_empty() => {
            let search = q.to_uppercase();
            stocks
                .into_iter()
                .filter(|s| s.symbol.contains(&search) || s.name.to_uppercase().contains(&search))
                .take(limit)
                .collect()
        }
        _ => stocks.into_iter().take(query.limit.unwrap_or(50)).collect(),
    };
    
    Json(filtered)
}

/// Static list of popular Thai stocks on SET
fn get_thai_stock_list() -> Vec<StockSymbol> {
    // Helper to create stock with default icon_url
    fn stock(symbol: &str, name: &str, market: &str) -> StockSymbol {
        StockSymbol { symbol: symbol.to_string(), name: name.to_string(), market: market.to_string(), icon_url: None }
    }
    
    vec![
        // Energy & Utilities
        stock("PTT", "PTT Public Company Limited", "SET"),
        stock("PTTEP", "PTT Exploration and Production", "SET"),
        stock("PTTGC", "PTT Global Chemical", "SET"),
        stock("GPSC", "Global Power Synergy", "SET"),
        stock("GULF", "Gulf Energy Development", "SET"),
        stock("BGRIM", "B.Grimm Power", "SET"),
        stock("BANPU", "Banpu Public Company", "SET"),
        stock("EGCO", "Electricity Generating", "SET"),
        stock("RATCH", "Ratch Group", "SET"),
        stock("EA", "Energy Absolute", "SET"),
        
        // Banks
        stock("SCB", "SCB X Public Company", "SET"),
        stock("KBANK", "Kasikornbank", "SET"),
        stock("BBL", "Bangkok Bank", "SET"),
        stock("KTB", "Krungthai Bank", "SET"),
        stock("TTB", "TMBThanachart Bank", "SET"),
        stock("TISCO", "TISCO Financial Group", "SET"),
        stock("KKP", "Kiatnakin Phatra Bank", "SET"),
        
        // Technology & Telecom
        stock("ADVANC", "Advanced Info Service", "SET"),
        stock("TRUE", "True Corporation", "SET"),
        stock("INTUCH", "Intouch Holdings", "SET"),
        stock("DELTA", "Delta Electronics Thailand", "SET"),
        stock("HANA", "Hana Microelectronics", "SET"),
        stock("JTS", "Jasmine Technology Solution", "SET"),
        
        // Healthcare
        stock("BDMS", "Bangkok Dusit Medical Services", "SET"),
        stock("BH", "Bumrungrad Hospital", "SET"),
        stock("BCH", "Bangkok Chain Hospital", "SET"),
        stock("CHG", "Chularat Hospital Group", "SET"),
        stock("PR9", "Praram 9 Hospital", "SET"),
        
        // Real Estate & Construction
        stock("CPN", "Central Pattana", "SET"),
        stock("LH", "Land and Houses", "SET"),
        stock("AP", "AP Thailand", "SET"),
        stock("SPALI", "Supalai", "SET"),
        stock("PSH", "Pruksa Holding", "SET"),
        stock("SC", "SC Asset Corporation", "SET"),
        stock("ORI", "Origin Property", "SET"),
        stock("SIRI", "Sansiri", "SET"),
        stock("WHA", "WHA Corporation", "SET"),
        stock("SCC", "Siam Cement Group", "SET"),
        
        // Consumer
        stock("CPALL", "CP ALL", "SET"),
        stock("CPF", "Charoen Pokphand Foods", "SET"),
        stock("MAKRO", "Siam Makro", "SET"),
        stock("BJC", "Berli Jucker", "SET"),
        stock("HMPRO", "Home Product Center", "SET"),
        stock("GLOBAL", "Siam Global House", "SET"),
        stock("BEAUTY", "Beauty Community", "SET"),
        stock("COM7", "Com7", "SET"),
        
        // Food & Beverage
        stock("MINT", "Minor International", "SET"),
        stock("BCP", "Bangchak Corporation", "SET"),
        stock("TU", "Thai Union Group", "SET"),
        stock("CBG", "Carabao Group", "SET"),
        stock("OSP", "Osotspa", "SET"),
        
        // Transportation & Logistics
        stock("AOT", "Airports of Thailand", "SET"),
        stock("BEM", "Bangkok Expressway and Metro", "SET"),
        stock("BTS", "BTS Group Holdings", "SET"),
        stock("AAV", "Asia Aviation", "SET"),
        
        // Industrial
        stock("IVL", "Indorama Ventures", "SET"),
        stock("IRPC", "IRPC", "SET"),
        stock("TOP", "Thai Oil", "SET"),
        stock("SCGP", "SCG Packaging", "SET"),
        
        // Insurance
        stock("BLA", "Bangkok Life Assurance", "SET"),
        stock("TLI", "Thai Life Insurance", "SET"),
        stock("TIPH", "Dhipaya Group Holdings", "SET"),
        
        // Media & Entertainment
        stock("MAJOR", "Major Cineplex Group", "SET"),
        stock("VGI", "VGI", "SET"),
        stock("PLANB", "Plan B Media", "SET"),
        
        // Tourism & Hotels
        stock("CENTEL", "Central Plaza Hotel", "SET"),
        stock("ERW", "The Erawan Group", "SET"),
        stock("AWC", "Asset World Corp", "SET"),
        
        // SET100 additions
        stock("SAWAD", "Srisawad Corporation", "SET"),
        stock("MTC", "Muangthai Capital", "SET"),
        stock("TIDLOR", "Ngern Tid Lor", "SET"),
        stock("KCE", "KCE Electronics", "SET"),
        stock("STGT", "Sri Trang Gloves Thailand", "SET"),
        stock("RS", "RS", "SET"),
        stock("JMT", "JMT Network Services", "SET"),
        stock("STA", "Sri Trang Agro-Industry", "SET"),
        stock("THG", "Thonburi Healthcare Group", "SET"),
        stock("SINGER", "Singer Thailand", "SET"),
        stock("SAPPE", "Sappe", "SET"),
        stock("SABINA", "Sabina", "SET"),
        stock("AMATA", "Amata Corporation", "SET"),
        stock("GUNKUL", "Gunkul Engineering", "SET"),
        stock("MEGA", "Mega Lifesciences", "SET"),
        stock("THANI", "Ratchathani Leasing", "SET"),
        stock("TKN", "Thai Krungthai Capital", "SET"),
        stock("EPG", "Eastern Polymer Group", "SET"),
        stock("BPP", "Banpu Power", "SET"),
        stock("STARK", "Stark Corporation", "SET"),
    ]
}

/// TFEX symbol with details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TfexSymbol {
    pub symbol: String,
    pub name: String,
    pub underlying: String,
    pub contract_type: String,
}

/// Get TFEX symbols for autocomplete
pub async fn get_tfex_symbols(
    Query(query): Query<SearchQuery>,
) -> Json<Vec<TfexSymbol>> {
    let symbols = get_tfex_symbol_list();
    
    let filtered: Vec<TfexSymbol> = match &query.q {
        Some(q) if !q.is_empty() => {
            let search = q.to_uppercase();
            symbols
                .into_iter()
                .filter(|s| s.symbol.contains(&search) || s.name.to_uppercase().contains(&search))
                .take(query.limit.unwrap_or(20))
                .collect()
        }
        _ => symbols.into_iter().take(query.limit.unwrap_or(50)).collect(),
    };
    
    Json(filtered)
}

/// Static list of TFEX derivatives
fn get_tfex_symbol_list() -> Vec<TfexSymbol> {
    vec![
        // SET50 Index Futures - Current and nearby contract months
        TfexSymbol { symbol: "S50H24".to_string(), name: "SET50 Index Futures Mar 2024".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        TfexSymbol { symbol: "S50M24".to_string(), name: "SET50 Index Futures Jun 2024".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        TfexSymbol { symbol: "S50U24".to_string(), name: "SET50 Index Futures Sep 2024".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        TfexSymbol { symbol: "S50Z24".to_string(), name: "SET50 Index Futures Dec 2024".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        TfexSymbol { symbol: "S50H25".to_string(), name: "SET50 Index Futures Mar 2025".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        TfexSymbol { symbol: "S50M25".to_string(), name: "SET50 Index Futures Jun 2025".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        TfexSymbol { symbol: "S50U25".to_string(), name: "SET50 Index Futures Sep 2025".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        TfexSymbol { symbol: "S50Z25".to_string(), name: "SET50 Index Futures Dec 2025".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        TfexSymbol { symbol: "S50H26".to_string(), name: "SET50 Index Futures Mar 2026".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        TfexSymbol { symbol: "S50M26".to_string(), name: "SET50 Index Futures Jun 2026".to_string(), underlying: "SET50".to_string(), contract_type: "Index Futures".to_string() },
        
        // Gold Futures (10 Baht Gold)
        TfexSymbol { symbol: "GFH24".to_string(), name: "Gold Futures Mar 2024".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        TfexSymbol { symbol: "GFM24".to_string(), name: "Gold Futures Jun 2024".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        TfexSymbol { symbol: "GFU24".to_string(), name: "Gold Futures Sep 2024".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        TfexSymbol { symbol: "GFZ24".to_string(), name: "Gold Futures Dec 2024".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        TfexSymbol { symbol: "GFH25".to_string(), name: "Gold Futures Mar 2025".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        TfexSymbol { symbol: "GFM25".to_string(), name: "Gold Futures Jun 2025".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        TfexSymbol { symbol: "GFU25".to_string(), name: "Gold Futures Sep 2025".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        TfexSymbol { symbol: "GFZ25".to_string(), name: "Gold Futures Dec 2025".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        TfexSymbol { symbol: "GFH26".to_string(), name: "Gold Futures Mar 2026".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        TfexSymbol { symbol: "GFM26".to_string(), name: "Gold Futures Jun 2026".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold Futures".to_string() },
        
        // Gold-D (50 Baht Gold)
        TfexSymbol { symbol: "GDH24".to_string(), name: "Gold-D Mar 2024".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        TfexSymbol { symbol: "GDM24".to_string(), name: "Gold-D Jun 2024".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        TfexSymbol { symbol: "GDU24".to_string(), name: "Gold-D Sep 2024".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        TfexSymbol { symbol: "GDZ24".to_string(), name: "Gold-D Dec 2024".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        TfexSymbol { symbol: "GDH25".to_string(), name: "Gold-D Mar 2025".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        TfexSymbol { symbol: "GDM25".to_string(), name: "Gold-D Jun 2025".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        TfexSymbol { symbol: "GDU25".to_string(), name: "Gold-D Sep 2025".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        TfexSymbol { symbol: "GDZ25".to_string(), name: "Gold-D Dec 2025".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        TfexSymbol { symbol: "GDH26".to_string(), name: "Gold-D Mar 2026".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        TfexSymbol { symbol: "GDM26".to_string(), name: "Gold-D Jun 2026".to_string(), underlying: "Gold 96.5%".to_string(), contract_type: "Gold-D".to_string() },
        
        // Silver Futures
        TfexSymbol { symbol: "SVH24".to_string(), name: "Silver Futures Mar 2024".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVM24".to_string(), name: "Silver Futures Jun 2024".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVU24".to_string(), name: "Silver Futures Sep 2024".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVZ24".to_string(), name: "Silver Futures Dec 2024".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVH25".to_string(), name: "Silver Futures Mar 2025".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVM25".to_string(), name: "Silver Futures Jun 2025".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVU25".to_string(), name: "Silver Futures Sep 2025".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVZ25".to_string(), name: "Silver Futures Dec 2025".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVH26".to_string(), name: "Silver Futures Mar 2026".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVM26".to_string(), name: "Silver Futures Jun 2026".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVU26".to_string(), name: "Silver Futures Sep 2026".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVZ26".to_string(), name: "Silver Futures Dec 2026".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVFH26".to_string(), name: "Silver Futures H26".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVFM26".to_string(), name: "Silver Futures M26".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVFU26".to_string(), name: "Silver Futures U26".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        TfexSymbol { symbol: "SVFZ26".to_string(), name: "Silver Futures Z26".to_string(), underlying: "Silver".to_string(), contract_type: "Silver Futures".to_string() },
        
        // USD Futures
        TfexSymbol { symbol: "USDH24".to_string(), name: "USD Futures Mar 2024".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        TfexSymbol { symbol: "USDM24".to_string(), name: "USD Futures Jun 2024".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        TfexSymbol { symbol: "USDU24".to_string(), name: "USD Futures Sep 2024".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        TfexSymbol { symbol: "USDZ24".to_string(), name: "USD Futures Dec 2024".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        TfexSymbol { symbol: "USDH25".to_string(), name: "USD Futures Mar 2025".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        TfexSymbol { symbol: "USDM25".to_string(), name: "USD Futures Jun 2025".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        TfexSymbol { symbol: "USDU25".to_string(), name: "USD Futures Sep 2025".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        TfexSymbol { symbol: "USDZ25".to_string(), name: "USD Futures Dec 2025".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        TfexSymbol { symbol: "USDH26".to_string(), name: "USD Futures Mar 2026".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        TfexSymbol { symbol: "USDM26".to_string(), name: "USD Futures Jun 2026".to_string(), underlying: "USD/THB".to_string(), contract_type: "Currency Futures".to_string() },
        
        // Sector Index Futures
        TfexSymbol { symbol: "BANKH24".to_string(), name: "Bank Sector Futures Mar 2024".to_string(), underlying: "Bank Index".to_string(), contract_type: "Sector Futures".to_string() },
        TfexSymbol { symbol: "BANKM24".to_string(), name: "Bank Sector Futures Jun 2024".to_string(), underlying: "Bank Index".to_string(), contract_type: "Sector Futures".to_string() },
        TfexSymbol { symbol: "ENRGH24".to_string(), name: "Energy Sector Futures Mar 2024".to_string(), underlying: "Energy Index".to_string(), contract_type: "Sector Futures".to_string() },
        TfexSymbol { symbol: "ENRGM24".to_string(), name: "Energy Sector Futures Jun 2024".to_string(), underlying: "Energy Index".to_string(), contract_type: "Sector Futures".to_string() },
        
        // Single Stock Futures - Popular stocks
        TfexSymbol { symbol: "PTTH24".to_string(), name: "PTT Single Stock Futures Mar 2024".to_string(), underlying: "PTT".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "PTTM24".to_string(), name: "PTT Single Stock Futures Jun 2024".to_string(), underlying: "PTT".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "AOTH24".to_string(), name: "AOT Single Stock Futures Mar 2024".to_string(), underlying: "AOT".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "AOTM24".to_string(), name: "AOT Single Stock Futures Jun 2024".to_string(), underlying: "AOT".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "CPALLH24".to_string(), name: "CPALL Single Stock Futures Mar 2024".to_string(), underlying: "CPALL".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "CPALLM24".to_string(), name: "CPALL Single Stock Futures Jun 2024".to_string(), underlying: "CPALL".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "DELTAH24".to_string(), name: "DELTA Single Stock Futures Mar 2024".to_string(), underlying: "DELTA".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "DELTAM24".to_string(), name: "DELTA Single Stock Futures Jun 2024".to_string(), underlying: "DELTA".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "ADVH24".to_string(), name: "ADVANC Single Stock Futures Mar 2024".to_string(), underlying: "ADVANC".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "ADVM24".to_string(), name: "ADVANC Single Stock Futures Jun 2024".to_string(), underlying: "ADVANC".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "SCBH24".to_string(), name: "SCB Single Stock Futures Mar 2024".to_string(), underlying: "SCB".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "SCBM24".to_string(), name: "SCB Single Stock Futures Jun 2024".to_string(), underlying: "SCB".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "KBANKH24".to_string(), name: "KBANK Single Stock Futures Mar 2024".to_string(), underlying: "KBANK".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "KBANKM24".to_string(), name: "KBANK Single Stock Futures Jun 2024".to_string(), underlying: "KBANK".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "GULFH24".to_string(), name: "GULF Single Stock Futures Mar 2024".to_string(), underlying: "GULF".to_string(), contract_type: "SSF".to_string() },
        TfexSymbol { symbol: "GULFM24".to_string(), name: "GULF Single Stock Futures Jun 2024".to_string(), underlying: "GULF".to_string(), contract_type: "SSF".to_string() },
        
        // Crude Oil Futures (Brent)
        TfexSymbol { symbol: "BRNH24".to_string(), name: "Brent Crude Oil Futures Mar 2024".to_string(), underlying: "Brent Crude".to_string(), contract_type: "Oil Futures".to_string() },
        TfexSymbol { symbol: "BRNM24".to_string(), name: "Brent Crude Oil Futures Jun 2024".to_string(), underlying: "Brent Crude".to_string(), contract_type: "Oil Futures".to_string() },
        TfexSymbol { symbol: "BRNU24".to_string(), name: "Brent Crude Oil Futures Sep 2024".to_string(), underlying: "Brent Crude".to_string(), contract_type: "Oil Futures".to_string() },
        TfexSymbol { symbol: "BRNZ24".to_string(), name: "Brent Crude Oil Futures Dec 2024".to_string(), underlying: "Brent Crude".to_string(), contract_type: "Oil Futures".to_string() },
        TfexSymbol { symbol: "BRNH25".to_string(), name: "Brent Crude Oil Futures Mar 2025".to_string(), underlying: "Brent Crude".to_string(), contract_type: "Oil Futures".to_string() },
        TfexSymbol { symbol: "BRNM25".to_string(), name: "Brent Crude Oil Futures Jun 2025".to_string(), underlying: "Brent Crude".to_string(), contract_type: "Oil Futures".to_string() },
        TfexSymbol { symbol: "BRNH26".to_string(), name: "Brent Crude Oil Futures Mar 2026".to_string(), underlying: "Brent Crude".to_string(), contract_type: "Oil Futures".to_string() },
        TfexSymbol { symbol: "BRNM26".to_string(), name: "Brent Crude Oil Futures Jun 2026".to_string(), underlying: "Brent Crude".to_string(), contract_type: "Oil Futures".to_string() },
        
        // Rubber Futures
        TfexSymbol { symbol: "TSRH24".to_string(), name: "RSS3 Rubber Futures Mar 2024".to_string(), underlying: "RSS3 Rubber".to_string(), contract_type: "Rubber Futures".to_string() },
        TfexSymbol { symbol: "TSRM24".to_string(), name: "RSS3 Rubber Futures Jun 2024".to_string(), underlying: "RSS3 Rubber".to_string(), contract_type: "Rubber Futures".to_string() },
        TfexSymbol { symbol: "TSRU24".to_string(), name: "RSS3 Rubber Futures Sep 2024".to_string(), underlying: "RSS3 Rubber".to_string(), contract_type: "Rubber Futures".to_string() },
        TfexSymbol { symbol: "TSRZ24".to_string(), name: "RSS3 Rubber Futures Dec 2024".to_string(), underlying: "RSS3 Rubber".to_string(), contract_type: "Rubber Futures".to_string() },
        TfexSymbol { symbol: "TSRH25".to_string(), name: "RSS3 Rubber Futures Mar 2025".to_string(), underlying: "RSS3 Rubber".to_string(), contract_type: "Rubber Futures".to_string() },
        TfexSymbol { symbol: "TSRM25".to_string(), name: "RSS3 Rubber Futures Jun 2025".to_string(), underlying: "RSS3 Rubber".to_string(), contract_type: "Rubber Futures".to_string() },
    ]
}

/// Crypto symbol with name for autocomplete
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoSymbol {
    pub symbol: String,
    pub name: String,
    pub category: String,
}

/// Get crypto symbols for autocomplete
pub async fn get_crypto_symbols(
    Query(query): Query<SearchQuery>,
) -> Json<Vec<CryptoSymbol>> {
    let cryptos = get_crypto_list();
    
    let filtered: Vec<CryptoSymbol> = match &query.q {
        Some(q) if !q.is_empty() => {
            let search = q.to_uppercase();
            cryptos
                .into_iter()
                .filter(|c| c.symbol.contains(&search) || c.name.to_uppercase().contains(&search))
                .take(query.limit.unwrap_or(20))
                .collect()
        }
        _ => cryptos.into_iter().take(query.limit.unwrap_or(50)).collect(),
    };
    
    Json(filtered)
}

/// Static list of popular cryptocurrencies
fn get_crypto_list() -> Vec<CryptoSymbol> {
    vec![
        // Top Cryptocurrencies by Market Cap
        CryptoSymbol { symbol: "BTC".to_string(), name: "Bitcoin".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "ETH".to_string(), name: "Ethereum".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "BNB".to_string(), name: "Binance Coin".to_string(), category: "Exchange".to_string() },
        CryptoSymbol { symbol: "XRP".to_string(), name: "Ripple".to_string(), category: "Payment".to_string() },
        CryptoSymbol { symbol: "SOL".to_string(), name: "Solana".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "ADA".to_string(), name: "Cardano".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "DOGE".to_string(), name: "Dogecoin".to_string(), category: "Meme".to_string() },
        CryptoSymbol { symbol: "TRX".to_string(), name: "TRON".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "TON".to_string(), name: "Toncoin".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "DOT".to_string(), name: "Polkadot".to_string(), category: "Layer 0".to_string() },
        CryptoSymbol { symbol: "MATIC".to_string(), name: "Polygon".to_string(), category: "Layer 2".to_string() },
        CryptoSymbol { symbol: "LTC".to_string(), name: "Litecoin".to_string(), category: "Payment".to_string() },
        CryptoSymbol { symbol: "SHIB".to_string(), name: "Shiba Inu".to_string(), category: "Meme".to_string() },
        CryptoSymbol { symbol: "BCH".to_string(), name: "Bitcoin Cash".to_string(), category: "Payment".to_string() },
        CryptoSymbol { symbol: "AVAX".to_string(), name: "Avalanche".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "LINK".to_string(), name: "Chainlink".to_string(), category: "Oracle".to_string() },
        CryptoSymbol { symbol: "XLM".to_string(), name: "Stellar".to_string(), category: "Payment".to_string() },
        CryptoSymbol { symbol: "UNI".to_string(), name: "Uniswap".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "ATOM".to_string(), name: "Cosmos".to_string(), category: "Layer 0".to_string() },
        CryptoSymbol { symbol: "XMR".to_string(), name: "Monero".to_string(), category: "Privacy".to_string() },
        CryptoSymbol { symbol: "ETC".to_string(), name: "Ethereum Classic".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "HBAR".to_string(), name: "Hedera".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "FIL".to_string(), name: "Filecoin".to_string(), category: "Storage".to_string() },
        CryptoSymbol { symbol: "APT".to_string(), name: "Aptos".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "ARB".to_string(), name: "Arbitrum".to_string(), category: "Layer 2".to_string() },
        CryptoSymbol { symbol: "OP".to_string(), name: "Optimism".to_string(), category: "Layer 2".to_string() },
        CryptoSymbol { symbol: "NEAR".to_string(), name: "NEAR Protocol".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "VET".to_string(), name: "VeChain".to_string(), category: "Supply Chain".to_string() },
        CryptoSymbol { symbol: "ICP".to_string(), name: "Internet Computer".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "INJ".to_string(), name: "Injective".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "AAVE".to_string(), name: "Aave".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "MKR".to_string(), name: "Maker".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "ALGO".to_string(), name: "Algorand".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "GRT".to_string(), name: "The Graph".to_string(), category: "Infrastructure".to_string() },
        CryptoSymbol { symbol: "FTM".to_string(), name: "Fantom".to_string(), category: "Layer 1".to_string() },
        CryptoSymbol { symbol: "SAND".to_string(), name: "The Sandbox".to_string(), category: "Metaverse".to_string() },
        CryptoSymbol { symbol: "MANA".to_string(), name: "Decentraland".to_string(), category: "Metaverse".to_string() },
        CryptoSymbol { symbol: "AXS".to_string(), name: "Axie Infinity".to_string(), category: "Gaming".to_string() },
        CryptoSymbol { symbol: "GALA".to_string(), name: "Gala".to_string(), category: "Gaming".to_string() },
        CryptoSymbol { symbol: "IMX".to_string(), name: "Immutable X".to_string(), category: "Gaming".to_string() },
        CryptoSymbol { symbol: "CRV".to_string(), name: "Curve DAO".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "LDO".to_string(), name: "Lido DAO".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "SNX".to_string(), name: "Synthetix".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "COMP".to_string(), name: "Compound".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "SUSHI".to_string(), name: "SushiSwap".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "1INCH".to_string(), name: "1inch".to_string(), category: "DeFi".to_string() },
        CryptoSymbol { symbol: "PEPE".to_string(), name: "Pepe".to_string(), category: "Meme".to_string() },
        CryptoSymbol { symbol: "FLOKI".to_string(), name: "Floki".to_string(), category: "Meme".to_string() },
        CryptoSymbol { symbol: "WIF".to_string(), name: "dogwifhat".to_string(), category: "Meme".to_string() },
        CryptoSymbol { symbol: "BONK".to_string(), name: "Bonk".to_string(), category: "Meme".to_string() },
        CryptoSymbol { symbol: "XAG".to_string(), name: "Silver".to_string(), category: "Commodity".to_string() },
        CryptoSymbol { symbol: "XAU".to_string(), name: "Gold".to_string(), category: "Commodity".to_string() },
        // Stablecoins
        CryptoSymbol { symbol: "USDT".to_string(), name: "Tether".to_string(), category: "Stablecoin".to_string() },
        CryptoSymbol { symbol: "USDC".to_string(), name: "USD Coin".to_string(), category: "Stablecoin".to_string() },
        CryptoSymbol { symbol: "DAI".to_string(), name: "Dai".to_string(), category: "Stablecoin".to_string() },
        CryptoSymbol { symbol: "BUSD".to_string(), name: "Binance USD".to_string(), category: "Stablecoin".to_string() },
        // AI & Data
        CryptoSymbol { symbol: "RNDR".to_string(), name: "Render".to_string(), category: "AI".to_string() },
        CryptoSymbol { symbol: "FET".to_string(), name: "Fetch.ai".to_string(), category: "AI".to_string() },
        CryptoSymbol { symbol: "OCEAN".to_string(), name: "Ocean Protocol".to_string(), category: "AI".to_string() },
        CryptoSymbol { symbol: "AGIX".to_string(), name: "SingularityNET".to_string(), category: "AI".to_string() },
        CryptoSymbol { symbol: "TAO".to_string(), name: "Bittensor".to_string(), category: "AI".to_string() },
        // Thai Exchange Popular
        CryptoSymbol { symbol: "KUB".to_string(), name: "Bitkub Coin".to_string(), category: "Exchange".to_string() },
        CryptoSymbol { symbol: "SIX".to_string(), name: "SIX Network".to_string(), category: "Thai".to_string() },
        CryptoSymbol { symbol: "JFIN".to_string(), name: "JFIN Coin".to_string(), category: "Thai".to_string() },
    ]
}

/// Foreign stock symbol with name for autocomplete
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignStockSymbol {
    pub symbol: String,
    pub name: String,
    pub market: String,
    pub sector: String,
}

/// Get foreign stock symbols for autocomplete
pub async fn get_foreign_stocks(
    Query(query): Query<SearchQuery>,
) -> Json<Vec<ForeignStockSymbol>> {
    let stocks = get_foreign_stock_list();
    
    // First filter by market if provided
    let market_filtered: Vec<ForeignStockSymbol> = match &query.market {
        Some(m) if !m.is_empty() => {
            let market_upper = m.to_uppercase();
            stocks
                .into_iter()
                .filter(|s| s.market.to_uppercase() == market_upper)
                .collect()
        }
        _ => stocks,
    };
    
    // Then filter by search query
    let filtered: Vec<ForeignStockSymbol> = match &query.q {
        Some(q) if !q.is_empty() => {
            let search = q.to_uppercase();
            market_filtered
                .into_iter()
                .filter(|s| s.symbol.contains(&search) || s.name.to_uppercase().contains(&search))
                .take(query.limit.unwrap_or(20))
                .collect()
        }
        _ => market_filtered.into_iter().take(query.limit.unwrap_or(50)).collect(),
    };
    
    Json(filtered)
}

/// Static list of popular foreign stocks
fn get_foreign_stock_list() -> Vec<ForeignStockSymbol> {
    vec![
        // US Tech Giants - NASDAQ
        ForeignStockSymbol { symbol: "AAPL".to_string(), name: "Apple Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "MSFT".to_string(), name: "Microsoft Corporation".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "GOOGL".to_string(), name: "Alphabet Inc. Class A".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "GOOG".to_string(), name: "Alphabet Inc. Class C".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "AMZN".to_string(), name: "Amazon.com Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Consumer".to_string() },
        ForeignStockSymbol { symbol: "META".to_string(), name: "Meta Platforms Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "NVDA".to_string(), name: "NVIDIA Corporation".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "TSLA".to_string(), name: "Tesla Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Automotive".to_string() },
        ForeignStockSymbol { symbol: "AMD".to_string(), name: "Advanced Micro Devices".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "INTC".to_string(), name: "Intel Corporation".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "NFLX".to_string(), name: "Netflix Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Entertainment".to_string() },
        ForeignStockSymbol { symbol: "AVGO".to_string(), name: "Broadcom Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "ADBE".to_string(), name: "Adobe Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "CRM".to_string(), name: "Salesforce Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "CSCO".to_string(), name: "Cisco Systems Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "ORCL".to_string(), name: "Oracle Corporation".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "QCOM".to_string(), name: "Qualcomm Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "PYPL".to_string(), name: "PayPal Holdings Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Fintech".to_string() },
        ForeignStockSymbol { symbol: "COIN".to_string(), name: "Coinbase Global Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Fintech".to_string() },
        ForeignStockSymbol { symbol: "UBER".to_string(), name: "Uber Technologies Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "ABNB".to_string(), name: "Airbnb Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Travel".to_string() },
        ForeignStockSymbol { symbol: "SQ".to_string(), name: "Block Inc.".to_string(), market: "NYSE".to_string(), sector: "Fintech".to_string() },
        ForeignStockSymbol { symbol: "SHOP".to_string(), name: "Shopify Inc.".to_string(), market: "NASDAQ".to_string(), sector: "E-commerce".to_string() },
        ForeignStockSymbol { symbol: "ZM".to_string(), name: "Zoom Video Communications".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "PLTR".to_string(), name: "Palantir Technologies".to_string(), market: "NYSE".to_string(), sector: "Technology".to_string() },
        // US Blue Chips - NYSE
        ForeignStockSymbol { symbol: "JPM".to_string(), name: "JPMorgan Chase & Co.".to_string(), market: "NYSE".to_string(), sector: "Financial".to_string() },
        ForeignStockSymbol { symbol: "V".to_string(), name: "Visa Inc.".to_string(), market: "NYSE".to_string(), sector: "Financial".to_string() },
        ForeignStockSymbol { symbol: "MA".to_string(), name: "Mastercard Inc.".to_string(), market: "NYSE".to_string(), sector: "Financial".to_string() },
        ForeignStockSymbol { symbol: "JNJ".to_string(), name: "Johnson & Johnson".to_string(), market: "NYSE".to_string(), sector: "Healthcare".to_string() },
        ForeignStockSymbol { symbol: "WMT".to_string(), name: "Walmart Inc.".to_string(), market: "NYSE".to_string(), sector: "Retail".to_string() },
        ForeignStockSymbol { symbol: "PG".to_string(), name: "Procter & Gamble Co.".to_string(), market: "NYSE".to_string(), sector: "Consumer".to_string() },
        ForeignStockSymbol { symbol: "UNH".to_string(), name: "UnitedHealth Group".to_string(), market: "NYSE".to_string(), sector: "Healthcare".to_string() },
        ForeignStockSymbol { symbol: "HD".to_string(), name: "The Home Depot Inc.".to_string(), market: "NYSE".to_string(), sector: "Retail".to_string() },
        ForeignStockSymbol { symbol: "BAC".to_string(), name: "Bank of America Corp.".to_string(), market: "NYSE".to_string(), sector: "Financial".to_string() },
        ForeignStockSymbol { symbol: "DIS".to_string(), name: "The Walt Disney Company".to_string(), market: "NYSE".to_string(), sector: "Entertainment".to_string() },
        ForeignStockSymbol { symbol: "KO".to_string(), name: "The Coca-Cola Company".to_string(), market: "NYSE".to_string(), sector: "Consumer".to_string() },
        ForeignStockSymbol { symbol: "PEP".to_string(), name: "PepsiCo Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Consumer".to_string() },
        ForeignStockSymbol { symbol: "XOM".to_string(), name: "Exxon Mobil Corporation".to_string(), market: "NYSE".to_string(), sector: "Energy".to_string() },
        ForeignStockSymbol { symbol: "CVX".to_string(), name: "Chevron Corporation".to_string(), market: "NYSE".to_string(), sector: "Energy".to_string() },
        ForeignStockSymbol { symbol: "NKE".to_string(), name: "Nike Inc.".to_string(), market: "NYSE".to_string(), sector: "Consumer".to_string() },
        ForeignStockSymbol { symbol: "MCD".to_string(), name: "McDonald's Corporation".to_string(), market: "NYSE".to_string(), sector: "Consumer".to_string() },
        ForeignStockSymbol { symbol: "COST".to_string(), name: "Costco Wholesale Corp.".to_string(), market: "NASDAQ".to_string(), sector: "Retail".to_string() },
        ForeignStockSymbol { symbol: "BA".to_string(), name: "The Boeing Company".to_string(), market: "NYSE".to_string(), sector: "Aerospace".to_string() },
        ForeignStockSymbol { symbol: "GS".to_string(), name: "Goldman Sachs Group".to_string(), market: "NYSE".to_string(), sector: "Financial".to_string() },
        ForeignStockSymbol { symbol: "MS".to_string(), name: "Morgan Stanley".to_string(), market: "NYSE".to_string(), sector: "Financial".to_string() },
        ForeignStockSymbol { symbol: "GE".to_string(), name: "GE Aerospace".to_string(), market: "NYSE".to_string(), sector: "Aerospace".to_string() },
        ForeignStockSymbol { symbol: "C".to_string(), name: "Citigroup Inc.".to_string(), market: "NYSE".to_string(), sector: "Financial".to_string() },
        ForeignStockSymbol { symbol: "WFC".to_string(), name: "Wells Fargo & Co.".to_string(), market: "NYSE".to_string(), sector: "Financial".to_string() },
        ForeignStockSymbol { symbol: "CAT".to_string(), name: "Caterpillar Inc.".to_string(), market: "NYSE".to_string(), sector: "Industrial".to_string() },
        ForeignStockSymbol { symbol: "IBM".to_string(), name: "IBM Corporation".to_string(), market: "NYSE".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "MMM".to_string(), name: "3M Company".to_string(), market: "NYSE".to_string(), sector: "Industrial".to_string() },
        ForeignStockSymbol { symbol: "VZ".to_string(), name: "Verizon Communications".to_string(), market: "NYSE".to_string(), sector: "Telecom".to_string() },
        ForeignStockSymbol { symbol: "T".to_string(), name: "AT&T Inc.".to_string(), market: "NYSE".to_string(), sector: "Telecom".to_string() },
        ForeignStockSymbol { symbol: "HON".to_string(), name: "Honeywell International".to_string(), market: "NASDAQ".to_string(), sector: "Industrial".to_string() },
        ForeignStockSymbol { symbol: "UPS".to_string(), name: "United Parcel Service".to_string(), market: "NYSE".to_string(), sector: "Logistics".to_string() },
        ForeignStockSymbol { symbol: "FDX".to_string(), name: "FedEx Corporation".to_string(), market: "NYSE".to_string(), sector: "Logistics".to_string() },
        ForeignStockSymbol { symbol: "TXN".to_string(), name: "Texas Instruments".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "LMT".to_string(), name: "Lockheed Martin".to_string(), market: "NYSE".to_string(), sector: "Aerospace".to_string() },
        ForeignStockSymbol { symbol: "RTX".to_string(), name: "RTX Corporation".to_string(), market: "NYSE".to_string(), sector: "Aerospace".to_string() },
        ForeignStockSymbol { symbol: "F".to_string(), name: "Ford Motor Company".to_string(), market: "NYSE".to_string(), sector: "Automotive".to_string() },
        ForeignStockSymbol { symbol: "GM".to_string(), name: "General Motors".to_string(), market: "NYSE".to_string(), sector: "Automotive".to_string() },
        ForeignStockSymbol { symbol: "SBUX".to_string(), name: "Starbucks Corporation".to_string(), market: "NASDAQ".to_string(), sector: "Consumer".to_string() },
        ForeignStockSymbol { symbol: "LOW".to_string(), name: "Lowe's Companies".to_string(), market: "NYSE".to_string(), sector: "Retail".to_string() },
        ForeignStockSymbol { symbol: "TGT".to_string(), name: "Target Corporation".to_string(), market: "NYSE".to_string(), sector: "Retail".to_string() },
        ForeignStockSymbol { symbol: "CVS".to_string(), name: "CVS Health Corporation".to_string(), market: "NYSE".to_string(), sector: "Healthcare".to_string() },
        ForeignStockSymbol { symbol: "PFE".to_string(), name: "Pfizer Inc.".to_string(), market: "NYSE".to_string(), sector: "Healthcare".to_string() },
        ForeignStockSymbol { symbol: "MRK".to_string(), name: "Merck & Co.".to_string(), market: "NYSE".to_string(), sector: "Healthcare".to_string() },
        ForeignStockSymbol { symbol: "ABBV".to_string(), name: "AbbVie Inc.".to_string(), market: "NYSE".to_string(), sector: "Healthcare".to_string() },
        ForeignStockSymbol { symbol: "LLY".to_string(), name: "Eli Lilly and Company".to_string(), market: "NYSE".to_string(), sector: "Healthcare".to_string() },
        // AI & Semiconductors
        ForeignStockSymbol { symbol: "ARM".to_string(), name: "Arm Holdings".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "SMCI".to_string(), name: "Super Micro Computer".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "MU".to_string(), name: "Micron Technology".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "ASML".to_string(), name: "ASML Holding NV".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "TSM".to_string(), name: "Taiwan Semiconductor".to_string(), market: "NYSE".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "MRVL".to_string(), name: "Marvell Technology".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        // Asian Stocks
        ForeignStockSymbol { symbol: "BABA".to_string(), name: "Alibaba Group".to_string(), market: "NYSE".to_string(), sector: "E-commerce".to_string() },
        ForeignStockSymbol { symbol: "JD".to_string(), name: "JD.com Inc.".to_string(), market: "NASDAQ".to_string(), sector: "E-commerce".to_string() },
        ForeignStockSymbol { symbol: "PDD".to_string(), name: "PDD Holdings (Pinduoduo)".to_string(), market: "NASDAQ".to_string(), sector: "E-commerce".to_string() },
        ForeignStockSymbol { symbol: "BIDU".to_string(), name: "Baidu Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        ForeignStockSymbol { symbol: "NIO".to_string(), name: "NIO Inc.".to_string(), market: "NYSE".to_string(), sector: "Automotive".to_string() },
        ForeignStockSymbol { symbol: "LI".to_string(), name: "Li Auto Inc.".to_string(), market: "NASDAQ".to_string(), sector: "Automotive".to_string() },
        ForeignStockSymbol { symbol: "XPEV".to_string(), name: "XPeng Inc.".to_string(), market: "NYSE".to_string(), sector: "Automotive".to_string() },
        ForeignStockSymbol { symbol: "SE".to_string(), name: "Sea Limited".to_string(), market: "NYSE".to_string(), sector: "E-commerce".to_string() },
        ForeignStockSymbol { symbol: "GRAB".to_string(), name: "Grab Holdings".to_string(), market: "NASDAQ".to_string(), sector: "Technology".to_string() },
        // ETFs
        ForeignStockSymbol { symbol: "SPY".to_string(), name: "SPDR S&P 500 ETF".to_string(), market: "NYSE".to_string(), sector: "ETF".to_string() },
        ForeignStockSymbol { symbol: "QQQ".to_string(), name: "Invesco QQQ Trust (NASDAQ-100)".to_string(), market: "NASDAQ".to_string(), sector: "ETF".to_string() },
        ForeignStockSymbol { symbol: "VOO".to_string(), name: "Vanguard S&P 500 ETF".to_string(), market: "NYSE".to_string(), sector: "ETF".to_string() },
        ForeignStockSymbol { symbol: "VTI".to_string(), name: "Vanguard Total Stock Market ETF".to_string(), market: "NYSE".to_string(), sector: "ETF".to_string() },
        ForeignStockSymbol { symbol: "ARKK".to_string(), name: "ARK Innovation ETF".to_string(), market: "NYSE".to_string(), sector: "ETF".to_string() },
        ForeignStockSymbol { symbol: "IWM".to_string(), name: "iShares Russell 2000 ETF".to_string(), market: "NYSE".to_string(), sector: "ETF".to_string() },
        ForeignStockSymbol { symbol: "DIA".to_string(), name: "SPDR Dow Jones Industrial ETF".to_string(), market: "NYSE".to_string(), sector: "ETF".to_string() },
        ForeignStockSymbol { symbol: "SOXX".to_string(), name: "iShares Semiconductor ETF".to_string(), market: "NASDAQ".to_string(), sector: "ETF".to_string() },
        ForeignStockSymbol { symbol: "XLF".to_string(), name: "Financial Select Sector SPDR".to_string(), market: "NYSE".to_string(), sector: "ETF".to_string() },
        ForeignStockSymbol { symbol: "XLE".to_string(), name: "Energy Select Sector SPDR".to_string(), market: "NYSE".to_string(), sector: "ETF".to_string() },
    ]
}

/// Seed symbols response
#[derive(Serialize)]
pub struct SeedResponse {
    pub seeded: usize,
    pub message: String,
}

/// Seed all static symbols to PocketBase
pub async fn seed_symbols(
    State(state): State<AppState>,
) -> Json<SeedResponse> {
    let mut symbols: Vec<Symbol> = Vec::new();
    
    // Add Thai stocks
    for s in get_thai_stock_list() {
        symbols.push(Symbol {
            id: String::new(),
            symbol: s.symbol,
            name: s.name,
            asset_type: "stock".to_string(),
            market: Some(s.market),
            category: None,
            sector: None,
            icon_url: None,
        });
    }
    
    // Add TFEX symbols
    for s in get_tfex_symbol_list() {
        symbols.push(Symbol {
            id: String::new(),
            symbol: s.symbol,
            name: s.name,
            asset_type: "tfex".to_string(),
            market: None,
            category: Some(s.contract_type),
            sector: None,
            icon_url: None,
        });
    }
    
    // Add Crypto symbols
    for s in get_crypto_list() {
        symbols.push(Symbol {
            id: String::new(),
            symbol: s.symbol,
            name: s.name,
            asset_type: "crypto".to_string(),
            market: None,
            category: Some(s.category),
            sector: None,
            icon_url: None,
        });
    }
    
    // Add Foreign stocks
    for s in get_foreign_stock_list() {
        symbols.push(Symbol {
            id: String::new(),
            symbol: s.symbol,
            name: s.name,
            asset_type: "foreign_stock".to_string(),
            market: Some(s.market),
            category: None,
            sector: Some(s.sector),
            icon_url: None,
        });
    }
    
    let count = symbols.len();
    
    match state.symbols_service.seed_symbols(symbols).await {
        Ok(seeded) => Json(SeedResponse {
            seeded,
            message: format!("Successfully seeded {} of {} symbols to PocketBase", seeded, count),
        }),
        Err(e) => Json(SeedResponse {
            seeded: 0,
            message: format!("Error seeding symbols: {}", e),
        }),
    }
}
