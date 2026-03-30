# 🖼️ ViewSarn

**The Elite HTML-to-PDF/PNG Conversion Engine**

ViewSarn is a high-performance, production-ready microservice that transforms raw HTML into high-fidelity PDF documents or crisp PNG images. Built on Playwright's Chromium engine, it ensures pixel-perfect rendering with specialized support for complex Thai typography, CSS3, and modern web layouts.

---

## ✨ Key Features

- **🎯 Precision Rendering** - Powered by Playwright Chromium for industry-leading accuracy.
- **🌐 Multilingual Excellence** - Pre-installed with optimized Thai (Sarabun, Noto) and English (Inter) fonts.
- **⚡ High Throughput** - Optimized browser instance reuse and intelligent context pooling.
- **🔒 Secure by Design** - Dual-mode API key authentication with hot-reload capabilities.
- **⏱️ Smart Rate Limiting** - Per-key and per-IP protection to ensure system stability.
- **🐳 Cloud-Ready** - Stateless architecture, fully containerized, and horizontally scalable.

---

## 🚀 Quick Start (Docker)

Get ViewSarn up and running in under 60 seconds using our pre-built images.

```bash
# 1. Create a simple configuration
cat > docker-compose.yml << EOF
version: "3.8"
services:
  viewsarn:
    image: ghcr.io/zr0aces/viewsarn:latest
    ports: ["3000:3000"]
    environment:
      - API_KEY=secret-token-here
    shm_size: "1gb"
EOF

# 2. Launch the service
docker compose up -d

# 3. Test conversion
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"html": "<h1>Hello ViewSarn</h1>"}' \
  --output result.pdf
```

---

## 📂 Documentation Suite

ViewSarn’s documentation is organized into specialized guides for different roles and requirements:

| Document | Description |
|----------|-------------|
| 🏗️ **[Architecture](documents/architecture.md)** | Deep dive into system design, components, and data flow. |
| 🚀 **[API Reference](documents/api_docs.md)** | Complete endpoint documentation, options, and client code. |
| 🐳 **[Deployment Guide](documents/deployment.md)** | Production strategies (Docker, K8s, Cloud Platforms). |
| 🛠️ **[Development Guide](documents/development.md)** | Local environment setup, testing, and contribution. |
| 🎨 **[Font Support](documents/fonts.md)** | Detailed information on typography and Thai rendering. |

---

## 🛠️ Core Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Rendering**: Playwright (Chromium)
- **Logging**: Pino (Structured JSON)
- **Infrastructure**: Docker / Kubernetes

---

## ⚖️ License

ViewSarn is released under the [MIT License](LICENSE).
Copyright © 2026.
