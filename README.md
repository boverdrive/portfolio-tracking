# PT - Portfolio Tracking

แอปพลิเคชันสำหรับติดตามการลงทุนในหุ้น, TFEX และ Cryptocurrency พร้อมแสดงกำไร/ขาดทุน real-time

## ✨ Features (ความสามารถหลัก)

### 📈 Portfolio Management (จัดการพอร์ตโฟลิโอ)
- **Multi-Asset Support**: Track Cryptocurrency, Thai Stocks (SET), and TFEX in a single place.
  - *รองรับสินทรัพย์หลากหลาย*: ติดตามได้ทั้ง Crypto, หุ้นไทย และ TFEX ในที่เดียว
- **Real-time Valuation**: Automatic price updates from CoinGecko and Settrade.
  - *มูลค่าเรียลไทม์*: อัปเดตราคาตลาดอัตโนมัติจาก CoinGecko และ Settrade
- **Multi-Currency Display**: View your portfolio value in THB, USD, or BTC.
  - *แสดงผลหลายสกุลเงิน*: เลือกดูมูลค่าพอร์ตในหน่วย THB, USD หรือ BTC ได้ทันที

### 📊 Analysis & Performance (การวิเคราะห์และผลตอบแทน)
- **Interactive Dashboard**: Visual overview of Net Worth, Daily P&L, and asset allocation.
  - *แดชบอร์ดอัจฉริยะ*: ภาพรวมมูลค่าทรัพย์สิน กำไร/ขาดทุนรายวัน และสัดส่วนการลงทุน
- **Profit & Loss Tracking**: Detailed breakdown of Unrealized and Realized Gains.
  - *ติดตามกำไร/ขาดทุน*: แยกดู Unrealized (ถืออยู่) และ Realized (ขายแล้ว) ได้อย่างชัดเจน
- **Monthly Performance**: Calendar view of your trading performance month-by-month.
  - *ผลตอบแทนรายเดือน*: ดูประวัติผลงานการเทรดแยกตามเดือน
- **Asset Breakdown**: Drill-down view into specific asset classes and individual holdings.
  - *เจาะลึกสินทรัพย์*: ดูรายละเอียดสัดส่วนรายสินทรัพย์และรายตัว

### 📝 Transaction System (ระบบบันทึกธุรกรรม)
- **Complete History**: Record Buy, Sell, Deposit, and Withdrawal transactions.
  - *บันทึกครบถ้วน*: รองรับการ ซื้อ, ขาย, ฝาก, ถอน
- **Bulk Import**: Easily import past transactions via CSV or JSON.
  - *นำเข้าข้อมูล*: รองรับการ Import ประวัติการเทรดจำนวนมาก
- **Cost Basis Calculation**: Automatic handling of average cost (AVG Price).
  - *คำนวณต้นทุน*: ระบบคำนวณราคาเฉลี่ยให้อัตโนมัติ

### 🔒 Security & System (ความปลอดภัยและระบบ)
- **Self-Hosted**: You own your data. Powered by PocketBase and Docker.
  - *เป็นเจ้าของข้อมูล*: ข้อมูลทั้งหมดอยู่บนเครื่องของคุณเอง ทำงานผ่าน PocketBase
- **OAuth Integration**: Secure login support (e.g., via PocketID).
  - *รองรับ OAuth*: เชื่อมต่อระบบล็อกอินภายนอกได้

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

## 🚀 Getting Started

### Prerequisites

- [Docker](https://www.docker.com/) (Required for recommended setup)
- [Node.js](https://nodejs.org/) (18+) & [Rust](https://rustup.rs/) (Only for local development)

### 1. Quick Start (Docker Compose) - Recommended

The easiest way to run the application is using Docker Compose.

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd portfolio-tracking
   ```

2. **Configure Environment**:
   Copy the sample environment file and edit it with your settings.
   ```bash
   cp .env.sample .env
   # Edit .env with your favorite editor
   # nano .env
   ```
   *Make sure to set `POCKETBASE_ADMIN_PASSWORD` and other secrets.*

3. **Start the Stack**:
   ```bash
   docker compose up -d
   ```

4. **Create Superuser (First Time Only)**:
   Check the logs to confirm the service is running and find the Admin UI URL.
   ```bash
   docker compose logs -f pocketbase
   ```
   > Look for: `Admin UI: http://0.0.0.0:8090/_/`
   
   Open http://localhost:8090/_/ in your browser. You will be prompted to create the first admin account (email/password).
   *Note: Use these credentials to set `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` in your `.env` for the backend to connect.*

5. **Access the App**:
   - **Frontend**: http://localhost:3000 (or your configured `FRONTEND_PORT`)
   - **Backend**: http://localhost:3001 (or your configured `BACKEND_PORT`)
   - **PocketBase Admin**: http://localhost:8090/_/

### 2. Manual Setup (Local Development)

If you want to run services individually without Docker (except PocketBase which is recommended to run separately or via the binary).

#### Backend
1. `cd backend`
2. `cp .env.example .env` (Adjust as needed)
3. `cargo run`

#### Frontend
1. `cd frontend`
2. `npm install`
3. `npm run dev`

---

## 🔧 Environment Variables (.env)

The application is configured utilizing a single root `.env` file when running with Docker Compose.

See `.env.sample` for all available options. Key configurations include:

### General
- `FRONTEND_PORT`: Port for the Next.js frontend (default: `3000`)
- `BACKEND_PORT`: Port for the Rust backend (default: `3001`)

### PocketBase
- `POCKETBASE_ADMIN_EMAIL`: Admin email for backend connection
- `POCKETBASE_ADMIN_PASSWORD`: Admin password for backend connection

### APIs
- `COINGECKO_API_URL`: URL for Crypto prices
- `SETTRADE_API_URL`: URL for Thai Stock prices (if available)

### Security
- `JWT_SECRET`: Secret key for signing tokens
- `OAUTH_*`: Configuration for OAuth providers (e.g. PocketID)

## 📊 Supported Assets

### Crypto (via CoinGecko)
- BTC, ETH, BNB, SOL, XRP, ADA, DOGE, DOT, MATIC, AVAX...

### Thai Stocks (Mock - Settrade API pending)
- PTT, ADVANC, CPALL, AOT, KBANK, SCB, GULF, DELTA, BTS, TRUE...

### TFEX
- S50, S50H25...

## 📝 License

MIT

## 🐳 Docker Distribution (For Developers)

### 1. Build and Publish Images
To share this application with others, you can build and push Docker images to Docker Hub (or GHCR).
We include a script that uses `docker buildx` to build for both AMD64 (Linux servers) and ARM64 (Mac M1/M2).

```bash
# Login to Docker Hub first
docker login

# Run the publish script (default user: padetta)
./scripts/publish-docker.sh YOUR_DOCKERHUB_USERNAME
```

### 2. How Others Can Run It
Give them the `docker-compose.prod.yml` file and tell them to run:

```bash
# Set the username environment variable (optional if defaults match)
export DOCKER_USER=YOUR_DOCKERHUB_USERNAME

# Start the stack using pre-built images
docker compose -f docker-compose.prod.yml up -d
```

This will download the images from Docker Hub and start the app without needing to build source code.
