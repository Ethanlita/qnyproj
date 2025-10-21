#!/bin/bash
# 等待 GitHub Actions 部署完成

set -e

REPO="Ethanlita/qnyproj"
MAX_WAIT=600  # 10 minutes
POLL_INTERVAL=10

echo "🔍 监控 GitHub Actions 部署状态..."
echo "Repository: $REPO"
echo ""

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) 未安装"
    echo "请访问查看部署状态: https://github.com/$REPO/actions"
    exit 1
fi

# Get the latest workflow run
echo "📡 获取最新的 workflow run..."
RUN_ID=$(gh run list --repo "$REPO" --limit 1 --json databaseId --jq '.[0].databaseId')

if [ -z "$RUN_ID" ]; then
    echo "❌ 无法获取 workflow run ID"
    exit 1
fi

echo "✅ Workflow Run ID: $RUN_ID"
echo "🔗 查看详情: https://github.com/$REPO/actions/runs/$RUN_ID"
echo ""

START_TIME=$(date +%s)

while true; do
    # Get current status
    STATUS=$(gh run view "$RUN_ID" --repo "$REPO" --json status,conclusion --jq '.status')
    CONCLUSION=$(gh run view "$RUN_ID" --repo "$REPO" --json status,conclusion --jq '.conclusion')
    
    ELAPSED=$(($(date +%s) - START_TIME))
    
    if [ "$STATUS" = "completed" ]; then
        echo ""
        if [ "$CONCLUSION" = "success" ]; then
            echo "✅ 部署成功！"
            exit 0
        else
            echo "❌ 部署失败：$CONCLUSION"
            echo ""
            echo "查看日志："
            gh run view "$RUN_ID" --repo "$REPO" --log-failed
            exit 1
        fi
    fi
    
    echo "⏳ [$ELAPSED s] 状态: $STATUS (等待中...)"
    
    if [ $ELAPSED -ge $MAX_WAIT ]; then
        echo ""
        echo "⏱️ 超时：部署超过 ${MAX_WAIT}s"
        echo "请手动检查: https://github.com/$REPO/actions/runs/$RUN_ID"
        exit 1
    fi
    
    sleep $POLL_INTERVAL
done
