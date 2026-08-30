FROM node:22-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Install TypeScript and tsx for runtime
RUN npm install -g typescript tsx

# Create data directory
RUN mkdir -p data logs

# Expose port
EXPOSE 3001

# Health check - basic status
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/status', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Readiness check - waits for API to be fully operational
HEALTHCHECK --interval=30s --timeout=15s --start-period=45s --retries=5 \
  CMD node -e "
    const http = require('http');
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/health',
      method: 'GET',
      timeout: 10000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          process.exit(parsed.success === true ? 0 : 1);
        } catch {
          process.exit(1);
        }
      });
    });
    req.on('error', (e) => { process.exit(1); });
    req.on('timeout', () => { req.destroy(); process.exit(1); });
    req.end();
  "

# Startup probe - waits for blockchain to initialize
STARTMODE --retries=30 --interval=10s --start-period=60s \
  CMD node -e "
    const http = require('http');
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/status',
      method: 'GET',
      timeout: 5000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.blocks && parsed.blocks > 0) {
            process.exit(0);
          } else {
            process.exit(1);
          }
        } catch {
          process.exit(1);
        }
      });
    });
    req.on('error', (e) => { process.exit(1); });
    req.on('timeout', () => { req.destroy(); process.exit(1); });
    req.end();
  "

# Start the node
CMD ["npm", "run", "node"]