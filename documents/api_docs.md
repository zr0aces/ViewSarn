# ViewSarn API Documentation

Complete API reference for the ViewSarn HTML-to-PDF/PNG conversion service.

---

## Base URL

```
http://localhost:3000
```

Replace with your actual deployment URL in production.

---

## Authentication

All API endpoints (except `/health`) require authentication via API key.

### Methods

**Option 1: Authorization Header (Bearer Token)**
```http
Authorization: Bearer your-api-key-here
```

**Option 2: Custom Header**
```http
x-api-key: your-api-key-here
```

### Authentication Errors

**401 Unauthorized** - Invalid or missing API key
```json
{
  "error": "Unauthorized"
}
```

Response Headers:
```
WWW-Authenticate: Bearer realm="PlaywrightRender"
```

---

## Rate Limiting

All authenticated endpoints are subject to rate limiting.

### Default Limits

- **120 requests** per **60 seconds** per API key (or IP if no key)

### Rate Limit Headers

Every response includes:
```http
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 115
X-RateLimit-Reset: 45
```

- `X-RateLimit-Limit` - Maximum requests allowed per window
- `X-RateLimit-Remaining` - Requests remaining in current window
- `X-RateLimit-Reset` - Seconds until the window resets

### Rate Limit Exceeded

**429 Too Many Requests**
```json
{
  "error": "Rate limit exceeded",
  "retry_after_seconds": 15
}
```

Response Headers:
```http
Retry-After: 15
```

---

## Endpoints

### POST /convert

Convert HTML content to PDF or PNG.

#### Request

**URL:** `POST /convert`

**Headers:**
```http
Content-Type: application/json
Authorization: Bearer your-api-key
```

**Body:**
```json
{
  "html": "<html><body><h1>Hello World</h1></body></html>",
  "options": {
    "png": false,
    "format": "A4",
    "orientation": "portrait",
    "margin": "10mm",
    "single": false,
    "scale": null,
    "dpi": 96,
    "filename": "output.pdf"
  },
  "save": false,
  "outPath": "reports/document.pdf"
}
```

#### Request Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `html` | string | ✅ Yes | - | Raw HTML content to render. Can include inline CSS and JavaScript. |
| `options` | object | No | `{}` | Rendering options (see below) |
| `save` | boolean | No | `false` | If `true`, save file to server's `/output` directory instead of streaming |
| `outPath` | string | No | `null` | Relative path within `/output` where file should be saved (only when `save=true`) |

#### Options Object

| Option | Type | Default | Valid Values | Description |
|--------|------|---------|--------------|-------------|
| `png` | boolean | `false` | `true`, `false` | If `true`, output PNG image; otherwise output PDF |
| `format` | string | `"A4"` | `A4`, `A5`, `Letter`, `Legal` | Paper size (case-insensitive) |
| `orientation` | string | `"portrait"` | `portrait`, `landscape` | Page orientation |
| `margin` | string | `"10mm"` | e.g., `"10mm"`, `"1cm"`, `"0.5in"` | Page margins (supports mm, cm, in, px) |
| `single` | boolean | `false` | `true`, `false` | Force content to fit on single page (shrink-to-fit) |
| `scale` | number\|null | `null` | `0.1` to `2.0` or `null` | Manual scale override. If `null`, scale is auto-calculated |
| `dpi` | number | `96` | Any positive number | PNG resolution in DPI (affects PNG output only) |
| `filename` | string\|null | `null` | Any valid filename | Suggested filename for download or save |

#### Response (Stream Mode - save=false)

When `save=false` (default), the PDF or PNG is streamed directly to the client.

**Status:** `200 OK`

**Headers:**
```http
Content-Type: application/pdf
Content-Length: 45623
Content-Disposition: attachment; filename="output-1704461234567.pdf"
```

Or for PNG:
```http
Content-Type: image/png
Content-Length: 123456
Content-Disposition: attachment; filename="output-1704461234567.png"
```

**Body:** Binary PDF or PNG data

#### Response (Save Mode - save=true)

When `save=true`, the file is saved to the server and metadata is returned.

**Status:** `200 OK`

**Headers:**
```http
Content-Type: application/json
```

**Body:**
```json
{
  "path": "/output/reports/document.pdf",
  "filename": "document.pdf",
  "size": 45623,
  "scale": 1.0,
  "contentSize": {
    "width": 794,
    "height": 1123
  },
  "paper": "A4",
  "orientation": "portrait"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Absolute path on server where file was saved |
| `filename` | string | Name of the saved file |
| `size` | number | File size in bytes |
| `scale` | number | Scale factor applied during rendering |
| `contentSize` | object | Original content dimensions in pixels |
| `contentSize.width` | number | Content width in pixels |
| `contentSize.height` | number | Content height in pixels |
| `paper` | string | Paper format used |
| `orientation` | string | Page orientation used |

#### Error Responses

**400 Bad Request** - Invalid request

```json
{
  "error": "Missing \"html\" (string)"
}
```

Common causes:
- Missing or empty `html` field
- `html` is not a string
- Invalid JSON in request body

**401 Unauthorized** - Authentication failed

```json
{
  "error": "Unauthorized"
}
```

**429 Too Many Requests** - Rate limit exceeded

```json
{
  "error": "Rate limit exceeded",
  "retry_after_seconds": 15
}
```

**500 Internal Server Error** - Rendering failed

```json
{
  "error": "Page crashed!"
}
```

Or:
```json
{
  "error": "Timeout waiting for page load"
}
```

Common causes:
- HTML contains errors that crash Chromium
- Page load timeout (>60s)
- Out of memory
- Invalid CSS/JavaScript

#### Examples

**Example 1: Simple PDF Generation**

```bash
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer key-abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Hello World</h1><p>This is a test PDF.</p>"
  }' \
  --output output.pdf
```

**Example 2: A4 Landscape PDF with Custom Margins**

```bash
curl -X POST http://localhost:3000/convert \
  -H "x-api-key: key-admin" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Invoice</h1><table><tr><td>Item</td><td>Price</td></tr></table>",
    "options": {
      "format": "A4",
      "orientation": "landscape",
      "margin": "20mm"
    }
  }' \
  --output invoice.pdf
```

**Example 3: High-DPI PNG Image**

```bash
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer key-abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Chart</h1><div style=\"width:800px;height:600px;background:#f0f0f0;\">Chart Content</div>",
    "options": {
      "png": true,
      "dpi": 300,
      "single": true
    }
  }' \
  --output chart.png
```

**Example 4: Save to Server Directory**

```bash
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer key-admin" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Report 2025-01</h1><p>Monthly report content...</p>",
    "save": true,
    "outPath": "reports/2025/january.pdf",
    "options": {
      "format": "Letter",
      "margin": "1in"
    }
  }'
```

Response:
```json
{
  "path": "/output/reports/2025/january.pdf",
  "filename": "january.pdf",
  "size": 34567,
  "scale": 1.0,
  "contentSize": {
    "width": 816,
    "height": 1056
  },
  "paper": "LETTER",
  "orientation": "portrait"
}
```

**Example 5: Single-Page Fit (Shrink to Fit)**

```bash
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer key-abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<div style=\"height:2000px;\">Very tall content that should fit on one page</div>",
    "options": {
      "format": "A4",
      "single": true
    }
  }' \
  --output shrink-to-fit.pdf
```

**Example 6: Thai Language Content**

```bash
curl -X POST http://localhost:3000/convert \
  -H "Authorization: Bearer key-abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<html><head><style>body{font-family:\"Sarabun\";font-size:18px;}</style></head><body><h1>ใบเสร็จรับเงิน</h1><p>รายการสินค้า: ...</p></body></html>",
    "options": {
      "format": "A4",
      "margin": "15mm"
    }
  }' \
  --output receipt-thai.pdf
```

---

### GET /health

Health check endpoint for monitoring and load balancer health checks.

#### Request

**URL:** `GET /health`

**Headers:** None required (no authentication needed)

#### Response

**Status:** `200 OK`

**Headers:**
```http
Content-Type: application/json
```

**Body:**
```json
{
  "ok": true,
  "pid": 24,
  "apiAuthFileInUse": true,
  "rate_limit_window_ms": 60000,
  "rate_limit_max": 120
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `true` if server is running |
| `pid` | number | Process ID of the Node.js process |
| `apiAuthFileInUse` | boolean | `true` if using API keys file, `false` if single key or no auth |
| `rate_limit_window_ms` | number | Rate limit window in milliseconds |
| `rate_limit_max` | number | Maximum requests per window |

#### Example

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "ok": true,
  "pid": 42,
  "apiAuthFileInUse": true,
  "rate_limit_window_ms": 60000,
  "rate_limit_max": 120
}
```

---

## Common Use Cases

### Use Case 1: Invoice Generation

Generate professional invoices from HTML templates.

```javascript
const invoice = {
  number: "INV-2025-001",
  date: "2025-01-05",
  customer: "Acme Corp",
  items: [
    { description: "Service A", quantity: 10, price: 50.00 },
    { description: "Service B", quantity: 5, price: 100.00 }
  ],
  total: 1000.00
};

const html = `
  <html>
    <head>
      <style>
        body { font-family: 'Sarabun', Arial, sans-serif; margin: 20mm; }
        h1 { color: #333; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .total { font-weight: bold; font-size: 1.2em; text-align: right; }
      </style>
    </head>
    <body>
      <h1>Invoice ${invoice.number}</h1>
      <p><strong>Date:</strong> ${invoice.date}</p>
      <p><strong>Customer:</strong> ${invoice.customer}</p>
      
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Quantity</th>
            <th>Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.items.map(item => `
            <tr>
              <td>${item.description}</td>
              <td>${item.quantity}</td>
              <td>$${item.price.toFixed(2)}</td>
              <td>$${(item.quantity * item.price).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
      <p class="total">Total: $${invoice.total.toFixed(2)}</p>
    </body>
  </html>
`;

const response = await fetch('http://localhost:3000/convert', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer key-abc123'
  },
  body: JSON.stringify({
    html: html,
    options: {
      format: 'A4',
      margin: '20mm',
      filename: `invoice-${invoice.number}.pdf`
    },
    save: true,
    outPath: `invoices/${new Date().getFullYear()}/${invoice.number}.pdf`
  })
});

const result = await response.json();
console.log('Invoice saved:', result.path);
```

### Use Case 2: Report Generation with Charts

Generate reports with embedded charts (using Chart.js or similar).

```javascript
const html = `
  <html>
    <head>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        body { font-family: Arial; margin: 20px; }
        .chart-container { width: 600px; height: 400px; }
      </style>
    </head>
    <body>
      <h1>Sales Report - Q1 2025</h1>
      <div class="chart-container">
        <canvas id="salesChart"></canvas>
      </div>
      <script>
        const ctx = document.getElementById('salesChart').getContext('2d');
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ['Jan', 'Feb', 'Mar'],
            datasets: [{
              label: 'Sales',
              data: [12000, 19000, 15000],
              backgroundColor: 'rgba(54, 162, 235, 0.5)'
            }]
          }
        });
      </script>
    </body>
  </html>
`;

// Note: Add a delay to ensure chart renders before PDF generation
// Or wait for specific element to be visible
```

### Use Case 3: Certificate Generation

Generate printable certificates for users.

```javascript
const html = `
  <html>
    <head>
      <style>
        body {
          font-family: 'Georgia', serif;
          text-align: center;
          padding: 50px;
          border: 20px solid #d4af37;
          margin: 20mm;
        }
        h1 { font-size: 48px; color: #333; }
        .recipient { font-size: 36px; font-weight: bold; color: #d4af37; margin: 30px 0; }
        .description { font-size: 20px; margin: 20px 0; }
        .signature { margin-top: 60px; }
      </style>
    </head>
    <body>
      <h1>Certificate of Completion</h1>
      <p class="description">This certifies that</p>
      <p class="recipient">John Doe</p>
      <p class="description">has successfully completed the course</p>
      <p class="recipient">Advanced Web Development</p>
      <p class="description">on January 5, 2025</p>
      <div class="signature">
        <p>_______________________</p>
        <p>Instructor Signature</p>
      </div>
    </body>
  </html>
`;

const response = await fetch('http://localhost:3000/convert', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer key-abc123'
  },
  body: JSON.stringify({
    html: html,
    options: {
      format: 'A4',
      orientation: 'landscape',
      margin: '0mm'
    }
  })
});

const pdfBlob = await response.blob();
// Download or display the certificate
```

---

## Best Practices

### 1. HTML Structure

- **Include complete HTML**: Use `<html>`, `<head>`, and `<body>` tags
- **Inline CSS**: Embed styles in `<style>` tags or inline styles
- **Specify fonts**: Use font-family in CSS to ensure consistent rendering
- **Optimize images**: Use compressed images to reduce render time

### 2. Performance

- **Keep HTML simple**: Complex layouts increase render time
- **Avoid external resources**: External fonts/scripts may slow down rendering
- **Use caching**: Cache generated PDFs if the HTML doesn't change
- **Batch requests**: Process multiple documents asynchronously

### 3. Error Handling

- **Handle 429 errors**: Implement exponential backoff for rate limit errors
- **Retry transient errors**: Retry 500 errors with exponential backoff
- **Validate HTML**: Test HTML locally before sending to API
- **Set timeouts**: Configure client-side timeouts (60s+ recommended)

### 4. Security

- **Use HTTPS**: Always use HTTPS in production
- **Protect API keys**: Never commit keys to version control
- **Sanitize user input**: If accepting HTML from users, sanitize it
- **Validate file paths**: If using `save=true`, validate `outPath`

---

## Troubleshooting

### Common Issues

**Issue: 401 Unauthorized**
- **Cause**: Missing or invalid API key
- **Solution**: Check that API key is correct and matches `apikeys.txt` or `API_KEY` env var

**Issue: 429 Rate Limit Exceeded**
- **Cause**: Too many requests in short time
- **Solution**: Implement rate limiting on client side, or increase `RATE_LIMIT_MAX`

**Issue: 500 Internal Server Error**
- **Cause**: HTML crashes Chromium or causes timeout
- **Solution**: Simplify HTML, remove problematic JavaScript, check logs

**Issue: PDF is blank**
- **Cause**: HTML not fully loaded before rendering
- **Solution**: Ensure resources load quickly, or add explicit wait in HTML

**Issue: Fonts not rendering correctly**
- **Cause**: Font not available in container
- **Solution**: Use installed fonts (Sarabun, Google Sans, Noto) or embed fonts

**Issue: PNG has low resolution**
- **Cause**: Default DPI is 96
- **Solution**: Increase `dpi` option (e.g., 150, 300)

---

## API Versioning

**Current Version:** v1 (implicit)

This API does not currently use explicit versioning in the URL. Breaking changes will be announced in advance.

---

## Support

For issues or questions:
- Check [GitHub Issues](https://github.com/zr0aces/ViewSarn/issues)
- Review [documentation](../documents/)
- Open a new issue with detailed information
