
import { AssetType } from '@/types';

// Unit Conversion Constants
export const GRAMS_PER_TROY_OZ = 31.1034768; // Standard Troy Oz
export const GRAMS_PER_BAHT = 15.244;      // Thai Gold Baht Weight (96.5%)
export const GRAMS_PER_SALUNG = 3.811;     // 1 Baht = 4 Salung
export const GRAMS_PER_KG = 1000.0;
export const BAHT_PER_SALUNG = 0.25;

// Helper to get conversion factor to Base Unit
// - If Currency is THB => Base Unit for Gold is Baht
// - If Currency is USD => Base Unit for Gold is Oz (Troy Oz)
// - Start by supporting THB base mostly for local gold
export const getUnitConversionFactor = (unit: string | undefined, assetType: AssetType, currency: string): number => {
    if ((assetType !== 'gold' && assetType !== 'commodity') || !unit) return 1;

    const u = unit.toLowerCase();

    // Context: THB (Thai Gold usually priced per Baht)
    if (currency === 'THB') {
        switch (u) {
            case 'baht': return 1;
            case 'salung': return 0.25; // 4 Salung = 1 Baht
            case 'gram': return 1 / GRAMS_PER_BAHT; // 1 Baht = 15.244g
            case 'g': return 1 / GRAMS_PER_BAHT;
            case 'kg': return GRAMS_PER_KG / GRAMS_PER_BAHT;
            case 'oz': return GRAMS_PER_TROY_OZ / GRAMS_PER_BAHT;
            case 'troy_oz': return GRAMS_PER_TROY_OZ / GRAMS_PER_BAHT;
            default: return 1;
        }
    }

    // Context: USD (Global Spot usually priced per Oz)
    if (currency === 'USD' || currency === 'USDT') {
        switch (u) {
            case 'oz': return 1;
            case 'troy_oz': return 1;
            case 'gram': return 1 / GRAMS_PER_TROY_OZ;
            case 'g': return 1 / GRAMS_PER_TROY_OZ;
            case 'kg': return GRAMS_PER_KG / GRAMS_PER_TROY_OZ;
            case 'baht': return GRAMS_PER_BAHT / GRAMS_PER_TROY_OZ;
            case 'salung': return GRAMS_PER_SALUNG / GRAMS_PER_TROY_OZ;
            default: return 1;
        }
    }

    return 1;
};

// Cycle through units for display toggle
// Returns the next unit in the cycle
export const getNextUnit = (currentUnit: string | undefined, assetType: AssetType): string => {
    if (assetType !== 'gold' && assetType !== 'commodity') return '';

    // Default chain for Gold
    const goldUnits = ['baht', 'salung', 'oz', 'gram', 'kg'];
    const commodityUnits = ['oz', 'kg', 'gram']; // Simplified for commodity

    const units = assetType === 'commodity' ? commodityUnits : goldUnits;
    const current = (currentUnit || 'baht').toLowerCase(); // Default to baht if undefined

    const idx = units.indexOf(current);
    if (idx === -1) return units[0]; // fallback to first

    return units[(idx + 1) % units.length];
};
