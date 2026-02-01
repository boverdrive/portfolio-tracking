import { Transaction } from '@/types';
import { getUnitConversionFactor } from '@/lib/units';

export interface TransactionMetric {
    realizedPnl: number;
    unrealizedPnl: number;
    remainingQty: number;
    // Helper to know if it's fully closed
    isClosed: boolean;
}

/**
 * Calculates FIFO P&L metrics for a list of transactions.
 * Requires transactions to be sorted by date (handled internally if needed, but efficient if passed sorted).
 * 
 * @param transactions List of transactions (will be grouped by symbol internally)
 * @param currentPrices Map of symbol -> current price
 * @returns Map of transactionId -> TransactionMetric
 */
export function calculatePnlMetrics(
    transactions: Transaction[],
    currentPrices: Record<string, number>
): Record<string, TransactionMetric> {
    const metrics: Record<string, TransactionMetric> = {};

    // Group by symbol to process FIFO per asset
    const txBySymbol: Record<string, Transaction[]> = {};
    transactions.forEach(tx => {
        if (!txBySymbol[tx.symbol]) txBySymbol[tx.symbol] = [];
        txBySymbol[tx.symbol].push(tx);
    });

    Object.entries(txBySymbol).forEach(([symbol, txs]) => {
        // Sort by date ascending to ensure FIFO order
        txs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const currentPrice = currentPrices[symbol] || currentPrices[symbol.toUpperCase()] || 0;

        // Queues for FIFO
        // Spot: Buy -> Sell
        const spotQueue: { qty: number; price: number; id: string }[] = [];
        // Futures Long: Long -> Close Long
        const longQueue: { qty: number; price: number; id: string; multiplier: number }[] = [];
        // Futures Short: Short -> Close Short
        const shortQueue: { qty: number; price: number; id: string; multiplier: number }[] = [];

        txs.forEach(tx => {
            if (tx.symbol === 'BTC') {
                console.log('DEBUG BTC TX:', tx.action, tx.quantity, tx.asset_type, tx.market);
            }
            // Only apply leverage multiplier for TFEX (Contract Size)
            // For Crypto Futures, Qty is usually Position Size, so multiplier is 1.
            const multiplier = tx.asset_type === 'tfex' ? (tx.leverage || 1) : 1;
            const action = tx.action.toLowerCase();

            // Apply unit conversion correction
            // Use currency from transaction or default to THB (common for Gold)
            const conversionFactor = getUnitConversionFactor(tx.unit, tx.asset_type, tx.currency || 'THB');
            const quantity = tx.quantity * conversionFactor;

            // Initialize default metric
            metrics[tx.id] = {
                realizedPnl: 0,
                unrealizedPnl: 0,
                remainingQty: 0,
                isClosed: true
            };

            // --- SPOT TRADE ---
            if (action === 'buy') {
                spotQueue.push({ qty: quantity, price: tx.price, id: tx.id });
                metrics[tx.id].remainingQty = quantity;
                metrics[tx.id].isClosed = false;

                if (currentPrice > 0) {
                    metrics[tx.id].unrealizedPnl = (currentPrice - tx.price) * quantity * multiplier;
                }
            }
            else if (action === 'sell') {
                let remainingToSell = quantity;
                let totalRealizedPnl = 0;

                while (remainingToSell > 0 && spotQueue.length > 0) {
                    const item = spotQueue[0];
                    const take = Math.min(remainingToSell, item.qty);

                    // Spot P&L: (Exit - Entry) * Qty
                    const pnl = (tx.price - item.price) * take * multiplier;
                    totalRealizedPnl += pnl;

                    item.qty -= take;
                    remainingToSell -= take;

                    if (metrics[item.id]) {
                        metrics[item.id].remainingQty = item.qty;
                        if (item.qty <= 0.00000001) {
                            metrics[item.id].isClosed = true;
                            metrics[item.id].unrealizedPnl = 0;
                            metrics[item.id].remainingQty = 0;
                        } else if (currentPrice > 0) {
                            metrics[item.id].unrealizedPnl = (currentPrice - item.price) * item.qty * multiplier;
                        }
                    }

                    if (item.qty <= 0.00000001) spotQueue.shift();
                }
                metrics[tx.id].realizedPnl = totalRealizedPnl;
            }
            // --- FUTURES LONG | LIQUIDATE LONG ---
            else if (action === 'long') {
                longQueue.push({ qty: quantity, price: tx.price, id: tx.id, multiplier });
                metrics[tx.id].remainingQty = quantity;
                metrics[tx.id].isClosed = false;

                if (currentPrice > 0) {
                    metrics[tx.id].unrealizedPnl = (currentPrice - tx.price) * quantity * multiplier;
                }
            }
            else if (action === 'close_long' || action === 'liquidate_long') {
                let remainingToClose = quantity;
                let totalRealizedPnl = 0;

                while (remainingToClose > 0 && longQueue.length > 0) {
                    const item = longQueue[0];
                    const take = Math.min(remainingToClose, item.qty);

                    // Use multiplier from the opening position if available, otherwise current tx
                    const calcMultiplier = item.multiplier || multiplier;
                    const pnl = (tx.price - item.price) * take * calcMultiplier;
                    totalRealizedPnl += pnl;

                    item.qty -= take;
                    remainingToClose -= take;

                    if (metrics[item.id]) {
                        metrics[item.id].remainingQty = item.qty;
                        if (item.qty <= 0.00000001) {
                            metrics[item.id].isClosed = true;
                            metrics[item.id].unrealizedPnl = 0;
                            metrics[item.id].remainingQty = 0;
                        } else if (currentPrice > 0) {
                            metrics[item.id].unrealizedPnl = (currentPrice - item.price) * item.qty * multiplier;
                        }
                    }

                    if (item.qty <= 0.00000001) longQueue.shift();
                }
                metrics[tx.id].realizedPnl = totalRealizedPnl;
            }
            // --- FUTURES SHORT | LIQUIDATE SHORT ---
            else if (action === 'short') {
                shortQueue.push({ qty: quantity, price: tx.price, id: tx.id, multiplier });
                metrics[tx.id].remainingQty = quantity;
                metrics[tx.id].isClosed = false;

                // Short P&L: (Entry - Current)
                if (currentPrice > 0) {
                    metrics[tx.id].unrealizedPnl = (tx.price - currentPrice) * quantity * multiplier;
                }
            }
            else if (action === 'close_short' || action === 'liquidate_short') {
                let remainingToClose = quantity;
                let totalRealizedPnl = 0;

                while (remainingToClose > 0 && shortQueue.length > 0) {
                    const item = shortQueue[0];
                    const take = Math.min(remainingToClose, item.qty);

                    const calcMultiplier = item.multiplier || multiplier;
                    // Short Realized: (Entry - Exit)
                    const pnl = (item.price - tx.price) * take * calcMultiplier;
                    totalRealizedPnl += pnl;

                    item.qty -= take;
                    remainingToClose -= take;

                    if (metrics[item.id]) {
                        metrics[item.id].remainingQty = item.qty;
                        if (item.qty <= 0.00000001) {
                            metrics[item.id].isClosed = true;
                            metrics[item.id].unrealizedPnl = 0;
                            metrics[item.id].remainingQty = 0;
                        } else if (currentPrice > 0) {
                            metrics[item.id].unrealizedPnl = (item.price - currentPrice) * item.qty * multiplier;
                        }
                    }

                    if (item.qty <= 0.00000001) shortQueue.shift();
                }
            }
        });
    });

    return metrics;
}
