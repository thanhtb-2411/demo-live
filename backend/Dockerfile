FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────
FROM node:20-alpine

# Cài bash để wrapper script chạy được
RUN apk add --no-cache bash

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
# Cho phép execute wrapper script
EXPOSE 3001

CMD ["node", "dist/main"]
