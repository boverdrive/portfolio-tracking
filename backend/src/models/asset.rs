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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>, 
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
    #[serde(default = "default_position_type")]
    pub position_type: String, // "spot", "long", "short"
    #[serde(default)]
    pub realized_dividend: f64, // Total dividends received
}

fn default_leverage() -> f64 { 1.0 }
fn default_position_type() -> String { "spot".to_string() }

impl PortfolioAsset {
    pub fn new(symbol: String, asset_type: AssetType, market: Option<Market>, currency: String) -> Self {
        Self {
            symbol,
            asset_type,
            market,
            currency,
            unit: None,
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
            position_type: "spot".to_string(),
            realized_dividend: 0.0,
        }
    }

    /// Update P&L calculations based on current price (includes leverage/multiplier)
    pub fn calculate_pnl(&mut self, current_price: f64) {
        self.current_price = current_price;
        
        match self.asset_type {
            AssetType::Tfex => {
                // For TFEX, 'leverage' field stores the Contract Multiplier (e.g. 200 for S50, 100 for SVF)
                let multiplier = if self.leverage <= 0.0 { 1.0 } else { self.leverage };
                let abs_quantity = self.quantity.abs();
                
                // Value = Price * Quantity * Multiplier
                // Note: Current Value usually means "Notional Value" or "Market Exposure"
                self.current_value = abs_quantity * current_price * multiplier;
                
                // Cost Basis (Notional) = Avg Cost * Quantity * Multiplier
                let notional_cost = abs_quantity * self.avg_cost * multiplier;
                
                // Calculate P&L
                if self.quantity >= 0.0 {
                    // Long: (Current - Avg) * Qty * Multiplier
                    self.unrealized_pnl = self.current_value - notional_cost;
                } else {
                    // Short: (Avg - Current) * Qty * Multiplier
                    self.unrealized_pnl = notional_cost - self.current_value;
                    // Deduct fees from PnL? 
                    // total_fees is maintained separately in PortfolioAsset.
                    // Usually Unrealized PnL is Gross. Net PnL is Gross - Fees.
                    // But here we usually store "Net Unrealized PnL"?
                    // Let's stick to Gross for Unrealized PnL component logic, but then we have to consider total_fees globally?
                    // In previous logic: `unrealized_pnl = ... - leveraged_cost`. leveraged_cost was based on total_cost which included fees.
                    // So let's include fees.
                }
                
                // Adjust for fees
                // Start with Gross PnL calculated above, then subtract total_fees
                self.unrealized_pnl -= self.total_fees;
                
                // Percentage Calculation
                // For TFEX, since we don't track Initial Margin, we can't calculate true ROE.
                // Displaying % Change of the Asset Price is safer and less confusing than a fake ROE.
                // Or we could display (PnL / Notional Cost) * 100 which is effectively Price Change %.
                if notional_cost > 0.0 {
                    self.unrealized_pnl_percent = (self.unrealized_pnl / notional_cost) * 100.0;
                    // If we want to show Leveraged % (ROE) assuming some margin, we can't without more info.
                    // However, users usually expect % to be "Price Change %".
                    // If they want ROE, they need to input Margin, which we don't have.
                    // So we stick to Price Change %.
                } else {
                    self.unrealized_pnl_percent = 0.0;
                }
            },
            AssetType::Crypto => {
                // For Crypto Futures, 'leverage' is Financial Leverage (e.g. 10x, 20x)
                // Quantity is usually in Units (e.g. BTC).
                
                let abs_quantity = self.quantity.abs();
                let notional_value = abs_quantity * current_price;
                let notional_cost = abs_quantity * self.avg_cost; // Raw cost without fees
                
                self.current_value = notional_value;
                
                // P&L Calculation (Gross)
                let gross_pnl = if self.quantity >= 0.0 {
                    notional_value - notional_cost
                } else {
                    notional_cost - notional_value
                };
                
                // Net P&L
                self.unrealized_pnl = gross_pnl - self.total_fees;

                // Percentage Calculation (ROE)
                // Cost Basis for ROE is (Notional Cost / Leverage)
                let leverage = if self.leverage <= 0.0 { 1.0 } else { self.leverage };
                
                // If leverage > 1, we assume it's a futures position where user cares about ROE
                if leverage > 1.0 {
                    let margin_invested = notional_cost / leverage;
                     if margin_invested > 0.0 {
                        self.unrealized_pnl_percent = (self.unrealized_pnl / margin_invested) * 100.0;
                    } else {
                        self.unrealized_pnl_percent = 0.0;
                    }
                } else {
                    // Spot / 1x: Just standard ROI
                    // Use total_cost (includes fees) as basis? Or just notional_cost?
                    // Usually ROI = Net PnL / Invested. Invested = Amount paid + Fees.
                    let total_invested = notional_cost + self.total_fees;
                    if total_invested > 0.0 {
                         self.unrealized_pnl_percent = (self.unrealized_pnl / total_invested) * 100.0;
                    } else {
                        self.unrealized_pnl_percent = 0.0;
                    }
                }
            },
            _ => {
                // Standard Spot Assets (Stock, Gold, etc.)
                let abs_quantity = self.quantity.abs();
                let notional_value = abs_quantity * current_price;
                let notional_cost = abs_quantity * self.avg_cost;
                
                self.current_value = notional_value;
                
                let gross_pnl = if self.quantity >= 0.0 {
                    notional_value - notional_cost
                } else {
                    // Shorting usage for Stocks? (Rare but possible)
                    notional_cost - notional_value
                };
                
                self.unrealized_pnl = gross_pnl - self.total_fees;
                
                let total_invested = notional_cost + self.total_fees;
                 if total_invested > 0.0 {
                     self.unrealized_pnl_percent = (self.unrealized_pnl / total_invested) * 100.0;
                } else {
                    self.unrealized_pnl_percent = 0.0;
                }
            }
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
    pub realized_pnl_breakdown: std::collections::HashMap<String, f64>,
    pub total_dividend: f64,
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
            realized_pnl_breakdown: std::collections::HashMap::new(),
            total_dividend: 0.0,
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


