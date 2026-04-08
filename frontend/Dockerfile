FROM node:20-alpine AS builder

WORKDIR /app

ARG BACKEND_URL=http://localhost:3002
ENV BACKEND_URL=$BACKEND_URL

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV BACKEND_URL=http://localhost:3002

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY next.config.mjs ./

EXPOSE 3001

CMD ["npm", "start"]
