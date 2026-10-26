# 1. Use the "slim" variant (Bookworm is current stable Debian)
# node:24-bookworm-slim, pinned by digest; Dependabot proposes the bumps.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
FROM ${NODE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV OUTPUT_DIR=/output

WORKDIR /app

# 2. Install basic tools for fonts
# We do NOT manually install browser libs here anymore.
# We let Playwright handle that later.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  fontconfig \
  && rm -rf /var/lib/apt/lists/* \
  # Setup Font Directories
  && mkdir -p /usr/local/share/fonts/truetype/sarabun \
  /usr/local/share/fonts/truetype/noto \
  /usr/local/share/fonts/truetype/google-sans

# 3. Copy Fonts (Cleaned up for readability)
# Google Sans
COPY fonts/Google_Sans/static/GoogleSans-Regular.ttf \
     fonts/Google_Sans/static/GoogleSans-Bold.ttf \
     fonts/Google_Sans/static/GoogleSans-Italic.ttf \
     fonts/Google_Sans/static/GoogleSans-BoldItalic.ttf \
     /usr/local/share/fonts/truetype/google-sans/

# Sarabun
COPY fonts/Sarabun/Sarabun-Regular.ttf \
     fonts/Sarabun/Sarabun-Bold.ttf \
     fonts/Sarabun/Sarabun-Italic.ttf \
     fonts/Sarabun/Sarabun-BoldItalic.ttf \
     /usr/local/share/fonts/truetype/sarabun/

# Noto Sans Thai
COPY fonts/Noto_Sans_Thai/static/NotoSansThai-Regular.ttf \
     fonts/Noto_Sans_Thai/static/NotoSansThai-Bold.ttf \
     /usr/local/share/fonts/truetype/noto/

# 4. Update Font Cache & Prepare Dirs
RUN chmod -R a+r /usr/local/share/fonts/truetype \
  && fc-cache -f -v \
  && mkdir -p ${OUTPUT_DIR} ${PLAYWRIGHT_BROWSERS_PATH} \
  && chown -R www-data:www-data ${OUTPUT_DIR} ${PLAYWRIGHT_BROWSERS_PATH}

# 5. Install Node Dependencies
# --omit=dev: pino-pretty is a dev-only formatter; production logs stay raw JSON.
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
    npm ci --omit=dev --no-audit --no-fund --unsafe-perm=true; \
    else \
    npm install --omit=dev --no-audit --no-fund --unsafe-perm=true; \
    fi \
    && npm cache clean --force

# 6. Install Playwright + System Deps (The Magic Step)
# --with-deps: Installs the specific OS libraries Chromium needs
# This replaces your long manual 'apt-get install' list
# chromium-headless-shell is what chromium.launch({headless:true}) actually runs;
# it is a few hundred MB smaller than the full headed Chromium build.
RUN npx playwright install chromium-headless-shell --with-deps \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# 7. Copy App Code
COPY --chown=www-data:www-data server.js /app/server.js
COPY --chown=www-data:www-data src /app/src

# 8. Final Setup
USER www-data
# Ensure we are in the correct directory for permissions
WORKDIR /app 
EXPOSE 3000
# node, not curl: the slim base image has no curl. /health needs no key and
# returns 503 once Chromium has disconnected.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/app/server.js"]
