# Web Scraper

A paid **web scraping API** for AI agents and clients. Submit a URL and receive metadata plus optional markdown or HTML. Powered by **x402 micropayments** ($0.03 USDC per call) with a 2-call free tier per caller.

## Architecture

```
Client / Agent → Freemium Gate → x402 Payment Layer → POST /scrape
                                                                 │
                                                    Content extraction
                                                    (metadata, markdown, HTML)
```

- **Freemium gate**: First 2 requests per wallet (or per IP when no wallet header) are free.
- **x402**: After the free tier, callers pay $0.03 USDC per scrape via the x402 protocol (Base).
- **POST /scrape**: Accepts a URL and optional flags; returns extracted content as JSON.

## Quick Start

```bash
# Install
npm install

# Configure
cp .env.example .env
# Set PAYMENT_RECEIVER_ADDRESS, X402_* and your scraper API key

# Development (auto-reload)
npm run dev

# Production
npm run build && npm start
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check |
| `POST` | `/scrape` | x402 (after free tier) | Scrape a URL; returns metadata, optional markdown/HTML |
| `GET` | `/.well-known/agent.json` | None | OASF agent card |

### POST /scrape

**Body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | URL to scrape |
| `markdown` | boolean | No | Include markdown of page content |
| `html` | boolean | No | Include raw HTML |

**Response:** JSON with `url`, `status`, `metadata` (e.g. `title`, `description`, `word_count`), and optionally `markdown` and `html` when requested.

## x402 Payment Flow

1. Client sends `POST /scrape` with a JSON body containing `url`.
2. **Freemium gate** identifies the caller by `x-wallet-address` (or IP for browser requests). First **2 calls per caller** are free.
3. After that, **x402 middleware** returns `402 Payment Required` with a **paywall UI** (wallet connect, sign USDC transfer).
4. Client resends the request with a valid `X-PAYMENT` header; the middleware verifies payment and the scrape is served.

### Network Configuration

| Environment | Network | Facilitator |
|-------------|---------|-------------|
| Testnet (default) | `eip155:84532` (Base Sepolia) | `https://x402.org/facilitator` |
| Mainnet | `eip155:8453` (Base) | Coinbase CDP / OpenX402 / Infra402 |

## Scripts

```bash
npm run dev          # Auto-reload dev server
npm run build        # Compile TypeScript
npm start            # Run production server
npm run typecheck    # Type-check without compiling
```

## Docker

```bash
docker build --platform linux/amd64 -t web-scraper .
docker run --platform linux/amd64 -p 8080:8080 --env-file .env web-scraper
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | Server port |
| `BASE_URL` | No | `http://localhost:8080` | Public URL (e.g. for agent card) |
| `PAYMENT_RECEIVER_ADDRESS` | Yes | — | Wallet receiving USDC payments |
| `X402_FACILITATOR_URL` | No | `https://x402.org/facilitator` | x402 facilitator endpoint |
| `X402_NETWORK` | No | `eip155:84532` | CAIP-2 network (Base Sepolia / Base) |
| *(scraper API key)* | Yes for `/scrape` | — | API key for the backing scrape service (see `.env.example`) |

## Dependencies

### Runtime

- **@x402/express**, **@x402/core**, **@x402/evm** — x402 payment protocol
- **@x402/paywall** — Browser paywall UI with wallet connection
- **express** — HTTP server
- **axios** — HTTP client
- **viem** — Ethereum utilities
- **dotenv** — Environment variable loading

### Dev

- **typescript**, **tsx** — TypeScript compilation and dev runner

## License

Apache-2.0
