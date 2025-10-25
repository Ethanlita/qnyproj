#!/usr/bin/env node
/**
 * 清空指定的 SQS 队列，并将尚未完成的相关 Job 标记为失败。
 *
 * 使用方式：
 *   ANALYSIS_QUEUE_URL=... TABLE_NAME=... node scripts/clear-sqs.js
 *   node scripts/clear-sqs.js --queues=https://...,https://... --types=analyze,reference_image
 */

const path = require('path');
const Module = require('module');

const existingNodePath = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [];
const backendNodeModules = path.resolve(__dirname, '../backend/node_modules');
const nodePathEntries = [backendNodeModules, ...existingNodePath].filter(Boolean);
process.env.NODE_PATH = Array.from(new Set(nodePathEntries)).join(path.delimiter);
Module._initPaths();

const { SQSClient, PurgeQueueCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { CloudFormationClient, DescribeStacksCommand, ListStackResourcesCommand } = require('@aws-sdk/client-cloudformation');

const sqsClient = new SQSClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cloudFormationClient = new CloudFormationClient({});
const shouldSkipPurge = process.argv.includes('--skip-purge');

function parseArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (!match) {
    return null;
  }
  return match.slice(prefix.length);
}

function resolveQueueUrlsFromArgs() {
  const fromArg = parseArg('queues');
  if (fromArg) {
    return fromArg.split(',').map((item) => item.trim()).filter(Boolean);
  }
  const envCandidates = [
    process.env.ANALYSIS_QUEUE_URL,
    process.env.REFERENCE_QUEUE_URL,
    process.env.REFERENCE_IMAGE_QUEUE_URL
  ];
  return envCandidates.filter(Boolean);
}

function resolveJobTypes() {
  const fromArg = parseArg('types');
  if (fromArg) {
    return fromArg.split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (process.env.TARGET_JOB_TYPES) {
    return process.env.TARGET_JOB_TYPES.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

async function purgeQueue(queueUrl) {
  console.log(`🧹 Purging queue: ${queueUrl}`);
  await sqsClient.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
}

async function markJobsFailed(tableName, jobTypes) {
  console.log('🔍 Scanning DynamoDB 以找到仍在排队/运行的 Job...');
  let lastEvaluatedKey = undefined;
  let updated = 0;
  const now = new Date().toISOString();

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey
      })
    );

    for (const item of result.Items || []) {
      if (!item?.PK?.startsWith('JOB#')) {
        continue;
      }
      const status = item.status;
      if (!['queued', 'pending', 'running'].includes(status)) {
        continue;
      }
      if (jobTypes.length > 0 && !jobTypes.includes(item.type)) {
        continue;
      }

      await dynamoClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            PK: item.PK,
            SK: item.SK
          },
          UpdateExpression: 'SET #status = :failed, errorMessage = :message, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':failed': 'failed',
            ':message': 'Manually failed after queue purge',
            ':updatedAt': now
          }
        })
      );
      updated += 1;
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return updated;
}

async function main() {
  const stackName = parseArg('stack') || process.env.STACK_NAME || 'qnyproj-api';
  let queueUrls = resolveQueueUrlsFromArgs();
  let tableName = process.env.TABLE_NAME || process.env.COMIC_DATA_TABLE;

  const jobTypes = resolveJobTypes();

  if (queueUrls.length === 0 || !tableName) {
    console.log(`🔎 未提供完整上下文，正在从堆栈 ${stackName} 自动发现...`);
    const context = await discoverStackContext(stackName);
    if (queueUrls.length === 0) {
      queueUrls = context.queueUrls;
    }
    if (!tableName) {
      tableName = context.tableName;
    }
  }

  if (!tableName) {
    throw new Error('缺少 TABLE_NAME，且在堆栈输出中也未找到 ComicDataTableName');
  }

  if (!queueUrls || queueUrls.length === 0) {
    throw new Error('未找到任何要清理的队列（请确认堆栈资源或参数）');
  }

  console.log(`📦 将对以下队列执行清理：\n${queueUrls.map((url) => `  - ${url}`).join('\n')}`);

  if (shouldSkipPurge) {
    console.log('⏭️  跳过 SQS Purge（--skip-purge 已启用）');
  } else {
    for (const queueUrl of queueUrls) {
      await purgeQueue(queueUrl);
    }
  }

  const affected = await markJobsFailed(tableName, jobTypes);
  console.log(`✅ 已标记 ${affected} 个 Job 为 failed 状态。`);
}

async function discoverStackContext(stackName) {
  const [stackData, resources] = await Promise.all([
    cloudFormationClient.send(
      new DescribeStacksCommand({
        StackName: stackName
      })
    ),
    cloudFormationClient.send(
      new ListStackResourcesCommand({
        StackName: stackName
      })
    )
  ]);

  const outputs = stackData.Stacks?.[0]?.Outputs || [];
  const outputMap = outputs.reduce((acc, item) => {
    if (item?.OutputKey) {
      acc[item.OutputKey] = item.OutputValue;
    }
    return acc;
  }, {});

  const queueUrls = (resources.StackResourceSummaries || [])
    .filter((resource) => resource.ResourceType === 'AWS::SQS::Queue')
    .map((resource) => resource.PhysicalResourceId)
    .filter(Boolean);

  return {
    tableName: outputMap.ComicDataTableName || null,
    queueUrls
  };
}

main().catch((error) => {
  console.error('❌ 清理 SQS 任务失败：', error);
  process.exit(1);
});
