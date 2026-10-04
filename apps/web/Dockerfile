FROM node:20-alpine
WORKDIR /app

# Copy package config
COPY package*.json ./
COPY apps/web/package.json ./apps/web/

# Install dependencies for the workspace
RUN npm ci

# Copy full source
COPY . .

# Build the web app
RUN npm run build --workspace=web

WORKDIR /app/apps/web
EXPOSE 3000

CMD ["npm", "run", "start"]
