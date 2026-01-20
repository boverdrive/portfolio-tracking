const fs = require('fs');
const path = require('path');

// Load .env file from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD;

let authToken = null;

// Authenticate as admin to create records in protected collections
async function authenticate() {
    if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
        console.warn('⚠️ No admin credentials provided. Some collections may not be accessible.');
        console.warn('   Set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD in .env');
        return null;
    }

    try {
        console.log('🔐 Authenticating as admin (PocketBase v0.35+)...');
        // PocketBase v0.35+ uses _superusers collection instead of /api/admins
        const resp = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identity: PB_ADMIN_EMAIL,
                password: PB_ADMIN_PASSWORD
            })
        });

        if (!resp.ok) {
            const error = await resp.text();
            throw new Error(`Auth failed: ${error}`);
        }

        const data = await resp.json();
        authToken = data.token;
        console.log('   ✅ Authenticated successfully');
        return authToken;
    } catch (err) {
        console.error('❌ Authentication failed:', err.message);
        return null;
    }
}

// Helper to get headers with auth token
function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
        headers['Authorization'] = authToken;
    }
    return headers;
}

// Order matters for dependencies: users -> providers -> symbols -> prices
const COLLECTION_ORDER = [
    'users',
    'api_rate_limits',
    'jobs',
    'api_providers',
    'symbols',
    'asset_prices'
];

async function seed() {
    console.log('🌱 Starting Seed Process (from seed-data.json)...');
    console.log('Target:', PB_URL);

    // Authenticate first
    await authenticate();

    const seedFilePath = path.join(__dirname, 'seed-data.json');
    if (!fs.existsSync(seedFilePath)) {
        console.error('❌ seed-data.json not found! Run `node scripts/generate-seed.js` first or ensure the file exists.');
        return;
    }

    const seedData = JSON.parse(fs.readFileSync(seedFilePath, 'utf8'));

    for (const collectionName of COLLECTION_ORDER) {
        if (!seedData[collectionName]) continue;

        const records = seedData[collectionName];
        console.log(`\n--- Seeding ${collectionName} (${records.length} records) ---`);

        let createdCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const record of records) {
            try {
                // Check uniqueness (simple check based on 'id' if preserved, or unique fields)
                // If we preserved IDs in generate-seed, we can check by ID.
                // However, creating with specific ID requires the ID to be in the body.

                let filter = '';
                if (record.id) {
                    filter = `id='${record.id}'`;
                } else if (record.email) {
                    filter = `email='${record.email}'`; // for users
                } else if (record.symbol) {
                    filter = `symbol='${record.symbol}'`; // for prices/symbols
                } else if (record.provider_type) {
                    filter = `provider_type='${record.provider_type}'`;
                } else if (record.job_type) {
                    filter = `job_type='${record.job_type}'`;
                } else if (record.api_name) {
                    filter = `api_name='${record.api_name}'`;
                }

                if (filter) {
                    const existing = await fetch(`${PB_URL}/api/collections/${collectionName}/records?filter=(${filter})`, {
                        headers: getHeaders()
                    });
                    const json = await existing.json();
                    if (json.items && json.items.length > 0) {
                        skippedCount++;
                        // Optional: Update record? skipping for now.
                        continue;
                    }
                }

                // Create record
                const res = await fetch(`${PB_URL}/api/collections/${collectionName}/records`, {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify(record)
                });

                if (res.ok) {
                    createdCount++;
                } else {
                    const errText = await res.text();
                    console.error(`❌ Failed to create in ${collectionName}:`, errText.substring(0, 100));
                    errorCount++;
                }
            } catch (e) {
                console.error(`❌ Error seeding ${collectionName}:`, e.message);
                errorCount++;
            }
        }
        console.log(`   ✅ Created: ${createdCount}, ⏭️  Skipped: ${skippedCount}, ❌ Errors: ${errorCount}`);
    }

    console.log('\n🎉 Seeding Completed!');
}

seed().catch(console.error);
