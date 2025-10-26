const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { uploadImage } = require('../../lib/s3-utils');
const exportService = require('../export');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const records = event.Records || [];
  for (const record of records) {
    const body = parseBody(record.body);
    if (!body) {
      console.error('[ExportWorker] 收到无法解析的消息，跳过');
      continue;
    }
    try {
      await processExportTask(body);
    } catch (error) {
      console.error('[ExportWorker] 处理导出任务失败:', error);
    }
  }
};

function parseBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (error) {
    console.error('[ExportWorker] JSON 解析失败:', error);
    return null;
  }
}

async function processExportTask(message) {
  const { exportId, jobId, novelId, storyboardId, format, userId } = message || {};
  if (!exportId || !jobId || !novelId || !storyboardId || !format) {
    console.error('[ExportWorker] 消息缺少关键字段:', message);
    return;
  }

  const claimed = await claimQueuedExport(exportId);
  if (!claimed) {
    console.log(`[ExportWorker] Export ${exportId} 已被其他实例处理或状态已变更，跳过`);
    return;
  }

  try {
    await exportService.updateJob(jobId, {
      status: 'in_progress',
      progress: {
        total: 1,
        completed: 0,
        failed: 0,
        percentage: 0,
        stage: 'processing',
        message: 'ExportWorker 正在生成导出文件'
      }
    });

    const novel = await exportService.loadNovel(novelId);
    if (!novel) {
      throw new Error(`小说 ${novelId} 不存在`);
    }

    const storyboard = await exportService.loadStoryboard(novel.id, storyboardId);
    if (!storyboard) {
      throw new Error(`分镜 ${storyboardId} 不存在`);
    }

    const panels = await exportService.loadPanels(storyboard.id);
    if (!panels || panels.length === 0) {
      throw new Error(`分镜 ${storyboardId} 暂无可导出的面板`);
    }

    const { buffer, filename, contentType } = await exportService.buildExportAsset({
      format,
      novel,
      storyboard,
      panels
    });

    const s3Key = `exports/${exportId}/${filename}`;
    await uploadImage(s3Key, buffer, {
      contentType,
      metadata: {
        'export-id': exportId,
        format,
        'novel-id': novel.id,
        'storyboard-id': storyboard.id
      }
    });

    await exportService.persistExportRecord({
      exportId,
      s3Key,
      size: buffer.length,
      jobId
    });

    await exportService.updateJob(jobId, {
      status: 'completed',
      result: {
        exportId,
        format,
        s3Key,
        fileSize: buffer.length
      },
      progress: {
        total: 1,
        completed: 1,
        failed: 0,
        percentage: 100,
        stage: 'completed',
        message: '导出完成'
      }
    });
  } catch (error) {
    console.error(`[ExportWorker] 导出 ${exportId} 失败:`, error);
    await exportService.markExportRecordFailed({
      exportId,
      jobId,
      error: error.message
    });
    await exportService.updateJob(jobId, {
      status: 'failed',
      error: error.message,
      progress: {
        total: 1,
        completed: 0,
        failed: 1,
        percentage: 0,
        stage: 'failed',
        message: error.message
      }
    });
  }
}

async function claimQueuedExport(exportId) {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `EXPORT#${exportId}`,
          SK: `EXPORT#${exportId}`
        },
        ConditionExpression: '#status = :queued',
        UpdateExpression: 'SET #status = :processing, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':queued': 'queued',
          ':updatedAt': new Date().toISOString(),
          ':processing': 'processing'
        }
      })
    );
    return true;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw error;
  }
}
