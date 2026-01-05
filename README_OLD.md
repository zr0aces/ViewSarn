# ViewSarn

**HTML to PDF/PNG Conversion API powered by Playwright**

ViewSarn is a production-ready HTTP API service that converts HTML documents to PDF or PNG files with high-fidelity rendering. Built on Playwright's Chromium engine, it provides accurate rendering with full support for Thai fonts, custom styling, and flexible output configurations.

Perfect for generating invoices, reports, receipts, certificates, and any document-based content programmatically.

---

## ✨ Key Features

- **🎯 Simple REST API** - Convert HTML to PDF/PNG with a single POST request
- **🌐 Thai Language Support** - Pre-installed Sarabun, Noto Sans Thai, and Google Sans fonts
- **🎨 Flexible Output** - Configure paper size, orientation, margins, scaling, and DPI
- **🔒 Secure Authentication** - API key-based auth (single key or multiple keys via file)
- **⏱️ Rate Limiting** - Built-in rate limiting per API key or IP address
- **💾 Dual Output Modes** - Stream directly to client or save to server storage
- **🔄 Hot Reload** - API keys auto-reload without server restart
- **⚡ Performance** - Optimized browser instance reuse for high throughput
- **🐳 Docker Ready** - Fully containerized with production-ready Dockerfile

---

## 🛠️ Tech Stack

### Backend
- **Runtime**: Node.js 16+ (Node 20 recommended)
- **Framework**: Express.js 4.x
- **Renderer**: Playwright 1.56+ (Chromium)
- **Logger**: Pino with pino-pretty

### Infrastructure
- **Container**: Docker (Node 20-bullseye base)
- **Fonts**: Sarabun, Google Sans, Noto Sans Thai
- **Storage**: Volume-mounted output directory

### Dependencies
- `express` - HTTP server
- `playwright` - Browser automation and rendering
- `body-parser` - JSON request parsing
- `pino` / `pino-pretty` - Structured logging

---

## 📁 Project Structure

```
ViewSarn/
├── server.js              # Main Express server
├── src/
│   ├── config.js          # Environment configuration
│   ├── auth.js            # API key authentication
│   ├── rateLimit.js       # Rate limiting logic
│   ├── render.js          # Playwright rendering engine
│   └── logger.js          # Pino logger setup
├── fonts/                 # Font files for Docker build
│   ├── Sarabun/
│   ├── Google_Sans/
│   └── Noto_Sans_Thai/
├── Dockerfile             # Production Docker image
├── package.json           # Node dependencies
├── convert-cli.sh         # CLI tool for testing
├── test-convert.js        # Node.js test script
└── documents/             # Technical documentation
```

---

## 📋 Prerequisites

Before getting started, ensure you have the following installed:

- **Docker** 20.10+ and **Docker Compose** 2.0+ (for containerized deployment)
- **Node.js** 16+ (for local development)
- **curl** or similar HTTP client (for testing)

---

## 🚀 Quick Start

### Option 1: Docker Deployment (Recommended)

**1. Clone the repository**
```bash
git clone https://github.com/zr0aces/ViewSarn.git
cd ViewSarn
```

**2. Create a docker-compose.yml file**
```yaml
version: "3.8"
services:
  viewsarn:
    build: .
    image: viewsarn:latest
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - OUTPUT_DIR=/output
      - API_KEYS_FILE=/app/apikeys.txt
      - RATE_LIMIT_MAX=120
      - RATE_LIMIT_WINDOW_MS=60000
      - LOG_LEVEL=info
    volumes:
      - ./output:/output
      - ./apikeys.txt:/app/apikeys.txt:ro
    shm_size: "1gb"
    restart: unless-stopped
```

**3. Create output directory and API keys file**
```bash
mkdir -p output
cat > apikeys.txt << EOF
# Add your API keys (one per line)
key-abc123
key-admin
key-mobile-app
EOF
```

**4. Build and start the service**
```bash
docker compose build
docker compose up -d
```

**5. Verify the service is running**
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "ok": true,
  "pid": 24,
  "apiAuthFileInUse": true,
  "rate_limit_window_ms": 60000,
  "rate_limit_max": 120
}
```

### Option 2: Local Development

**1. Install dependencies**
```bash
npm install
```

**2. Install Playwright browsers**
```bash
npx playwright install chromium
```

**3. Set environment variables**
```bash
export PORT=3000
export OUTPUT_DIR=./output
export API_KEY=your-secret-key
export RATE_LIMIT_MAX=120
export RATE_LIMIT_WINDOW_MS=60000
```

**4. Create output directory**
```bash
mkdir -p output
```

**5. Start the server**
```bash
npm start
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | `3000` | HTTP server port |
| `OUTPUT_DIR` | string | `/output` | Directory for saved files (when `save=true`) |
| `API_KEY` | string | `null` | Single API key for authentication (alternative to file) |
| `API_KEYS_FILE` | string | `/app/apikeys.txt` | Path to file containing multiple API keys (one per line) |
| `API_KEYS_RELOAD_MS` | number | `30000` | Interval (ms) to reload API keys file |
| `RATE_LIMIT_MAX` | number | `120` | Maximum requests per window |
| `RATE_LIMIT_WINDOW_MS` | number | `60000` | Rate limit time window in milliseconds (60s default) |
| `LOG_LEVEL` | string | `info` | Logging level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

### Example .env File

Create a `.env` file for local development:

```bash
PORT=3000
OUTPUT_DIR=./output
API_KEY=your-super-secret-key-here
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
LOG_LEVEL=info
```

**Note**: The `.env` file is not used by default. Use it with tools like `dotenv` or set variables manually.

---

## 🔐 Authentication

ViewSarn supports **two authentication modes**:

### Mode 1: Single API Key (via environment variable)

Set the `API_KEY` environment variable:

```bash
export API_KEY=your-secret-key
```

In Docker Compose:
```yaml
environment:
  - API_KEY=your-secret-key
```

### Mode 2: Multiple API Keys (via file) ✅ Recommended

Create an `apikeys.txt` file with one key per line:

```text
# API Keys - one per line
key-user1
key-admin
key-mobile-app
# Lines starting with # are ignored
```

Mount it in Docker:
```yaml
volumes:
  - ./apikeys.txt:/app/apikeys.txt:ro
environment:
  - API_KEYS_FILE=/app/apikeys.txt
```

**Auto-reload**: The keys file is automatically reloaded every 30 seconds (configurable via `API_KEYS_RELOAD_MS`).

### Sending API Keys in Requests

Include your API key using **either** header:

**Option 1: Authorization Bearer**
```bash
curl -H "Authorization: Bearer key-abc123" ...
```

**Option 2: x-api-key header**
```bash
curl -H "x-api-key: key-abc123" ...
```

### No Authentication Mode

If **no API key is configured** (neither `API_KEY` nor `API_KEYS_FILE`), authentication is **disabled**. 

⚠️ **Warning**: Only use this in development environments. Always enable authentication in production.

---

## ⏱️ Rate Limiting

Rate limiting is applied **per API key** (or per IP if no key provided).

### Default Limits

- **120 requests** per **60 seconds** per key/IP

### Configuration

Customize via environment variables:

```yaml
environment:
  - RATE_LIMIT_MAX=100           # Max requests
  - RATE_LIMIT_WINDOW_MS=30000   # Window in milliseconds (30s)
```

### Rate Limit Headers

Every response includes:
```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 115
X-RateLimit-Reset: 45
```

### When Exceeded

**HTTP 429 Too Many Requests**
```json
{
  "error": "Rate limit exceeded",
  "retry_after_seconds": 15
}
```

Headers include:
```
Retry-After: 15
```

---

## 📡 API: POST /convert

Converts HTML into PDF or PNG.

Request (JSON)
{
  "html": "<html><body><h1>Hello</h1></body></html>",
  "options": {
    "png": false,
    "format": "A4",
    "orientation": "portrait",
    "margin": "10mm",
    "single": false,
    "scale": null,
    "dpi": 96,
    "filename": "my.pdf"
  },
  "save": false,
  "outPath": "reports/file.pdf"
}

Main Fields
Field Type Description
html string Required. Raw HTML string
options.png bool If true → PNG, else PDF
options.format A4/A5/Letter/Legal Paper size
options.orientation portrait/landscape PDF orientation
options.margin string “10mm”, “1cm”, etc
options.single bool Force single page (shrink-to-fit)
options.scale number Manual scale override (0.1–2)
options.dpi number PNG DPI (affects resolution)
save bool Save to server’s /output folder
outPath string Where to save inside /output
📤 Output Modes
A) Direct file download

If save=false (default):

Response is application/pdf or image/png

Browser downloads the generated file

B) Save to server

If save=true, response is JSON:

{
  "path": "/output/reports/invoice-2025.pdf",
  "filename": "invoice-2025.pdf",
  "size": 34555,
  "scale": 1.00,
  "contentSize": { ... }
}

Your host will have the file at:

./output/reports/invoice-2025.pdf

📘 Example Use Cases

1) Simple PDF generation
curl -X POST <http://localhost:3000/convert> \
  -H "Authorization: Bearer key-abc123" \
  -H "Content-Type: application/json" \
  -d '{
        "html":"<h1>Hello PDF</h1>",
        "options":{"format":"A4"}
      }' \
  --output hello.pdf

2) Generate PNG with DPI + single page
curl -X POST <http://localhost:3000/convert> \
  -H "x-api-key: key-admin" \
  -H "Content-Type: application/json" \
  -d '{
        "html":"<h1>Chart</h1>",
        "options":{"png":true, "dpi":150, "single":true}
      }' \
  --output chart.png

3) Save PDF into server folder structure
curl -X POST <http://localhost:3000/convert> \
  -H "Authorization: Bearer key-admin" \
  -H "Content-Type: application/json" \
  -d '{
        "html":"<h1>Invoice 2025</h1>",
        "save":true,
        "outPath":"invoices/2025/invoice-001.pdf",
        "options":{"format":"A5","orientation":"landscape"}
      }'

Output:

{
  "path": "/output/invoices/2025/invoice-001.pdf",
  "filename": "invoice-001.pdf",
  "size": 14002
}

1) Thai text rendering (Sarabun font)
curl -X POST <http://localhost:3000/convert> \
  -H "Authorization: Bearer key-abc123" \
  -H "Content-Type: application/json" \
  -d '{
        "html":"<p style=\"font-family:Sarabun;font-size:20px;\">ทดสอบ ภาษาไทย</p>"
      }' \
  --output thai.pdf

Thanks to fonts installed in the Dockerfile:

TH Sarabun New

Noto Sans (fallback)

Noto Sans Thai (from repo)

💻 Client Code Examples

### Node.js (using fetch)

```javascript
const fs = require('fs');

async function generatePdf() {
  const response = await fetch('http://localhost:3000/convert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer key-abc123' // if auth enabled
    },
    body: JSON.stringify({
      html: '<h1>Hello World</h1><p>This is a PDF.</p>',
      options: {
        format: 'A4',
        margin: '20mm'
      }
    })
  });

  if (!response.ok) throw new Error(`Error: ${response.statusText}`);

  const buffer = await response.arrayBuffer();
  fs.writeFileSync('output.pdf', Buffer.from(buffer));
  console.log('PDF saved to output.pdf');
}

generatePdf();
```

### Python (using requests)

```python
import requests

url = "http://localhost:3000/convert"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer key-abc123" # if auth enabled
}
payload = {
    "html": "<h1>Hello World</h1><p>This is a PDF.</p>",
    "options": {
        "format": "A4",
        "margin": "20mm"
    }
}

response = requests.post(url, json=payload, headers=headers)

if response.status_code == 200:
    with open("output.pdf", "wb") as f:
        f.write(response.content)
    print("PDF saved to output.pdf")
else:
    print(f"Error: {response.status_code} - {response.text}")
```

🛠 Docker Compose Example
version: "3.8"
services:
  render:
    build: .
    image: my-playwright-render:latest
    ports:
      - "3000:3000"
    environment:
      - OUTPUT_DIR=/output
      - API_KEYS_FILE=/app/apikeys.txt
      - RATE_LIMIT_MAX=120
      - RATE_LIMIT_WINDOW_MS=60000
    volumes:
      - ./output:/output
      - ./apikeys.txt:/app/apikeys.txt:ro
    shm_size: "1gb"
    restart: no

📦 Deployment Tips
For Production:

Always set API_KEYS_FILE or API_KEY

Increase RATE_LIMIT_MAX for intensive workloads

Use Nginx or Traefik in front for:

SSL/TLS termination

Request size limit

Extra rate limiting / caching

For High Throughput:

Run multiple replicas behind a proxy

Set NODE_OPTIONS=--max-old-space-size=1024 if large PDFs

Consider redis-backed shared rate limiter (I can add this)

🧪 Debug / Health

Health check endpoint:

GET /health

Example output:

{
  "ok": true,
  "pid": 24,
  "apiAuthFileInUse": true,
  "rate_limit_window_ms": 60000,
  "rate_limit_max": 120
}
