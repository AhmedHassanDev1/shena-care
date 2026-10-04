FROM node:20-alpine
WORKDIR /app

# Copy package config
COPY package*.json ./
COPY apps/api/package.json ./apps/api/

# Install dependencies for the workspace
RUN npm ci

# Copy full source
COPY . .

# Build the api
RUN npm run build --workspace=api

# Generate prisma client
WORKDIR /app/apps/api
RUN npx prisma generate

EXPOSE 3001

# Run migrations and start server
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
