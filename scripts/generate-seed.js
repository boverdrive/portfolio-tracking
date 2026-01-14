const fs = require('fs');
const path = require('path');

const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';

// Configuration: Which collections to export
const COLLECTIONS_TO_EXPORT = [
    'api_providers',
    'jobs',
    'api_rate_limits',
    'symbols',
    'asset_prices', // Optional: Initial prices
    'users' // Be careful with sensitive data
];

// Which collections to EXCLUDE (double check)
const EXCLUDED_COLLECTIONS = [
    'transactions',
    'api_call_logs',
    'asset_price_history',
    'portfolio_snapshots'
];

async function fetchCollection(collectionName) {
    console.log(`📥 Fetching ${collectionName}...`);
    let page = 1;
    const allRecords = [];

    while (true) {
        try {
            const resp = await fetch(`${PB_URL}/api/collections/${collectionName}/records?page=${page}&perPage=500`);
            if (!resp.ok) {
                if (resp.status === 404) {
                    console.warn(`⚠️ Collection ${collectionName} not found or empty (404)`);
                    return [];
                }
                throw new Error(`Failed to fetch ${collectionName}: ${resp.statusText}`);
            }

            const data = await resp.json();
            if (data.items && data.items.length > 0) {
                allRecords.push(...data.items);
                if (page >= data.totalPages) break;
                page++;
            } else {
                break;
            }
        } catch (err) {
            console.error(`❌ Error fetching ${collectionName}:`, err.message);
            // Don't break the whole process for one collection failure?
            // Usually valid to return empty
            return allRecords;
        }
    }

    console.log(`   ✅ Got ${allRecords.length} records`);
    return allRecords;
}

function cleanRecord(record, collectionName) {
    // Remove system fields that PocketBase sets automatically
    const { created, updated, collectionId, collectionName: cName, expand, ...rest } = record;

    // For users, DO NOT export password hashes or salts if possible
    // But we need to recreate the user. 
    // Usually we export email/name and set a default password for the seed.
    if (collectionName === 'users') {
        const { passwordHash, ...userFields } = rest;
        return {
            ...userFields,
            // We can't reuse the hash easily on a fresh instance without same salt logic
            // Ideally we set a temporary password in seed.js or let user register
            password: 'password123',
            passwordConfirm: 'password123'
        };
    }

    return rest;
}

async function main() {
    console.log('🔄 generating seed data from:', PB_URL);

    const seedData = {};

    for (const col of COLLECTIONS_TO_EXPORT) {
        const records = await fetchCollection(col);
        seedData[col] = records.map(r => cleanRecord(r, col));
    }

    const outputPath = path.join(__dirname, 'seed-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(seedData, null, 2));

    console.log(`\n💾 Saved seed data to: ${outputPath}`);
    console.log('   (Transactions and Logs were excluded)');
}

main().catch(console.error);
