# Dockerfile - Playwright render API with Sarabun, Noto, and Google Sans/Inter fonts
ARG NODE_IMAGE=node:20-bullseye
FROM ${NODE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV OUTPUT_DIR=/output

WORKDIR /app

# 1. Install OS packages (Playwright deps + font tools) & Download Fonts
# Combined to reduce layers and build time
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  wget ca-certificates fontconfig unzip gnupg2 \
  # Chromium dependencies
  libatk1.0-0 libatk-bridge2.0-0 libc6 libdrm2 libgbm1 libgtk-3-0 \
  libnspr4 libnss3 libx11-6 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
  libasound2 libpangocairo-1.0-0 libxss1 libxcb1 libxshmfence1 libxkbcommon0 \
  && rm -rf /var/lib/apt/lists/* \
  # Setup Font Directories
  && mkdir -p /usr/local/share/fonts/truetype/sarabun \
  /usr/local/share/fonts/truetype/noto \
  /usr/local/share/fonts/truetype/google-sans \

  # 2. Copy Fonts from Local Directory (Only essential variants)
  # Copy Google Sans fonts (Regular, Bold, Italic, BoldItalic only)
  COPY fonts/Google_Sans/static/GoogleSans-Regular.ttf /usr/local/share/fonts/truetype/google-sans/
COPY fonts/Google_Sans/static/GoogleSans-Bold.ttf /usr/local/share/fonts/truetype/google-sans/
COPY fonts/Google_Sans/static/GoogleSans-Italic.ttf /usr/local/share/fonts/truetype/google-sans/
COPY fonts/Google_Sans/static/GoogleSans-BoldItalic.ttf /usr/local/share/fonts/truetype/google-sans/

# Copy Sarabun fonts (Regular, Bold, Italic, BoldItalic only)
COPY fonts/Sarabun/Sarabun-Regular.ttf /usr/local/share/fonts/truetype/sarabun/
COPY fonts/Sarabun/Sarabun-Bold.ttf /usr/local/share/fonts/truetype/sarabun/
COPY fonts/Sarabun/Sarabun-Italic.ttf /usr/local/share/fonts/truetype/sarabun/
COPY fonts/Sarabun/Sarabun-BoldItalic.ttf /usr/local/share/fonts/truetype/sarabun/

# Copy Noto Sans Thai fonts (Regular and Bold only - no italic variants available)
COPY fonts/Noto_Sans_Thai/static/NotoSansThai-Regular.ttf /usr/local/share/fonts/truetype/noto/
COPY fonts/Noto_Sans_Thai/static/NotoSansThai-Bold.ttf /usr/local/share/fonts/truetype/noto/

# 3. Update Font Cache
RUN chmod -R a+r /usr/local/share/fonts/truetype \
  && fc-cache -f -v \
  # Prepare directories with correct permissions
  && mkdir -p ${OUTPUT_DIR} ${PLAYWRIGHT_BROWSERS_PATH} \
  && chown -R www-data:www-data ${OUTPUT_DIR} ${PLAYWRIGHT_BROWSERS_PATH}

# 4. Install Node Dependencies
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
  npm ci --no-audit --no-fund --unsafe-perm=true; \
  else \
  npm install --no-audit --no-fund --unsafe-perm=true; \
  fi

# 5. Install Playwright (Chromium Only)
# We skip install-deps because we manually installed them above
RUN npx playwright install chromium

# 6. Copy App Code (with ownership)
COPY --chown=www-data:www-data server.js /app/server.js
COPY --chown=www-data:www-data src /app/src

# 7. Final Setup
USER www-data
WORKDIR /home/www-data
EXPOSE 3000
ENTRYPOINT ["node","/app/server.js"]
