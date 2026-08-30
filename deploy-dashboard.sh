#!/bin/bash

# NoshChain Dashboard Deployment Script
# This script pushes changes to GitHub and deploys to the remote server

set -e

# Configuration
SSH_KEY="/Users/nabilbinbillal/Downloads/noshchain-node-1-key.pem"
REMOTE_USER="noshadmin"
REMOTE_HOST="20.187.145.251"
REMOTE_DIR="~/NoshChain-github"
DASHBOARD_PORT=3000
API_PORT=3001
LOG_FILE="/tmp/dash.log"

echo "🚀 Deploying NoshChain Dashboard..."

# Step 1: Commit and push to GitHub from local
echo "📤 Pushing changes to GitHub..."
git add -A
git commit -m "Update dashboard - $(date '+%Y-%m-%d %H:%M:%S')" || echo "No changes to commit"
git push origin main

# Step 2: Pull and deploy on remote server
echo "📥 Deploying to remote server..."
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "
  set -e
  echo '📥 Pulling latest changes from GitHub...'
  cd $REMOTE_DIR && git pull origin main 2>&1 | tail -2
  
  echo '🛑 Stopping existing dashboard service...'
  pkill -f 'serve public/dashboard' || true
  sleep 1
  
  echo '🚀 Starting dashboard service on port $DASHBOARD_PORT...'
  nohup npx serve public/dashboard -l $DASHBOARD_PORT > $LOG_FILE 2>&1 &
  sleep 2
  
  echo '✅ Verifying deployment...'
  curl -s http://127.0.0.1:$DASHBOARD_PORT/ | grep -o 'Premium Explorer' | head -1
  echo '✨ Dashboard deployed successfully!'
"

echo "✅ Deployment complete!"
echo "🌐 Dashboard URL: http://$REMOTE_HOST:$DASHBOARD_PORT"
echo "🔌 API URL: http://$REMOTE_HOST:$API_PORT"
