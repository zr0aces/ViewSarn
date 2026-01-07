# 1. Use the "slim" variant (Bookworm is current stable Debian)
ARG NODE_IMAGE=node:20-bookworm-slim
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
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
    npm ci --no-audit --no-fund --unsafe-perm=true; \
    else \
    npm install --no-audit --no-fund --unsafe-perm=true; \
    fi

# 6. Install Playwright + System Deps (The Magic Step)
# --with-deps: Installs the specific OS libraries Chromium needs
# This replaces your long manual 'apt-get install' list
RUN npx playwright install chromium --with-deps

# 7. Copy App Code
COPY --chown=www-data:www-data server.js /app/server.js
COPY --chown=www-data:www-data src /app/src

# 8. Final Setup
USER www-data
# Ensure we are in the correct directory for permissions
WORKDIR /app 
EXPOSE 3000
ENTRYPOINT ["node", "/app/server.js"]
