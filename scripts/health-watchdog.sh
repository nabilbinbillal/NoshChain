#!/bin/bash
set -e
for port in 3001 3000; do
  if ! timeout 5 curl -s http://127.0.0.1:$port/api/status 2>&1 | grep -q '"blocks"'; then
    echo "$(date): API $port failed, restarting"
    if [ "$port" = "3001" ]; then
      pm2 restart noshchain-node1 2>&1 | tail -1
      pm2 restart noshchain-node2 2>&1 | tail -1
    else
      pm2 restart dashboard 2>&1 | tail -1
      # fallback: ensure proxy running
      if ! pm2 list | grep -q dashboard; then
        nohup node /tmp/proxy.js > /tmp/proxy.log 2>&1 &
      fi
    fi
  else
    echo "$(date): API $port OK blocks $(curl -s http://127.0.0.1:$port/api/status 2>&1 | grep -o '"blocks":[0-9]*' | head -1)"
  fi
done
# Ensure PM2 processes are online
for proc in noshchain-node1 noshchain-node2 dashboard noshchain-activity; do
  if ! pm2 list | grep -q "$proc.*online"; then
    echo "$(date): $proc not online, restarting"
    pm2 restart $proc 2>&1 | tail -1 || pm2 start /tmp/proxy.js --name dashboard 2>&1 | tail -1
  fi
done
