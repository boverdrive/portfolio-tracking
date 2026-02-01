use crate::models::AssetType;

// Conversion factors to Grams
pub const GRAMS_PER_TROY_OZ: f64 = 31.1034768;
pub const GRAMS_PER_BAHT: f64 = 15.244;
pub const GRAMS_PER_SALUNG: f64 = 3.811;
pub const GRAMS_PER_KG: f64 = 1000.0;

/// Normalize quantity to base unit
/// Gold/Silver/Commodity -> Troy Oz
/// Others -> Same quantity
pub fn normalize_quantity(quantity: f64, unit: Option<&str>, asset_type: &AssetType, symbol: &str) -> (f64, String) {
    match asset_type {
        AssetType::Gold | AssetType::Commodity => {
            // Special handling for Thai Gold symbols - KEEP AS BAHT
            // Because price API returns price per Baht, we should not normalize to Oz
            let s = symbol.to_uppercase();
            if s == "GOLD96.5" || s == "GOLD99.99" {
                 // Return as is (implied unit is Baht or whatever user entered, but we standardize output name)
                 // If user entered "baht", keep it. If they entered "g", well... usually for these symbols it's Baht.
                 // Let's standardise the output "unit name" to "baht" for these symbols.
                 let u = unit.unwrap_or("baht").to_lowercase();
                 if u == "baht" {
                     return (quantity, "baht".to_string());
                 }
                 // If specific unit conversion needed within Thai context (e.g. Salung -> Baht), do it here?
                 // 1 Baht = 4 Salung
                 if u == "salung" {
                     return (quantity / 4.0, "baht".to_string());
                 }
                 // If they bought in grams? 1 Baht = 15.244g
                 if u == "gram" || u == "g" {
                     return (quantity / GRAMS_PER_BAHT, "baht".to_string());
                 }
                 return (quantity, "baht".to_string());
            }

            let u = unit.unwrap_or("oz").to_lowercase();
            match u.as_str() {
                "oz" | "troy_oz" => (quantity, "oz".to_string()),
                "gram" | "g" => (quantity / GRAMS_PER_TROY_OZ, "oz".to_string()),
                "kg" => ((quantity * GRAMS_PER_KG) / GRAMS_PER_TROY_OZ, "oz".to_string()),
                "baht" => ((quantity * GRAMS_PER_BAHT) / GRAMS_PER_TROY_OZ, "oz".to_string()),
                "salung" => ((quantity * GRAMS_PER_SALUNG) / GRAMS_PER_TROY_OZ, "oz".to_string()),
                _ => (quantity, "oz".to_string()), // Default/Fallback
            }
        },
        _ => (quantity, "share".to_string())
    }
}

/// Convert price to price per base unit (Oz)
/// e.g. if bought 1 Baht at 40000, Price/Oz approx = 40000 * (31.1035/15.244)
pub fn normalize_price(price: f64, unit: Option<&str>, asset_type: &AssetType, symbol: &str) -> f64 {
    match asset_type {
        AssetType::Gold | AssetType::Commodity => {
            // Special handling for Thai Gold symbols - KEEP AS BAHT PRICE
            let s = symbol.to_uppercase();
            if s == "GOLD96.5" || s == "GOLD99.99" {
                let u = unit.unwrap_or("baht").to_lowercase();
                 // If we have price per Salung, convert to Price per Baht
                 // Price/Baht = Price/Salung * 4
                 // [FIX] Thai Gold is almost always quoted in Baht unit price even if buying Salung.
                 // So we assume the user entered the Baht price (e.g. 40,000) not the Salung price (10,000).
                 if u == "salung" {
                     return price;
                 }
                 // Price/Gram -> Price/Baht
                 // Price/Baht = Price/Gram * 15.244
                 if u == "gram" || u == "g" {
                     return price * GRAMS_PER_BAHT;
                 }
                 return price;
            }

            let u = unit.unwrap_or("oz").to_lowercase();
            match u.as_str() {
                "oz" | "troy_oz" => price,
                // Price is per Gram. 1 Oz = 31.1g. Price/Oz = Price/g * 31.1
                "gram" | "g" => price * GRAMS_PER_TROY_OZ,
                // Price is per Kg. 1 Oz = 0.0311kg. Price/Oz = Price/kg * 0.0311
                "kg" => price * (GRAMS_PER_TROY_OZ / GRAMS_PER_KG),
                // Price is per Baht. 1 Oz = 2.04 Baht. Price/Oz = Price/Baht * 2.04
                "baht" => price * (GRAMS_PER_TROY_OZ / GRAMS_PER_BAHT),
                "salung" => price * (GRAMS_PER_TROY_OZ / GRAMS_PER_SALUNG),
                _ => price,
            }
        },
        _ => price
    }
}
