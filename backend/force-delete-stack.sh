#!/bin/bash

# 强制删除失败的 CloudFormation 堆栈
# 使用方法: ./force-delete-stack.sh

STACK_NAME="qnyproj-api"

echo "🔍 检查堆栈状态..."
STACK_STATUS=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].StackStatus' --output text 2>/dev/null)

if [ -z "$STACK_STATUS" ]; then
    echo "✅ 堆栈不存在，无需删除"
    exit 0
fi

echo "📊 当前堆栈状态: $STACK_STATUS"

if [ "$STACK_STATUS" == "UPDATE_ROLLBACK_FAILED" ]; then
    echo "⚠️  堆栈处于 UPDATE_ROLLBACK_FAILED 状态"
    echo "🔧 尝试继续回滚..."
    
    # 尝试继续回滚（跳过失败的资源）
    aws cloudformation continue-update-rollback \
        --stack-name $STACK_NAME \
        --resources-to-skip AnalyzeNovelFunction AnalyzeWorkerFunction PanelsFunction \
        2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ 继续回滚成功，等待完成..."
        aws cloudformation wait stack-rollback-complete --stack-name $STACK_NAME
        STACK_STATUS=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].StackStatus' --output text 2>/dev/null)
        echo "📊 新状态: $STACK_STATUS"
    else
        echo "❌ 继续回滚失败"
    fi
fi

# 如果堆栈现在处于稳定状态，删除它
if [[ "$STACK_STATUS" == "ROLLBACK_COMPLETE" || "$STACK_STATUS" == "UPDATE_ROLLBACK_COMPLETE" || "$STACK_STATUS" == "CREATE_COMPLETE" || "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
    echo "🗑️  删除堆栈..."
    aws cloudformation delete-stack --stack-name $STACK_NAME
    
    echo "⏳ 等待堆栈删除完成（这可能需要几分钟）..."
    aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME
    
    if [ $? -eq 0 ]; then
        echo "✅ 堆栈删除成功！"
    else
        echo "❌ 堆栈删除失败，请手动检查"
        exit 1
    fi
else
    echo "⚠️  堆栈状态: $STACK_STATUS"
    echo "💡 如果堆栈仍然无法删除，请尝试以下命令："
    echo "   aws cloudformation delete-stack --stack-name $STACK_NAME --retain-resources AnalyzeNovelFunction,AnalyzeWorkerFunction,PanelsFunction"
fi

echo ""
echo "✅ 完成！现在可以运行 'sam build && sam deploy' 重新部署"
