// Script to insert sample portfolio snapshots for the past 7 days
// Run with: node scripts/seed-snapshots.js

const PB_URL = process.env.POCKETBASE_URL || 'http://192.168.1.85:8080';

async function main() {
    console.log('🌱 Seeding portfolio snapshots...');
    console.log('PocketBase URL:', PB_URL);

    // First, get a user ID
    const usersResp = await fetch(`${PB_URL}/api/collections/users/records?perPage=1`);
    const usersData = await usersResp.json();

    if (!usersData.items || usersData.items.length === 0) {
        console.error('❌ No users found. Please create a user first.');
        process.exit(1);
    }

    const userId = usersData.items[0].id;
    console.log('📧 Using user ID:', userId);

    // Generate sample data for past 7 days
    const snapshots = [];
    const baseValue = 1000000;
    const baseInvested = 950000;

    for (let i = 7; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        // Add some variation to make the chart interesting
        const variation = Math.random() * 100000 - 30000;
        const dayGrowth = (7 - i) * 15000;
        const currentValue = Math.round(baseValue + variation + dayGrowth);
        const invested = Math.round(baseInvested + (7 - i) * 5000);
        const pnl = currentValue - invested;
        const pnlPercent = (pnl / invested) * 100;

        snapshots.push({
            user_id: userId,
            date: `${dateStr} 00:00:00.000Z`,
            total_invested: invested,
            total_current_value: currentValue,
            total_unrealized_pnl: pnl,
            total_unrealized_pnl_percent: parseFloat(pnlPercent.toFixed(2)),
            total_realized_pnl: 0,
            assets_count: 5,
            currency: 'THB',
            assets: []
        });
    }

    console.log(`\n📊 Inserting ${snapshots.length} snapshots...`);

    for (const snapshot of snapshots) {
        try {
            const resp = await fetch(`${PB_URL}/api/collections/portfolio_snapshots/records`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snapshot)
            });

            if (resp.ok) {
                console.log(`✅ ${snapshot.date.split(' ')[0]}: ฿${snapshot.total_current_value.toLocaleString()}`);
            } else {
                const error = await resp.text();
                console.error(`❌ ${snapshot.date.split(' ')[0]}: ${error}`);
            }
        } catch (err) {
            console.error(`❌ ${snapshot.date.split(' ')[0]}: ${err.message}`);
        }
    }

    console.log('\n🎉 Done!');
}

main().catch(console.error);
