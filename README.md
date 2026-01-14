# Portfolio Tracker

แอปพลิเคชันสำหรับติดตามการลงทุนในหุ้น, TFEX และ Cryptocurrency พร้อมแสดงกำไร/ขาดทุน real-time

## ✨ Features

- 📊 **Dashboard** แสดงภาพรวมพอร์ตโฟลิโอ
- 💰 **P&L Tracking** คำนวณกำไร/ขาดทุนอัตโนมัติ
- 📈 **ราคา Real-time** จาก CoinGecko (Crypto) และ Settrade (หุ้นไทย)
- 🏦 **รองรับหลายประเภท** หุ้น, TFEX, Crypto
- 💾 **บันทึกข้อมูล** ด้วย PocketBase

## 🛠 Tech Stack

- **Frontend**: Next.js 16 + React + TypeScript + Tailwind CSS
- **Backend**: Rust + Axum
- **Database**: PocketBase

## 📁 Project Structure

```
portfolio-tracking/
├── backend/                # Rust API Server
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── handlers/       # API handlers
│       ├── models/         # Data models
│       └── services/       # Business logic
├── frontend/               # Next.js Frontend
│   ├── package.json
│   └── src/
│       ├── app/           # Pages
│       ├── components/    # React components
│       ├── lib/           # API client
│       └── types/         # TypeScript types
└── pocketbase/            # PocketBase data (optional)
```

## 🚀 Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [Node.js](https://nodejs.org/) (18+)
- [PocketBase](https://pocketbase.io/) (optional - ใช้ in-memory storage ได้)

### 1. Start Backend

```bash
cd backend
cp .env.example .env  # (optional) แก้ไข config
cargo run
```

Backend จะรันที่ http://localhost:3001

### 2. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend จะรันที่ http://localhost:3000

### 4. Run with Docker (Recommended)

```bash
docker compose up -d --build
```

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:3001
- **PocketBase Admin**: http://localhost:8090/_/ (Login with admin credentials in `backend/src/config.rs` or setup new)

### 3. Start PocketBase (Manual Layout)

```bash
# Download PocketBase from https://pocketbase.io/docs/
./pocketbase serve

# Import Schema
1. Go to http://localhost:8090/_/ > Settings > Import collections
2. Select `backend/pb_schema_v035.json` and choose **Load**.

# Seed Initial Data (Optional)
This will populate the database with essential configuration (Jobs, Providers, Symbols).
```bash
node scripts/seed.js
```

# Backup/Export Data (For Developers)
To update the seed file with current database state:
```bash
node scripts/generate-seed.js
```
```

PocketBase will run at http://localhost:8090

## 📡 API Endpoints

### Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/transactions` | List all transactions |
| POST | `/api/transactions` | Create new transaction |
| GET | `/api/transactions/:id` | Get transaction by ID |
| PUT | `/api/transactions/:id` | Update transaction |
| DELETE | `/api/transactions/:id` | Delete transaction |

### Portfolio

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/portfolio` | Get portfolio with P&L |
| GET | `/api/portfolio/summary` | Get summary only |
| GET | `/api/portfolio/type/:type` | Filter by asset type |

### Prices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/prices/:symbol?asset_type=crypto` | Get price |
| POST | `/api/prices/batch` | Get multiple prices |
| POST | `/api/prices/cache/clear` | Clear cache |

## 💡 Usage Example

### Add a Buy Transaction

```bash
curl -X POST http://localhost:3001/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "asset_type": "crypto",
    "symbol": "BTC",
    "action": "buy",
    "quantity": 0.1,
    "price": 1500000,
    "fees": 100
  }'
```

### Get Portfolio

```bash
curl http://localhost:3001/api/portfolio
```

## 🔧 Environment Variables

### Backend (.env)

```env
SERVER_HOST=0.0.0.0
SERVER_PORT=3001
POCKETBASE_URL=http://127.0.0.1:8090
COINGECKO_API_URL=https://api.coingecko.com/api/v3
PRICE_CACHE_TTL=60
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## 📊 Supported Assets

### Crypto (via CoinGecko)
- BTC, ETH, BNB, SOL, XRP, ADA, DOGE, DOT, MATIC, AVAX...

### Thai Stocks (Mock - Settrade API pending)
- PTT, ADVANC, CPALL, AOT, KBANK, SCB, GULF, DELTA, BTS, TRUE...

### TFEX
- S50, S50H25...

## 📝 License

MIT
