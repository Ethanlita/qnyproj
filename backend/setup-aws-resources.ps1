# Quick setup script to create AWS resources manually
# Run this if IAM permissions are insufficient

Write-Host "`n[AWS RESOURCE SETUP]" -ForegroundColor Cyan
Write-Host "Creating resources for qnyproj-api...`n" -ForegroundColor Yellow

$Region = "us-east-1"
$AccountId = "296821242554"

# 1. Create SQS Dead Letter Queue
Write-Host "[1/5] Creating SQS Dead Letter Queue..." -ForegroundColor Yellow
try {
    aws sqs create-queue `
        --queue-name qnyproj-api-analysis-dlq `
        --attributes MessageRetentionPeriod=1209600 `
        --region $Region 2>&1 | Out-Null
    Write-Host "      ✓ DLQ created" -ForegroundColor Green
} catch {
    Write-Host "      ! DLQ may already exist or permission denied" -ForegroundColor Yellow
}

# 2. Get DLQ ARN and create main queue
Write-Host "[2/5] Creating SQS Analysis Queue..." -ForegroundColor Yellow
try {
    $DlqUrl = "https://sqs.$Region.amazonaws.com/$AccountId/qnyproj-api-analysis-dlq"
    $DlqArn = aws sqs get-queue-attributes `
        --queue-url $DlqUrl `
        --attribute-names QueueArn `
        --query 'Attributes.QueueArn' `
        --output text `
        --region $Region
    
    $RedrivePolicy = "{`"deadLetterTargetArn`":`"$DlqArn`",`"maxReceiveCount`":3}"
    
    aws sqs create-queue `
        --queue-name qnyproj-api-analysis-queue `
        --attributes "VisibilityTimeout=900,MessageRetentionPeriod=1209600,ReceiveMessageWaitTimeSeconds=20,RedrivePolicy=$RedrivePolicy" `
        --region $Region 2>&1 | Out-Null
    Write-Host "      ✓ Analysis Queue created" -ForegroundColor Green
} catch {
    Write-Host "      ! Queue may already exist or permission denied" -ForegroundColor Yellow
}

# 3. Create S3 Bucket
Write-Host "[3/5] Creating S3 Bucket..." -ForegroundColor Yellow
try {
    aws s3 mb s3://qnyproj-api-assets-dev --region $Region 2>&1 | Out-Null
    Write-Host "      ✓ S3 Bucket created" -ForegroundColor Green
} catch {
    Write-Host "      ! Bucket may already exist or permission denied" -ForegroundColor Yellow
}

# 4. Create DynamoDB Table (this is complex, just check if it exists)
Write-Host "[4/5] Checking DynamoDB Table..." -ForegroundColor Yellow
try {
    aws dynamodb describe-table --table-name qnyproj-api-data --region $Region 2>&1 | Out-Null
    Write-Host "      ✓ DynamoDB Table exists" -ForegroundColor Green
} catch {
    Write-Host "      ! DynamoDB Table needs to be created manually" -ForegroundColor Red
    Write-Host "        See MANUAL_RESOURCE_CREATION.md for details" -ForegroundColor Yellow
}

# 5. Create Secrets Manager Secret
Write-Host "[5/5] Creating Secrets Manager Secret..." -ForegroundColor Yellow
Write-Host "      ⚠ You need to provide your Qwen API key!" -ForegroundColor Yellow
$QwenApiKey = Read-Host "      Enter your Qwen API key (or press Enter to skip)"

if ($QwenApiKey) {
    $SecretString = "{`"apiKey`":`"$QwenApiKey`",`"endpoint`":`"https://dashscope.aliyuncs.com/compatible-mode/v1`"}"
    try {
        aws secretsmanager create-secret `
            --name qnyproj-api-qwen-api-key `
            --description "Qwen API credentials" `
            --secret-string $SecretString `
            --region $Region 2>&1 | Out-Null
        Write-Host "      ✓ Secret created" -ForegroundColor Green
    } catch {
        Write-Host "      ! Secret may already exist or permission denied" -ForegroundColor Yellow
    }
} else {
    Write-Host "      ⊘ Skipped (you can create it later)" -ForegroundColor Gray
}

Write-Host "`n[SUMMARY]" -ForegroundColor Cyan
Write-Host "Check if resources were created:" -ForegroundColor Yellow
Write-Host "  aws sqs list-queues --region $Region | Select-String 'qnyproj'" -ForegroundColor Gray
Write-Host "  aws s3 ls | Select-String 'qnyproj'" -ForegroundColor Gray
Write-Host "  aws secretsmanager list-secrets --region $Region | Select-String 'qnyproj'" -ForegroundColor Gray
Write-Host ""
