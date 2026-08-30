#!/bin/bash

# NoshChain Full Deployment Script
# This script handles complete deployment including node server and dashboard

set -e

# Configuration
SSH_KEY="/Users/nabilbinbillal/Downloads/noshchain-node-1-key.pem"
REMOTE_USER="noshadmin"
REMOTE_HOST="20.187.145.251"
REMOTE_DIR="~/NoshChain-github"
DASHBOARD_PORT=3000
API_PORT=3001
LOG_FILE="/tmp/dash.log"

echo "🚀 Full NoshChain Deployment..."

# Step 1: Commit and push to GitHub from local
echo "📤 Pushing changes to GitHub..."
git add -A
git commit -m "Update dashboard - $(date '+%Y-%m-%d %H:%M:%S')" || echo "No changes to commit"
git push origin main

# Step 2: Full deployment on remote server
echo "📥 Deploying to remote server..."
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "
  set -e
  cd $REMOTE_DIR
  
  echo '📥 Pulling latest changes from GitHub...'
  git pull origin main 2>&1 | tail -2
  
  echo '🛑 Stopping all node processes...'
  killall node 2>/dev/null || true
  sleep 3
  
  echo '🚀 Starting node server (API on port $API_PORT)...'
  nohup npm run dev > /tmp/node.log 2>&1 &
  sleep 5
  
  echo '🚀 Starting dashboard service on port $DASHBOARD_PORT...'
  nohup npx serve public/dashboard -l $DASHBOARD_PORT > $LOG_FILE 2>&1 &
  sleep 3
  
  echo '✅ Verifying API...'
  curl -s http://127.0.0.1:$API_PORT/api/status | head -c 100
  echo ''
  
  echo '✅ Verifying dashboard...'
  curl -s http://127.0.0.1:$DASHBOARD_PORT/ | grep -o 'Premium Explorer' | head -1
  echo ''
  
  echo '✨ Full deployment complete!'
"

echo "✅ Deployment complete!"
echo "🌐 Dashboard URL: http://$REMOTE_HOST:$DASHBOARD_PORT"
echo "🔌 API URL: http://$REMOTE_HOST:$API_PORT"
