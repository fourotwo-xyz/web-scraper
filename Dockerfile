# ── EigenCloud Attested API ────────────────────────
#
#   Port:  8080
#
#   Build:
#     docker build -t web-scraper .
#
#   Run:
#     docker run --rm -p 8080:8080 --env-file .env web-scraper

FROM --platform=linux/amd64 node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts

COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build

EXPOSE 80
EXPOSE 443
EXPOSE 8080

CMD ["npm", "start"]
