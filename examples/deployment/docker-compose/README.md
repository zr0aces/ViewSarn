# Production Docker Compose Deployment

Hardened, production-ready Docker Compose configuration running ViewSarn behind an Nginx reverse proxy on an isolated internal network.

## Architecture

- **`viewsarn`**: Runs containerized with non-root privileges, read-only rootfs, dropped capabilities, and strict CPU/memory limits. Located on private `internal` network only.
- **`nginx`**: Front-facing reverse proxy handling client buffering, timeout extension (90s for PDF rendering), and SSL termination.

## Quickstart

1. **Generate an API key:**
   ```bash
   node ../../../scripts/generate-apikey.js -f apikeys.txt -c "prod-client"
   ```

2. **Start the stack:**
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

3. **Verify service health:**
   ```bash
   curl http://localhost/health
   ```

4. **Test conversion:**
   ```bash
   curl -X POST http://localhost/convert \
     -H "Authorization: Bearer $(tail -n 1 apikeys.txt)" \
     -H "Content-Type: application/json" \
     -d '{"html":"<h1>Production Test</h1>"}' \
     --output result.pdf
   ```
