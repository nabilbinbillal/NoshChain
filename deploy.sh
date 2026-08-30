#!/bin/bash

# NoshChain Production Deployment Script
# This script helps deploy NoshChain in a production environment

set -e

echo "🚀 NoshChain Production Deployment"
echo "=================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Check if Docker is installed (optional)
if command -v docker &> /dev/null; then
    echo "✅ Docker is installed"
    DOCKER_AVAILABLE=true
else
    echo "⚠️  Docker is not installed. Some deployment options may not be available."
    DOCKER_AVAILABLE=false
fi

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p data logs

# Install dependencies
echo "📦 Installing dependencies..."
npm ci --only=production

# Build TypeScript (if needed)
echo "🔨 Checking TypeScript compilation..."
npm run check

# Set production environment variables
export NODE_ENV=production
export PORT=${PORT:-3001}
export DATA_FILE=${DATA_FILE:-data/blockchain.db}
export LOG_LEVEL=${LOG_LEVEL:-info}
export LOG_DIR=${LOG_DIR:-logs}
export ENABLE_WS=${ENABLE_WS:-true}
export ENABLE_RATE_LIMIT=${ENABLE_RATE_LIMIT:-true}
export DIFFICULTY=${DIFFICULTY:-3}

echo "✅ Environment configured"
echo "   NODE_ENV: $NODE_ENV"
echo "   PORT: $PORT"
echo "   DATA_FILE: $DATA_FILE"
echo "   LOG_LEVEL: $LOG_LEVEL"

# Ask deployment method
echo ""
echo "Choose deployment method:"
echo "1) Direct Node.js (development/testing)"
echo "2) Docker (recommended for production)"
echo "3) Docker Compose (multi-node network)"
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        echo "🎯 Starting NoshChain node directly..."
        npm run node
        ;;
    2)
        if [ "$DOCKER_AVAILABLE" = true ]; then
            echo "🐳 Building Docker image..."
            docker build -t noshchain:latest .
            
            echo "🚀 Starting NoshChain container..."
            docker run -d \
                --name noshchain-node \
                -p 3001:3001 \
                -v $(pwd)/data:/app/data \
                -v $(pwd)/logs:/app/logs \
                -e NODE_ENV=production \
                -e PORT=3001 \
                -e DATA_FILE=data/blockchain.db \
                -e LOG_LEVEL=info \
                noshchain:latest
            
            echo "✅ NoshChain node started in Docker container"
            echo "📊 View logs: docker logs -f noshchain-node"
            echo "🛑 Stop node: docker stop noshchain-node"
        else
            echo "❌ Docker is not available. Please install Docker first."
            exit 1
        fi
        ;;
    3)
        if [ "$DOCKER_AVAILABLE" = true ]; then
            echo "🐳 Starting multi-node network with Docker Compose..."
            docker-compose up -d
            
            echo "✅ NoshChain network started"
            echo "📊 View logs: docker-compose logs -f"
            echo "🛑 Stop network: docker-compose down"
        else
            echo "❌ Docker is not available. Please install Docker first."
            exit 1
        fi
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "🎉 Deployment complete!"
echo "📡 Node available at: http://localhost:$PORT"
echo "🔗 API documentation: http://localhost:$PORT/api/status"
echo "📈 Health check: http://localhost:$PORT/api/health"
echo "📊 Metrics: http://localhost:$PORT/api/metrics"