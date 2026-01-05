# ViewSarn Development Guide

This guide helps developers set up a local development environment, understand the codebase, and contribute to ViewSarn.

---

## Table of Contents

1. [Local Development Setup](#local-development-setup)
2. [Project Structure](#project-structure)
3. [Development Workflow](#development-workflow)
4. [Testing](#testing)
5. [Code Style and Conventions](#code-style-and-conventions)
6. [Debugging](#debugging)
7. [Contributing](#contributing)

---

## Local Development Setup

### Prerequisites

- **Node.js**: 16.x or higher (20.x recommended)
- **npm**: 8.x or higher
- **Git**: Latest version
- **Docker** (optional): For containerized development

### Option 1: Native Development

**1. Clone the repository:**
```bash
git clone https://github.com/zr0aces/ViewSarn.git
cd ViewSarn
```

**2. Install dependencies:**
```bash
npm install
```

**3. Install Playwright browsers:**
```bash
npx playwright install chromium
npx playwright install-deps  # Install system dependencies (Linux only)
```

**4. Create output directory:**
```bash
mkdir -p output
```

**5. Set up environment variables:**
```bash
export PORT=3000
export OUTPUT_DIR=./output
export API_KEY=dev-key-123
export RATE_LIMIT_MAX=1000  # Higher limit for dev
export RATE_LIMIT_WINDOW_MS=60000
export LOG_LEVEL=debug  # More verbose logging
```

Or create a `.env` file (requires `dotenv` package):
```bash
PORT=3000
OUTPUT_DIR=./output
API_KEY=dev-key-123
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW_MS=60000
LOG_LEVEL=debug
```

**6. Start the development server:**
```bash
npm start
```

**7. Verify the server is running:**
```bash
curl http://localhost:3000/health
```

### Option 2: Docker Development

**1. Build the Docker image:**
```bash
docker compose build
```

**2. Start with docker-compose:**
```bash
docker compose up
```

**3. Development with hot reload (requires code changes):**

Create `docker-compose.dev.yml`:
```yaml
version: "3.8"
services:
  viewsarn:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - OUTPUT_DIR=/output
      - API_KEY=dev-key-123
      - LOG_LEVEL=debug
    volumes:
      - ./src:/app/src
      - ./server.js:/app/server.js
      - ./output:/output
    command: node --watch server.js  # Node 18+ watch mode
```

Start with:
```bash
docker compose -f docker-compose.dev.yml up
```

---

## Project Structure

```
ViewSarn/
├── server.js              # Main entry point, Express app setup
├── src/
│   ├── config.js          # Configuration management (env vars)
│   ├── auth.js            # Authentication logic (API keys)
│   ├── rateLimit.js       # Rate limiting implementation
│   ├── render.js          # Playwright rendering engine
│   └── logger.js          # Pino logger configuration
├── fonts/                 # Font files for Docker image
│   ├── Sarabun/
│   ├── Google_Sans/
│   └── Noto_Sans_Thai/
├── documents/             # Technical documentation
│   ├── architecture.md
│   ├── api_docs.md
│   ├── deployment.md
│   └── development.md
├── Dockerfile             # Production Docker image
├── docker-compose.yml     # Docker Compose configuration
├── package.json           # Node.js dependencies
├── .gitignore             # Git ignore rules
├── convert-cli.sh         # CLI testing tool
├── test-convert.js        # Simple test script
├── example.html           # Example HTML for testing
└── README.md              # Project README

Generated/Runtime:
├── output/                # PDF/PNG output directory (gitignored)
├── apikeys.txt            # API keys file (gitignored)
└── node_modules/          # Dependencies (gitignored)
```

### Key Files Explained

#### `server.js`
Main application entry point. Sets up Express server, routes, middleware, and graceful shutdown.

**Key responsibilities:**
- Initialize browser instance
- Configure Express middleware
- Define routes (`/convert`, `/health`)
- Handle auth and rate limiting
- Implement graceful shutdown

#### `src/config.js`
Centralizes all configuration from environment variables.

**Exports:**
- `PORT` - HTTP server port
- `OUTPUT_DIR` - Directory for saved files
- `API_KEY_ENV` - Single API key (if used)
- `API_KEYS_FILE` - Path to API keys file
- `API_KEYS_RELOAD_MS` - Key reload interval
- `RATE_LIMIT_MAX` - Max requests per window
- `RATE_LIMIT_WINDOW_MS` - Rate limit window duration
- `LOG_LEVEL` - Pino log level

#### `src/auth.js`
Handles API key authentication with hot-reloading.

**Key functions:**
- `loadApiKeysFromFile()` - Loads keys from file
- `validateAuth(req)` - Validates API key from request headers
- `isAuthFileInUse()` - Checks if file-based auth is active

**Features:**
- Supports `Authorization: Bearer` and `x-api-key` headers
- Auto-reloads `apikeys.txt` every 30 seconds
- Gracefully handles missing/invalid keys

#### `src/rateLimit.js`
In-memory rate limiting using sliding window algorithm.

**Key functions:**
- `isRateLimitedFor(id)` - Checks and updates rate limit for given ID

**Implementation:**
- Uses Map to store counters per API key/IP
- Resets window when expired
- Returns remaining requests and reset time

**Limitations:**
- In-memory only (doesn't work across multiple instances)
- Lost on restart

#### `src/render.js`
Core rendering engine using Playwright.

**Key functions:**
- `initBrowser()` - Launches Chromium instance
- `closeBrowser()` - Gracefully closes browser
- `renderHtmlToBuffer(html, options)` - Main rendering function

**Rendering process:**
1. Create new browser context
2. Load HTML content
3. Wait for page to be ready
4. Calculate content size and scaling
5. Generate PDF or PNG
6. Return buffer

**Features:**
- Auto-scaling to fit paper size
- Single-page fit mode
- Custom DPI for PNG
- Margin and orientation support

#### `src/logger.js`
Structured logging with Pino.

**Configuration:**
- JSON output in production
- Pretty-printed in development
- Configurable log level
- Timestamps in standard format

---

## Development Workflow

### Making Changes

**1. Create a feature branch:**
```bash
git checkout -b feature/my-awesome-feature
```

**2. Make your changes:**
- Edit code in `src/` or `server.js`
- Add tests if applicable
- Update documentation

**3. Test locally:**
```bash
# Restart server
npm start

# Test with curl
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer dev-key-123" \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Test</h1>"}' \
  --output test.pdf

# Or use CLI tool
./convert-cli.sh --file example.html --api-key dev-key-123 --output test.pdf
```

**4. Commit changes:**
```bash
git add .
git commit -m "feat: add awesome feature"
```

**5. Push and create PR:**
```bash
git push origin feature/my-awesome-feature
```

### Common Development Tasks

#### Add New Paper Size

**Edit `src/render.js`:**
```javascript
// Add to PAPER_SIZES constant
const PAPER_SIZES = new Set(['A4', 'A5', 'LETTER', 'LEGAL', 'TABLOID']);

// Add dimensions in renderHtmlToBuffer
const paperMm = (paper === 'A5') ? { w: 148, h: 210 } :
                (paper === 'LETTER') ? { w: 216, h: 279 } :
                (paper === 'LEGAL') ? { w: 216, h: 356 } :
                (paper === 'TABLOID') ? { w: 279, h: 432 } :  // New
                { w: 210, h: 297 };
```

#### Add New Environment Variable

**1. Add to `src/config.js`:**
```javascript
module.exports = {
    // ... existing config
    MY_NEW_VAR: process.env.MY_NEW_VAR || 'default-value',
};
```

**2. Use in code:**
```javascript
const { MY_NEW_VAR } = require('./src/config');
console.log(MY_NEW_VAR);
```

**3. Document in README and docker-compose.yml**

#### Add New API Endpoint

**Edit `server.js`:**
```javascript
app.get('/my-endpoint', async (req, res) => {
    // No auth middleware here - add if needed
    try {
        // Your logic
        res.json({ success: true });
    } catch (err) {
        logger.error({ err }, 'Error in /my-endpoint');
        res.status(500).json({ error: err.message });
    }
});
```

---

## Testing

### Manual Testing

**1. Test health endpoint:**
```bash
curl http://localhost:3000/health
```

**2. Test PDF generation:**
```bash
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer dev-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Test</h1><p>This is a test PDF.</p>",
    "options": {"format": "A4"}
  }' \
  --output test.pdf
```

**3. Test PNG generation:**
```bash
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer dev-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Test Image</h1>",
    "options": {"png": true, "dpi": 150}
  }' \
  --output test.png
```

**4. Test save mode:**
```bash
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer dev-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Saved PDF</h1>",
    "save": true,
    "outPath": "test/saved.pdf"
  }'

# Check output
ls -lh output/test/saved.pdf
```

**5. Test rate limiting:**
```bash
# Send many requests quickly
for i in {1..125}; do
  curl -X POST http://localhost:3000/convert \
    -H "Authorization: Bearer dev-key-123" \
    -H "Content-Type: application/json" \
    -d '{"html":"<h1>Test</h1>"}' \
    --output /dev/null -w "%{http_code}\n"
done
```

**6. Test authentication:**
```bash
# Without API key (should fail)
curl -X POST http://localhost:3000/convert \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Test</h1>"}'

# With invalid key (should fail)
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer wrong-key" \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Test</h1>"}'
```

### Using the Test Script

```bash
# Run simple test
node test-convert.js

# Expected output:
# STATUS: 200
# Response received
# Test PASSED
```

### Using the CLI Tool

```bash
# Basic test
./convert-cli.sh --file example.html --api-key dev-key-123 --output result.pdf

# PNG with high DPI
./convert-cli.sh --file example.html --api-key dev-key-123 --png --dpi 300 --output result.png

# Landscape A5
./convert-cli.sh --file example.html --api-key dev-key-123 --format A5 --orientation landscape --output result.pdf

# Save to server
./convert-cli.sh --file example.html --api-key dev-key-123 --save --outpath test/result.pdf
```

### Automated Testing (Future)

ViewSarn doesn't currently have automated tests. To add them:

**1. Install testing framework:**
```bash
npm install --save-dev jest supertest
```

**2. Create `tests/` directory:**
```bash
mkdir tests
```

**3. Write tests:**

```javascript
// tests/api.test.js
const request = require('supertest');
const app = require('../server');  // Export app from server.js

describe('API Tests', () => {
    test('GET /health returns 200', async () => {
        const res = await request(app).get('/health');
        expect(res.statusCode).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    test('POST /convert without auth returns 401', async () => {
        const res = await request(app)
            .post('/convert')
            .send({ html: '<h1>Test</h1>' });
        expect(res.statusCode).toBe(401);
    });

    test('POST /convert with valid HTML returns PDF', async () => {
        const res = await request(app)
            .post('/convert')
            .set('Authorization', 'Bearer dev-key-123')
            .send({ html: '<h1>Test</h1>' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
    });
});
```

**4. Add to package.json:**
```json
"scripts": {
    "start": "node server.js",
    "test": "jest"
}
```

**5. Run tests:**
```bash
npm test
```

---

## Code Style and Conventions

### JavaScript Style

- **Indentation**: 4 spaces
- **Semicolons**: Required
- **Quotes**: Single quotes for strings
- **Naming**: camelCase for variables/functions, UPPER_CASE for constants
- **Async/Await**: Preferred over callbacks

**Example:**
```javascript
const myFunction = async (param1, param2) => {
    const result = await someAsyncOperation(param1);
    return { success: true, data: result };
};
```

### Error Handling

- Use try-catch for async functions
- Log errors with context
- Return appropriate HTTP status codes

**Example:**
```javascript
app.post('/endpoint', async (req, res) => {
    try {
        const result = await processRequest(req.body);
        res.json(result);
    } catch (err) {
        logger.error({ err, body: req.body }, 'Error processing request');
        res.status(500).json({ error: err.message });
    }
});
```

### Logging

- Use structured logging (objects, not strings)
- Include relevant context
- Use appropriate log levels

**Example:**
```javascript
logger.info({ userId: 123, action: 'convert' }, 'User converted document');
logger.error({ err, requestId: req.id }, 'Failed to render');
logger.debug({ html: html.length }, 'Received HTML');
```

---

## Debugging

### Enable Debug Logging

```bash
export LOG_LEVEL=debug
npm start
```

### Debug with Node Inspector

```bash
node --inspect server.js
```

Then open Chrome and navigate to `chrome://inspect`.

### Debug Playwright

```bash
# Enable Playwright debug logs
export DEBUG=pw:api
npm start
```

### Common Issues

**Issue: Browser fails to launch**
```bash
# Install missing dependencies (Linux)
npx playwright install-deps

# Check shared memory
df -h /dev/shm
```

**Issue: Font not rendering**
```bash
# Check installed fonts (Linux)
fc-list | grep -i sarabun

# Install fonts manually
sudo cp fonts/Sarabun/*.ttf /usr/local/share/fonts/
sudo fc-cache -f -v
```

**Issue: Out of memory**
```bash
# Increase Node.js memory
export NODE_OPTIONS=--max-old-space-size=4096
npm start
```

---

## Contributing

### Contribution Guidelines

1. **Fork** the repository
2. **Clone** your fork locally
3. **Create** a feature branch
4. **Make** your changes
5. **Test** thoroughly
6. **Commit** with clear messages
7. **Push** to your fork
8. **Open** a Pull Request

### Commit Message Format

Follow Conventional Commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(render): add support for Tabloid paper size

Add Tabloid (11x17 inches) as a new paper size option in the
rendering engine.

Closes #123
```

```
fix(auth): handle missing apikeys.txt gracefully

Instead of crashing, log a warning and disable authentication
when apikeys.txt is missing.
```

### Code Review Process

1. All PRs require review
2. Tests must pass (if implemented)
3. Documentation must be updated
4. Code must follow style guidelines

---

## Development Tools

### Recommended VS Code Extensions

- **ESLint** - JavaScript linting
- **Prettier** - Code formatting
- **Docker** - Docker file support
- **REST Client** - Test API endpoints
- **GitLens** - Git integration

### REST Client Example

Create `.http` file:
```http
### Health Check
GET http://localhost:3000/health

### Convert HTML to PDF
POST http://localhost:3000/convert
Authorization: Bearer dev-key-123
Content-Type: application/json

{
    "html": "<h1>Test</h1>",
    "options": {
        "format": "A4"
    }
}
```

---

## Next Steps

- Add automated tests
- Implement metrics endpoint
- Add OpenAPI/Swagger documentation
- Improve error handling
- Add request validation library (e.g., Joi, Zod)

---

## Getting Help

- **Documentation**: Check `/documents` folder
- **Issues**: Search [GitHub Issues](https://github.com/zr0aces/ViewSarn/issues)
- **Questions**: Open a discussion or issue

Happy coding! 🚀
