#!/bin/bash

# Deploy script with automatic secrets sync
# Usage: ./scripts/deploy-with-secrets.sh [--stack-name qnyproj-api] [--first-deploy]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

# Parse arguments
STACK_NAME="qnyproj-api"
FIRST_DEPLOY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --stack-name)
      STACK_NAME="$2"
      shift 2
      ;;
    --first-deploy)
      FIRST_DEPLOY=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "=========================================="
echo "🚀 Deploy Backend with Secrets Sync"
echo "=========================================="
echo ""
echo "Stack: $STACK_NAME"
echo "First Deploy: $FIRST_DEPLOY"
echo ""

# Check if .env exists
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "❌ Error: .env file not found at $BACKEND_DIR/.env"
  echo "Please create .env file with required variables"
  exit 1
fi

cd "$BACKEND_DIR"

if [ "$FIRST_DEPLOY" = true ]; then
  echo "📝 First deployment mode:"
  echo "   1. Deploy stack with placeholder secrets"
  echo "   2. Sync real secrets after stack creation"
  echo ""
  
  # Step 1: Build
  echo "1️⃣  Building SAM application..."
  sam build --use-container
  echo ""
  
  # Step 2: Deploy with guided mode
  echo "2️⃣  Deploying to AWS (guided mode)..."
  sam deploy --guided
  echo ""
  
  # Step 3: Sync secrets
  echo "3️⃣  Syncing .env to Secrets Manager..."
  node scripts/sync-secrets.js --stack-name "$STACK_NAME"
  echo ""
else
  # Normal deployment: sync secrets first
  echo "1️⃣  Syncing .env to Secrets Manager..."
  node scripts/sync-secrets.js --stack-name "$STACK_NAME"
  echo ""
  
  # Step 2: Build SAM application
  echo "2️⃣  Building SAM application..."
  sam build --use-container
  echo ""
  
  # Step 3: Deploy to AWS
  echo "3️⃣  Deploying to AWS..."
  sam deploy --no-confirm-changeset --no-fail-on-empty-changeset
  echo ""
fi

echo "=========================================="
echo "✅ Deployment completed successfully!"
echo "=========================================="
echo ""
echo "💡 Lambda functions will read secrets from:"
echo "   Secret: $STACK_NAME-qwen-api-key"
echo "   Region: ${AWS_REGION:-us-east-1}"
echo ""
