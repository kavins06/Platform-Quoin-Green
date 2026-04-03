#!/bin/bash
set -euo pipefail

echo "=== Deploying Quoin Staging ==="

cd /home/ec2-user/quoin

# Pull latest code
git pull origin main

# Build and restart containers
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d

# Run database migrations
docker-compose -f docker-compose.prod.yml exec app npx prisma migrate deploy

echo "=== Deploy complete ==="
echo "App: https://staging.quoin.dev"
echo "Health: https://staging.quoin.dev/api/health"
