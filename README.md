Playwright Render API

HTML → PDF / PNG Conversion Server
Supports: Thai fonts (Sarabun, Noto), scaling, margins, paper size, single-page fit, custom DPI, API keys, rate limiting.

✨ Features

Convert raw HTML to PDF or PNG via HTTP API (POST /convert)

Uses Playwright Chromium for accurate rendering

Thai language support via TH Sarabun New + Noto Sans installed in Docker

API Authentication:

Single key (API_KEY)

Or multiple keys via file (apikeys.txt)

Rate limiting (per API key or IP)

Save output to server-mounted directory or stream as direct response

User-configurable: paper size, orientation, margin, scale, DPI, single-page fit

Auto-reload API key file (no restart needed)

Optimized browser reuse for performance

📁 Project Structure
.
├── Dockerfile
├── docker-compose.yml
├── server.js
├── package.json
├── apikeys.txt        # optional; one key per line
└── output/            # generated PDFs/PNGs saved here (if save=true)

🚀 Quick Start

1. Build the Docker image
docker compose build

2. Create output directory
mkdir -p output

3. Add API keys (optional but recommended)

Edit apikeys.txt:

# one key per line

key-abc123
key-admin
key-mobileapp

This file is mounted into (/app/apikeys.txt) by docker-compose.

1. Start the server
docker compose up -d

2. Verify health
curl <http://localhost:3000/health>

🔐 Authentication

The server supports two authentication modes:

1. Single API key

Set environment variable:

API_KEY=changeme

1. Multiple API keys

Use apikeys.txt (preferred):

key-user1
key-user2
key-admin

Then send one of them in your request:

Header Options:
Authorization: Bearer key-user1

or

x-api-key: key-user2

If no API key is configured, authentication is disabled (DEV mode only).

⏱ Rate Limiting

Rate limit is applied per API key, or per IP if no API key provided.

Defaults:

RATE_LIMIT_MAX=120             # 120 requests
RATE_LIMIT_WINDOW_MS=60000     # per 60 seconds

Customize in docker-compose.yml:

environment:

- RATE_LIMIT_MAX=100
- RATE_LIMIT_WINDOW_MS=30000

If exceeded:

HTTP 429 Too Many Requests
Retry-After: <seconds>

📡 API: POST /convert

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
