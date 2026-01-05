# ViewSarn Architecture

## System Overview

ViewSarn is a **monolithic containerized application** that provides HTML-to-PDF/PNG conversion as a service. The architecture is designed for simplicity, reliability, and ease of deployment.

---

## Architecture Type

**Monolithic Architecture with Containerization**

- **Single Application**: All functionality contained in one Node.js process
- **Docker-based**: Fully containerized for consistent deployment
- **Stateless Design**: No persistent database; optional file storage
- **Horizontally Scalable**: Can run multiple instances behind a load balancer

---

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Client Applications                  │
│                                                               │
│  Web Apps │ Mobile Apps │ Backend Services │ CLI Tools       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTP/HTTPS
                         │ (POST /convert, GET /health)
                         │
          ┌──────────────▼──────────────────┐
          │     Reverse Proxy (Optional)     │
          │   Nginx / Traefik / HAProxy     │
          │                                  │
          │  • SSL/TLS Termination          │
          │  • Rate Limiting                │
          │  • Load Balancing               │
          └──────────────┬──────────────────┘
                         │
                         │
          ┌──────────────▼──────────────────┐
          │       ViewSarn Container         │
          │                                  │
          │  ┌────────────────────────────┐ │
          │  │   Express.js HTTP Server   │ │
          │  │                            │ │
          │  │  • API Routing             │ │
          │  │  • Auth Middleware         │ │
          │  │  • Rate Limit Middleware   │ │
          │  └──────────┬─────────────────┘ │
          │             │                    │
          │  ┌──────────▼─────────────────┐ │
          │  │   Business Logic Layer     │ │
          │  │                            │ │
          │  │  • Config (config.js)      │ │
          │  │  • Auth (auth.js)          │ │
          │  │  • Rate Limiter            │ │
          │  │  • Renderer (render.js)    │ │
          │  │  • Logger (pino)           │ │
          │  └──────────┬─────────────────┘ │
          │             │                    │
          │  ┌──────────▼─────────────────┐ │
          │  │  Playwright + Chromium     │ │
          │  │                            │ │
          │  │  • Browser Instance        │ │
          │  │  • Page Context Pool       │ │
          │  │  • PDF/PNG Rendering       │ │
          │  └────────────────────────────┘ │
          │                                  │
          └──────┬──────────────────┬────────┘
                 │                  │
    ┌────────────▼─────┐   ┌───────▼────────────┐
    │  Mounted Volume  │   │  API Keys File     │
    │   /output        │   │  apikeys.txt (ro)  │
    │                  │   │                    │
    │  Saved PDFs/PNGs │   │  Auto-reload       │
    └──────────────────┘   └────────────────────┘
```

---

## Component Details

### 1. HTTP Server (Express.js)

**Responsibilities:**
- Handle incoming HTTP requests
- Route requests to appropriate handlers
- Apply middleware (auth, rate limiting)
- Send responses (binary files or JSON)

**Key Files:**
- `server.js` - Main server setup and routing
- `src/config.js` - Configuration management

**Endpoints:**
- `POST /convert` - Convert HTML to PDF/PNG
- `GET /health` - Health check

### 2. Authentication Module

**Responsibilities:**
- Validate API keys from request headers
- Support single key or multiple keys via file
- Auto-reload API keys without restart

**Key Files:**
- `src/auth.js`

**Features:**
- Bearer token or x-api-key header support
- File-based key management with hot reload
- Optional: no-auth mode for development

### 3. Rate Limiting Module

**Responsibilities:**
- Track request counts per API key or IP
- Enforce rate limits with sliding windows
- Return 429 status when exceeded

**Key Files:**
- `src/rateLimit.js`

**Implementation:**
- In-memory counter map
- Per-key or per-IP tracking
- Configurable window and max requests

### 4. Rendering Engine (Playwright)

**Responsibilities:**
- Launch and manage Chromium browser
- Create page contexts for rendering
- Convert HTML to PDF or PNG
- Apply styling, scaling, and formatting

**Key Files:**
- `src/render.js`

**Features:**
- Browser instance reuse for performance
- Configurable paper size, orientation, margins
- Single-page fit mode
- Custom DPI for PNG output
- Font support (Sarabun, Google Sans, Noto)

### 5. Logging Module

**Responsibilities:**
- Structured logging with Pino
- Request/response logging
- Error tracking

**Key Files:**
- `src/logger.js`

**Features:**
- JSON-formatted logs
- Configurable log levels
- Pretty printing for development

---

## Data Flow

### Request Processing Flow

```
1. Client sends POST /convert request
   ↓
2. Express receives request
   ↓
3. Auth Middleware validates API key
   ↓ (401 if invalid)
   ↓
4. Rate Limit Middleware checks limits
   ↓ (429 if exceeded)
   ↓
5. Parse request body (HTML + options)
   ↓ (400 if invalid)
   ↓
6. Pass to Renderer
   ↓
7. Renderer creates browser context
   ↓
8. Load HTML content into page
   ↓
9. Wait for page to load (networkidle)
   ↓
10. Calculate scaling and dimensions
    ↓
11. Generate PDF or PNG
    ↓
12. Return buffer
    ↓
13. Server response:
    - If save=false: Stream binary to client
    - If save=true: Save to /output, return JSON
    ↓
14. Log request completion
```

---

## Deployment Strategies

### Single Instance Deployment

**Use Case:** Small to medium workloads, development, testing

```yaml
services:
  viewsarn:
    image: viewsarn:latest
    ports:
      - "3000:3000"
    volumes:
      - ./output:/output
```

**Pros:**
- Simple setup
- Low resource usage
- Easy debugging

**Cons:**
- Single point of failure
- Limited throughput
- No high availability

### Multi-Instance Deployment (Horizontal Scaling)

**Use Case:** High traffic, production environments

```yaml
services:
  viewsarn:
    image: viewsarn:latest
    deploy:
      replicas: 3
    ports:
      - "3000"
  
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
```

**Pros:**
- High availability
- Load distribution
- Better performance

**Cons:**
- Shared storage needed for `/output`
- More complex setup
- Higher resource usage

### Kubernetes Deployment

**Use Case:** Enterprise, cloud-native, auto-scaling

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: viewsarn
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: viewsarn
        image: viewsarn:latest
        resources:
          limits:
            memory: "2Gi"
            cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: viewsarn
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 3000
```

**Pros:**
- Auto-scaling
- Self-healing
- Rolling updates
- Service discovery

**Cons:**
- Kubernetes expertise required
- Higher complexity
- More overhead

---

## Containerization Strategy

### Docker Image Structure

**Base Image:** `node:20-bullseye`

**Layers:**
1. System dependencies (Chromium dependencies)
2. Font installation (Sarabun, Google Sans, Noto)
3. Node.js dependencies
4. Playwright browser installation
5. Application code

**Optimization:**
- Multi-stage builds not used (single-stage for simplicity)
- Font files copied from local directory (not downloaded)
- `npm ci` for reproducible builds
- Runs as `www-data` user (non-root)

### Volume Mounts

- **`/output`** - For saved PDF/PNG files (writable)
- **`/app/apikeys.txt`** - API keys file (read-only)

### Resource Requirements

**Minimum:**
- CPU: 0.5 cores
- Memory: 512MB
- Shared Memory: 512MB

**Recommended:**
- CPU: 1 core
- Memory: 2GB
- Shared Memory: 1GB

**Note:** Chromium requires shared memory (`shm_size`) for rendering.

---

## Security Architecture

### Authentication

- API key-based (no OAuth, JWT, etc.)
- Keys stored in file or environment variable
- Keys transmitted via HTTP headers
- No built-in encryption (use HTTPS via reverse proxy)

### Authorization

- No role-based access control
- All valid keys have full access
- Rate limiting provides basic DoS protection

### Network Security

- No SSL/TLS in application (delegate to reverse proxy)
- No IP whitelisting (use firewall or proxy)
- CORS not configured (add if needed)

### Input Validation

- HTML content accepted as-is (no sanitization)
- File paths sanitized to prevent directory traversal
- Request size limited by Express (`15MB` default)

### Recommendations

1. **Always use HTTPS in production** (via nginx/traefik)
2. **Restrict network access** (firewall, VPC)
3. **Rotate API keys regularly**
4. **Monitor for abuse** (rate limit hits, errors)
5. **Keep dependencies updated** (security patches)

---

## Performance Characteristics

### Browser Instance Management

- **Single browser instance** shared across all requests
- **New context per request** for isolation
- **Context closed after rendering** to free memory

### Concurrency

- **Node.js single-threaded** but asynchronous
- **Multiple requests processed concurrently**
- **Chromium handles parallelism internally**

### Bottlenecks

1. **Browser launch time** - Mitigated by reusing instance
2. **Page load time** - Depends on HTML complexity
3. **Memory usage** - Chromium can be memory-intensive
4. **CPU for rendering** - Heavy for complex pages

### Optimization Tips

1. **Keep HTML simple** - Reduce render time
2. **Optimize images** - Use compressed formats
3. **Limit concurrent requests** - Adjust rate limits
4. **Scale horizontally** - Add more replicas
5. **Use caching** - Cache generated PDFs if possible

---

## Monitoring and Observability

### Health Checks

- **Endpoint:** `GET /health`
- **Response:** JSON with status, PID, config
- **Use for:** Load balancer health checks, uptime monitoring

### Logs

- **Format:** JSON (structured logging via Pino)
- **Output:** stdout/stderr
- **Includes:** Request details, errors, performance metrics

### Metrics to Monitor

- **Request rate** - Requests per second
- **Response time** - p50, p95, p99 latencies
- **Error rate** - 4xx and 5xx responses
- **Memory usage** - Container memory consumption
- **CPU usage** - Container CPU utilization
- **Rate limit hits** - 429 responses

### Recommended Tools

- **Logs:** Fluentd, Logstash, CloudWatch Logs
- **Metrics:** Prometheus, Datadog, New Relic
- **Tracing:** OpenTelemetry (not implemented)
- **Uptime:** UptimeRobot, Pingdom

---

## Technology Decisions and Rationale

### Why Playwright?

- **Accurate rendering** - Uses real Chromium
- **Modern API** - Better than Puppeteer for complex scenarios
- **Active development** - Well-maintained by Microsoft
- **Built-in PDF support** - No external tools needed

### Why Express?

- **Simple and mature** - Industry standard
- **Middleware ecosystem** - Easy to extend
- **Performance** - Fast enough for this use case
- **Developer familiarity** - Low learning curve

### Why Docker?

- **Consistency** - Same environment everywhere
- **Isolation** - Self-contained with fonts and browser
- **Portability** - Run anywhere Docker runs
- **Easy deployment** - Single command to start

### Why In-Memory Rate Limiting?

- **Simplicity** - No external dependencies
- **Low latency** - Fast lookups
- **Good enough** - For single-instance deployments

**Limitation:** Doesn't work across multiple instances. Use Redis for distributed rate limiting.

### Why No Database?

- **Stateless design** - No persistent data needed
- **Simplicity** - Reduces complexity
- **Scalability** - Easier to scale horizontally

**Future:** Could add database for audit logs, user management, etc.

---

## Future Architecture Considerations

### Potential Enhancements

1. **Distributed Rate Limiting**
   - Use Redis to share rate limit state across instances

2. **Job Queue**
   - Add Bull/BullMQ for async processing of large batches

3. **Caching Layer**
   - Cache generated PDFs (Redis/Memcached)
   - Reduce redundant rendering

4. **Microservices Split**
   - Separate auth service
   - Separate rendering service
   - API gateway

5. **Webhook Support**
   - Async conversion with callback URL
   - Better for long-running conversions

6. **Storage Abstraction**
   - Support S3, Azure Blob, Google Cloud Storage
   - Not just local filesystem

---

## Conclusion

ViewSarn's architecture prioritizes **simplicity, reliability, and ease of deployment**. The monolithic containerized design is well-suited for most use cases, from development to production.

For high-scale deployments, consider:
- Horizontal scaling with load balancer
- Distributed rate limiting
- Shared storage (NFS, S3)
- Advanced monitoring and alerting

The architecture is designed to be extended as needs grow, while maintaining the core simplicity that makes it easy to understand and maintain.
