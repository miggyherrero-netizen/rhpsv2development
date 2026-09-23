# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY next.config.ts ./
COPY postcss.config.mjs ./
COPY eslint.config.mjs ./

# Install all dependencies
RUN npm install

# Copy source
COPY src ./src
COPY public ./public
COPY drizzle.config.ts ./

# Build with dummy DATABASE_URL (required for build but unused at runtime)
ARG DATABASE_URL=postgresql://localhost/dummy
RUN DATABASE_URL=$DATABASE_URL npm run build

# Runtime stage
FROM node:22-alpine

WORKDIR /app

# Copy package.json for production install
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy built app from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle.config.ts ./
COPY init-db.sh ./

RUN chmod +x init-db.sh

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)});"

CMD ["./init-db.sh"]
