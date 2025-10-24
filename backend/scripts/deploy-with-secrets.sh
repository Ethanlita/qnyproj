#!/bin/bash

# Deploy script with automatic secrets sync
# Usage: ./scripts/deploy-with-secrets.sh [--stack-name qnyproj-api] [--first-deploy]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
DEFAULT_STAGE="dev"
AWS_REGION="${AWS_REGION:-us-east-1}"

deploy_stage() {
  local rest_api_id
  rest_api_id=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiId'].OutputValue" \
    --output text 2>/dev/null || echo "")

  if [[ -z "$rest_api_id" || "$rest_api_id" == "None" ]]; then
    echo "⚠️  Unable to determine API Gateway ID from stack outputs. Skipping stage deployment."
    return
  fi

  echo "🚀 Deploying API Gateway stage '$DEFAULT_STAGE' for RestApi $rest_api_id..."
  aws apigateway create-deployment \
    --rest-api-id "$rest_api_id" \
    --stage-name "$DEFAULT_STAGE" \
    --region "$AWS_REGION" \
    --description "Redeploy $(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null
  echo "✅ Stage deployment triggered successfully."
}

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

# Load environment variables from .env (normalize CRLF, ignore comments/blanks)
echo "📋 Loading environment variables from .env..."
set -a
while IFS= read -r line || [ -n "$line" ]; do
  # Remove trailing carriage returns for Windows compatibility
  line="${line%$'\r'}"
  # Trim leading/trailing whitespace
  line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  # Skip empty lines and comments
  if [[ -z "$line" || "$line" == \#* ]]; then
    continue
  fi
  export "$line"
done < .env
set +a
AWS_REGION="${AWS_REGION:-us-east-1}"

# Validate required Cognito variables
if [ -z "$COGNITO_USER_POOL_ID" ]; then
  echo "❌ Error: COGNITO_USER_POOL_ID not found in .env"
  echo "Please add: COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx"
  exit 1
fi

if [ -z "$APIGW_CLOUDWATCH_ROLE_ARN" ]; then
  echo "❌ Error: APIGW_CLOUDWATCH_ROLE_ARN not found in .env"
  echo "Please add: APIGW_CLOUDWATCH_ROLE_ARN=arn:aws:iam::<account>:role/YourApiGwRole"
  exit 1
fi

echo "   ✅ COGNITO_USER_POOL_ID: $COGNITO_USER_POOL_ID"
echo "   ✅ APIGW_CLOUDWATCH_ROLE_ARN: $APIGW_CLOUDWATCH_ROLE_ARN"
echo ""

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
  sam deploy --guided --parameter-overrides "MyCognitoUserPoolId=$COGNITO_USER_POOL_ID ApiGatewayCloudWatchRoleArn=$APIGW_CLOUDWATCH_ROLE_ARN"
  deploy_stage
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
  sam deploy --no-confirm-changeset --no-fail-on-empty-changeset --parameter-overrides "MyCognitoUserPoolId=$COGNITO_USER_POOL_ID ApiGatewayCloudWatchRoleArn=$APIGW_CLOUDWATCH_ROLE_ARN"
  deploy_stage
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
