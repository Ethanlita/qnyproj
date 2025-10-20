# Local Test for AnalyzeWorkerFunction
# Automated test workflow

Write-Host "`n[TEST] Starting AnalyzeWorkerFunction local test..." -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Gray

# 1. Check AWS credentials
Write-Host "`n[STEP 1] Checking AWS credentials..." -ForegroundColor Yellow
$awsCredPath = "$env:USERPROFILE\.aws\credentials"
if (Test-Path $awsCredPath) {
    Write-Host "[OK] Found AWS credentials file: $awsCredPath" -ForegroundColor Green
} else {
    Write-Host "[WARN] AWS credentials file not found, will use environment variables" -ForegroundColor Yellow
}

# 2. Build Lambda functions
Write-Host "`n[STEP 2] Building Lambda functions..." -ForegroundColor Yellow
Write-Host "   Running: sam build --use-container" -ForegroundColor Gray
sam build --use-container
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Build successful" -ForegroundColor Green

# 3. Prepare test data (upload novel)
Write-Host "`n[STEP 3] Preparing test data..." -ForegroundColor Yellow
node scripts/prepare-test-data.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to prepare test data" -ForegroundColor Red
    exit 1
}

# 4. Create test Job
Write-Host "`n[STEP 4] Creating test Job..." -ForegroundColor Yellow
node scripts/create-test-job.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to create test Job" -ForegroundColor Red
    exit 1
}

# 5. Run Worker function
Write-Host "`n[STEP 5] Running AnalyzeWorkerFunction..." -ForegroundColor Yellow
Write-Host "   This may take 2-5 minutes (calling real Qwen API)..." -ForegroundColor Gray
Write-Host "   Running: sam local invoke AnalyzeWorkerFunction -e events/analyze-worker-test.json" -ForegroundColor Gray
Write-Host ""

sam local invoke AnalyzeWorkerFunction -e events/analyze-worker-test.json

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Worker function execution failed" -ForegroundColor Red
    Write-Host "   Checking current status..." -ForegroundColor Yellow
    node scripts/check-test-results.js
    exit 1
}

# 6. Check results
Write-Host "`n[STEP 6] Checking test results..." -ForegroundColor Yellow
node scripts/check-test-results.js

Write-Host "`n" + ("=" * 60) -ForegroundColor Gray
Write-Host "[SUCCESS] Test workflow completed!" -ForegroundColor Green
Write-Host ""
