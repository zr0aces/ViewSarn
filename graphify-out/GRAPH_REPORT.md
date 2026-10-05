# Graph Report - ViewSarn  (2026-10-05)

## Corpus Check
- 35 files · ~33,198 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 15 file(s) not represented in the graph (top: .ttf 10, (none) 4, .1787539082 1)

## Summary
- 459 nodes · 598 edges · 22 communities (19 shown, 3 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `08713a31`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- 🏗️ ViewSarn Architecture
- ViewSarn Deployment Guide
- version-control.test.mjs
- version.test.js
- 🛠️ ViewSarn Development Guide
- 🚀 ViewSarn API Documentation
- package.json
- ViewSarn Specification
- validate.test.js
- render.js
- server.js
- auth.js
- ViewSarn Font Support
- POST /convert
- logger.js
- CLAUDE.md
- CLAUDE.md
- rateLimit.js
- test-convert.js
- convert-cli.sh
- cleanup_fonts.sh
- wrap_html.sh

## God Nodes (most connected - your core abstractions)
1. `🏗️ ViewSarn Architecture` - 14 edges
2. `🚀 ViewSarn API Documentation` - 13 edges
3. `ViewSarn Deployment Guide` - 13 edges
4. `🛠️ ViewSarn Development Guide` - 13 edges
5. `renderHtmlToBuffer()` - 11 edges
6. `release()` - 10 edges
7. `loadFreshModules()` - 10 edges
8. `CLAUDE.md` - 10 edges
9. `CLAUDE.md` - 10 edges
10. `ViewSarn Specification` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Add New Paper Size` --references--> `renderHtmlToBuffer()`  [INFERRED]
  documents/development.md → src/render.js
- `Automated Testing` --references--> `loadFreshModules()`  [INFERRED]
  documents/development.md → test/helpers.js
- `Architecture` --references--> `validateAuth()`  [INFERRED]
  GEMINI.md → src/auth.js
- `Architecture` --references--> `validateAuth()`  [INFERRED]
  AGENTS.md → src/auth.js
- `Architecture` --references--> `loadFreshModules()`  [INFERRED]
  GEMINI.md → test/helpers.js

## Import Cycles
- None detected.

## Communities (22 total, 3 thin omitted)

### Community 0 - "🏗️ ViewSarn Architecture"
Cohesion: 0.04
Nodes (46): 1. HTTP Server (Express.js), 2. Authentication Module, 3. Rate Limiting Module, 4. Rendering Engine (Playwright), 5. Logging Module, Architecture Type, Authentication, Authorization (+38 more)

### Community 1 - "ViewSarn Deployment Guide"
Cohesion: 0.04
Nodes (46): 1. Network Security, 2. API Key Management, 3. Docker Security, 3b. Capping Memory with RENDER_CONCURRENCY, 3c. Scraping Metrics, 4. Rate Limiting Best Practices, Automated Build Process, Available Tags (+38 more)

### Community 2 - "version-control.test.mjs"
Cohesion: 0.10
Nodes (38): ref_node_path, ref_node_url, main(), path, main(), path, absentGitResult(), calendar() (+30 more)

### Community 3 - "version.test.js"
Cohesion: 0.06
Nodes (32): ref_node_assert, ref_node_child_process, ref_node_fs, ref_node_module, ref_node_os, ref_node_test, assert, fs (+24 more)

### Community 4 - "🛠️ ViewSarn Development Guide"
Cohesion: 0.05
Nodes (39): Add New API Endpoint, Add New Environment Variable, Add New Paper Size, Automated Testing, Code Review Process, Code Style and Conventions, Commands, Commit Message Format (+31 more)

### Community 5 - "🚀 ViewSarn API Documentation"
Cohesion: 0.08
Nodes (25): 1. HTML Structure, 2. Performance, 3. Error Handling, 4. Security, API Versioning, Authentication, Authentication Errors, Base URL (+17 more)

### Community 6 - "package.json"
Cohesion: 0.08
Nodes (24): dependencies, express, pino, playwright, description, devDependencies, pino-pretty, engines (+16 more)

### Community 7 - "ViewSarn Specification"
Cohesion: 0.08
Nodes (18): 1. Purpose and scope, 2. Conversion, 3. Authentication, 4. Rate limiting, 5. Resource limits, 6. Security posture, 7. Operations, 8. Response codes (+10 more)

### Community 8 - "validate.test.js"
Cohesion: 0.10
Nodes (19): Key Files Explained, Project Structure, `server.js`, `src/config.js`, `src/httpErrors.js`, `src/logger.js`, `src/rateLimit.js`, `src/validate.js` (+11 more)

### Community 9 - "render.js"
Cohesion: 0.15
Nodes (21): `src/render.js`, Architecture, Architecture, num(), src_config_render_concurrency, src_config_render_queue_max, src_config_render_timeout_ms, acquireSlot() (+13 more)

### Community 10 - "server.js"
Cohesion: 0.10
Nodes (19): ref_path, { bodyErrorHandler }, crypto, express, { isRateLimitedFor }, logger, path, { PORT, OUTPUT_DIR, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, BODY_LIMIT, TRUST_PROXY, CORS_ORIGINS, METRICS_ENABLED, API_KEY_ENV, API_KEYS_FILE } (+11 more)

### Community 11 - "auth.js"
Cohesion: 0.14
Nodes (19): `src/auth.js`, ref_crypto, ref_fs, { API_KEYS_FILE, API_KEY_ENV, API_KEYS_RELOAD_MS }, apiKeyReloadTimer, apiKeySet, applyKeyFileError(), crypto (+11 more)

### Community 12 - "ViewSarn Font Support"
Cohesion: 0.14
Nodes (13): 1. **Sarabun** (Thai Font), 2. **Google Sans** (Modern Sans-Serif), 3. **Noto Sans Thai**, Checking Installed Fonts, 🎨 Installed Fonts, ⚖️ License Information, Official Thai Text, Premium English Headings (+5 more)

### Community 13 - "POST /convert"
Cohesion: 0.15
Nodes (13): Endpoints, Error Responses, Example, Examples, GET /health, Options Object, POST /convert, Request (+5 more)

### Community 14 - "logger.js"
Cohesion: 0.18
Nodes (8): ref_os, pino, src_config_is_production, src_config_log_level, os, { LOG_LEVEL, IS_PRODUCTION }, logger, pino

### Community 15 - "CLAUDE.md"
Cohesion: 0.20
Nodes (9): CI, CLAUDE.md, Commands, Conventions, Docs, Plans, Release Tooling, Release Tooling (+1 more)

### Community 16 - "CLAUDE.md"
Cohesion: 0.20
Nodes (9): CI, CLAUDE.md, Commands, Conventions, Docs, Plans, Release Tooling, Release Tooling (+1 more)

### Community 17 - "rateLimit.js"
Cohesion: 0.33
Nodes (6): src_config_rate_limit_max, src_config_rate_limit_window_ms, counters, isRateLimitedFor(), maybeSweep(), { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS }

### Community 18 - "test-convert.js"
Cohesion: 0.33
Nodes (5): ref_http, data, http, options, req

## Knowledge Gaps
- **253 isolated node(s):** `cleanup_fonts.sh script`, `name`, `version`, `private`, `description` (+248 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 288 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ok()` connect `validate.test.js` to `POST /convert`, `ViewSarn Specification`?**
  _High betweenness centrality (0.276) - this node is a cross-community bridge._
- **Why does `🛠️ ViewSarn Development Guide` connect `🛠️ ViewSarn Development Guide` to `validate.test.js`, `ViewSarn Specification`?**
  _High betweenness centrality (0.238) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `renderHtmlToBuffer()` (e.g. with `Add New Paper Size` and `Architecture`) actually correct?**
  _`renderHtmlToBuffer()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `cleanup_fonts.sh script`, `name`, `version` to the rest of the system?**
  _253 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `🏗️ ViewSarn Architecture` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._
- **Should `ViewSarn Deployment Guide` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._
- **Should `version-control.test.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10241545893719807 - nodes in this community are weakly interconnected._