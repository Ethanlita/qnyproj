# Manual Test Steps for AnalyzeWorkerFunction

## Prerequisites
- AWS credentials configured in ~/.aws/credentials
- Docker running (for sam local invoke)
- Node.js installed

## Step 1: Build Lambda Functions
```powershell
cd backend
sam build
```

## Step 2: Upload Test Novel to DynamoDB
```powershell
node scripts/prepare-test-data.js
```

## Step 3: Create Test Job
```powershell
node scripts/create-test-job.js
```

## Step 4: Run Worker Function Locally
```powershell
sam local invoke AnalyzeWorkerFunction -e events/analyze-worker-test.json
```

This will:
- Call real Qwen API (will incur costs)
- Update Job status in real DynamoDB table
- Write Storyboard/Panels/Characters to DynamoDB
- Take 2-5 minutes to complete

## Step 5: Check Results
```powershell
node scripts/check-test-results.js
```

This will query DynamoDB and display:
- Job status and progress
- Storyboard summary
- First 5 panels
- First 5 characters

## Expected Output
- Job status: queued → running → completed
- Job progress: 0% → 5% → 10% → 20% → 30% → 85% → 90% → 100%
- Storyboard created with panels and characters
- Novel status updated to 'analyzed'

## Troubleshooting

### Build Issues
If `sam build` fails:
- Check Node.js version (needs v18+)
- Check package.json dependencies
- Try `sam build --use-container` (slower but more reliable)

### Runtime Issues
If Worker function fails:
- Check CloudWatch logs in output
- Verify QWEN_SECRET_ARN exists in AWS Secrets Manager
- Verify TABLE_NAME exists in DynamoDB
- Check AWS credentials have necessary permissions

### DynamoDB Issues
If data not found:
- Verify table name: `qnyproj-api-data`
- Check AWS region: `us-east-1`
- Verify test data was uploaded successfully
