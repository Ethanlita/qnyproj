# 后台部署脚本
# 运行部署并保存输出到文件

Write-Host "[DEPLOYMENT] Starting SAM deployment in background..." -ForegroundColor Cyan

# 设置输出文件
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = "deploy-log-$timestamp.txt"

Write-Host "Log file: $logFile" -ForegroundColor Gray

# 后台运行部署
$job = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    sam deploy --no-confirm-changeset --no-fail-on-empty-changeset 2>&1
}

Write-Host "`n[INFO] Deployment job started (ID: $($job.Id))" -ForegroundColor Green
Write-Host "[INFO] You can continue working while deployment runs" -ForegroundColor Yellow
Write-Host "`nTo check status:" -ForegroundColor Cyan
Write-Host "  Get-Job $($job.Id)" -ForegroundColor White
Write-Host "`nTo get output:" -ForegroundColor Cyan
Write-Host "  Receive-Job $($job.Id) -Keep" -ForegroundColor White
Write-Host "`nWhen complete, get results:" -ForegroundColor Cyan
Write-Host "  Receive-Job $($job.Id)" -ForegroundColor White
Write-Host ""

# 等待完成（可选，可以 Ctrl+C 取消）
Write-Host "[WAITING] Press Ctrl+C to stop waiting (deployment will continue)" -ForegroundColor Yellow
Write-Host ""

$done = $false
while (-not $done) {
    Start-Sleep -Seconds 10
    $state = (Get-Job $job.Id).State
    $elapsed = [Math]::Floor(((Get-Date) - $job.PSBeginTime).TotalSeconds)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Status: $state | Elapsed: $($elapsed)s" -ForegroundColor Gray
    
    if ($state -eq 'Completed' -or $state -eq 'Failed') {
        $done = $true
        Write-Host "`n[RESULT] Deployment $state!" -ForegroundColor $(if ($state -eq 'Completed') { 'Green' } else { 'Red' })
        
        # 获取输出
        $output = Receive-Job $job.Id
        $output | Out-File $logFile
        
        # 显示最后几行
        Write-Host "`nLast 20 lines of output:" -ForegroundColor Cyan
        $output | Select-Object -Last 20
        
        Write-Host "`nFull log saved to: $logFile" -ForegroundColor Gray
    }
}

Remove-Job $job.Id
