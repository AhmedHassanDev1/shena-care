#!/bin/bash

set -e

echo "🚀 Setting up Shena Care Platform..."
echo ""

# Check for PostgreSQL
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed or not in PATH"
    echo "Please install PostgreSQL 14+ before continuing"
    exit 1
fi

# Check if database exists
echo "📦 Checking PostgreSQL database..."
if psql -lqt | cut -d \| -f 1 | grep -qw shenacare; then
    echo "✅ Database 'shenacare' already exists"
else
    echo "Creating database 'shenacare'..."
    createdb shenacare || {
        echo "❌ Failed to create database. Please create it manually:"
        echo "   createdb shenacare"
        exit 1
    }
    echo "✅ Database created"
fi

# Install dependencies
echo ""
echo "📥 Installing dependencies..."
npm install

# Run migrations
echo ""
echo "🗄️  Running database migrations..."
cd apps/api
npm run migration:run

# Seed database
echo ""
echo "🌱 Seeding database with demo data..."
npm run seed

echo ""
echo "✅ Setup complete!"
echo ""
echo "🎯 Next steps:"
echo "   1. Start the API:      cd apps/api && npm run dev"
echo "   2. Start the frontend: cd apps/web && npm run dev"
echo "   3. Visit:              http://localhost:3000"
echo ""
echo "📚 See README.md for more information"
