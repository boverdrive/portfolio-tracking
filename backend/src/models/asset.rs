use serde::{Deserialize, Serialize};
use super::transaction::{AssetType, Market};

/// Represents an asset holding in the portfolio with P&L calculations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioAsset {
    pub symbol: String,
    pub asset_type: AssetType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub market: Option<Market>,
    pub currency: String,
    pub quantity: f64,
    pub avg_cost: f64,        // Average purchase price (without fees)
    pub total_fees: f64,      // Total fees paid
    pub current_price: f64,
    pub total_cost: f64,      // Total cost including fees (quantity * avg_cost + total_fees)
    pub current_value: f64,
    pub unrealized_pnl: f64,
    pub unrealized_pnl_percent: f64,
    pub realized_pnl: f64,            // Realized P&L from closed portions
    #[serde(default = "default_leverage")]
    pub leverage: f64,        // Leverage/multiplier for futures
}

fn default_leverage() -> f64 { 1.0 }

impl PortfolioAsset {
    pub fn new(symbol: String, asset_type: AssetType, market: Option<Market>, currency: String) -> Self {
        Self {
            symbol,
            asset_type,
            market,
            currency,
            quantity: 0.0,
            avg_cost: 0.0,
            total_fees: 0.0,
            current_price: 0.0,
            total_cost: 0.0,
            current_value: 0.0,
            unrealized_pnl: 0.0,
            unrealized_pnl_percent: 0.0,
            realized_pnl: 0.0,
            leverage: 1.0,
        }
    }

    /// Update P&L calculations based on current price (includes leverage)
    pub fn update_pnl(&mut self, current_price: f64) {
        self.current_price = current_price;
        
        let abs_quantity = self.quantity.abs();
        // Treat leverage of 0 or less as 1 (spot trading default)
        let effective_leverage = if self.leverage <= 0.0 { 1.0 } else { self.leverage };
        let leveraged_cost = self.total_cost * effective_leverage;
        
        if self.quantity >= 0.0 {
            // Long position: profit when price goes up
            self.current_value = abs_quantity * current_price * effective_leverage;
            self.unrealized_pnl = self.current_value - leveraged_cost;
        } else {
            // Short position: profit when price goes down
            // We sold at avg_cost, current value is what we'd pay to close
            let close_cost = abs_quantity * current_price * effective_leverage;
            self.current_value = leveraged_cost; // Our original short value
            // Profit = what we sold for - what it costs to buy back
            self.unrealized_pnl = leveraged_cost - close_cost;
        }
        
        if leveraged_cost > 0.0 {
            self.unrealized_pnl_percent = (self.unrealized_pnl / leveraged_cost) * 100.0;
        } else {
            self.unrealized_pnl_percent = 0.0;
        }
    }
}

/// Portfolio summary statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioSummary {
    pub total_invested: f64,
    pub total_current_value: f64,
    pub total_unrealized_pnl: f64,
    pub total_unrealized_pnl_percent: f64,
    pub total_realized_pnl: f64,
    pub assets_count: usize,
}

impl PortfolioSummary {
    pub fn new() -> Self {
        Self {
            total_invested: 0.0,
            total_current_value: 0.0,
            total_unrealized_pnl: 0.0,
            total_unrealized_pnl_percent: 0.0,
            total_realized_pnl: 0.0,
            assets_count: 0,
        }
    }

    pub fn calculate_percent(&mut self) {
        if self.total_invested > 0.0 {
            self.total_unrealized_pnl_percent = 
                (self.total_unrealized_pnl / self.total_invested) * 100.0;
        }
    }
}

impl Default for PortfolioSummary {
    fn default() -> Self {
        Self::new()
    }
}

/// Summary by asset type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetTypeSummary {
    pub asset_type: AssetType,
    pub total_invested: f64,
    pub total_current_value: f64,
    pub unrealized_pnl: f64,
    pub unrealized_pnl_percent: f64,
    pub assets_count: usize,
}

/// Summary by market
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketSummary {
    pub market: Market,
    pub total_invested: f64,
    pub total_current_value: f64,
    pub unrealized_pnl: f64,
    pub unrealized_pnl_percent: f64,
    pub assets_count: usize,
}
