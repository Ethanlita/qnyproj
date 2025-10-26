const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { s3Client, getPresignedUrl } = require('../../lib/s3-utils');
const { v4: uuid } = require('uuid');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const ASSETS_BUCKET = process.env.ASSETS_BUCKET;
const EXPORT_QUEUE_URL = process.env.EXPORT_QUEUE_URL;

const SUPPORTED_FORMATS = new Set(['pdf', 'webtoon', 'resources']);

// Simple 64x64 PNG placeholder (same as ImagenAdapter fallback)
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAQCAYAAAB49x1GAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA' +
    'B3RJTUUH5AISEwEzyQxgnQAAAB1pVFh0Q29tbWVudAAAAAAAQ3JlYXRlZCB3aXRoIEdJTVBkLmUH' +
    'AAAAW0lEQVR42u3OsQ0AMAhDQay/6c860BqIgQ1LxuxMxDPZWS9P7+EAgMBAgACAgAEBAP6SBeCA' +
    'AgICAAICAAR8hAkICAkIDwn0oyIAAgIAAgIAAh4CEQQEBAQEBAQ8gD4LwFd0ZUpiYQAAAABJRU5E' +
    'rkJggg==',
  'base64'
);

exports.handler = async (event) => {
  try {
    const method = event.httpMethod || event.requestContext?.http?.method || 'GET';

    // Handle OPTIONS preflight request
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Max-Age': '86400'
        },
        body: ''
      };
    }

    if (!TABLE_NAME) {
      console.error('[Export] TABLE_NAME not configured');
      return errorResponse(500, 'TABLE_NAME environment variable not set');
    }
    if (!ASSETS_BUCKET) {
      console.error('[Export] ASSETS_BUCKET not configured');
      return errorResponse(500, 'ASSETS_BUCKET environment variable not set');
    }

    const userId = getUserId(event);
    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    if (method === 'POST') {
      return await handleCreateExport(event, userId);
    }
    if (method === 'GET') {
      const exportId = event.pathParameters?.id;
      if (!exportId) {
        return errorResponse(400, 'Export ID is required');
      }
      return await handleGetExport(exportId, userId);
    }

    return errorResponse(405, 'Method not allowed');
  } catch (error) {
    console.error('[Export] Unexpected error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

async function handleCreateExport(event, userId) {
  const body = JSON.parse(event.body || '{}');
  const { novelId, format } = body;

  if (!novelId) {
    return errorResponse(400, 'novelId is required');
  }
  if (!format || !SUPPORTED_FORMATS.has(format)) {
    return errorResponse(400, `format must be one of ${Array.from(SUPPORTED_FORMATS).join(', ')}`);
  }

  const novel = await loadNovel(novelId);
  if (!novel) {
    return errorResponse(404, `Novel ${novelId} not found`);
  }
  if (!novel.storyboardId) {
    return errorResponse(409, 'Storyboard not generated yet');
  }

  const storyboard = await loadStoryboard(novel.id, novel.storyboardId);
  if (!storyboard) {
    return errorResponse(404, `Storyboard ${novel.storyboardId} not found`);
  }

  const panels = await loadPanels(storyboard.id);
  if (!panels || panels.length === 0) {
    return errorResponse(409, 'Storyboard does not have any panels yet');
  }

  const exportId = uuid();
  const jobId = uuid();
  const timestamp = new Date().toISOString();
  const timestampNumber = Date.now();

  await createExportJob({
    jobId,
    userId,
    novel,
    storyboard,
    format,
    timestamp,
    timestampNumber,
    initialStatus: 'queued'
  });

  await createQueuedExportRecord({
    exportId,
    novel,
    storyboard,
    format,
    userId,
    jobId,
    timestamp,
    timestampNumber,
    panelCount: panels.length
  });

  await enqueueExportTask({
    exportId,
    jobId,
    novelId: novel.id,
    storyboardId: storyboard.id,
    format,
    userId
  });

  return successResponse(
    {
      exportId,
      jobId,
      status: 'queued',
      format,
      message: 'Export job enqueued. Use GET /jobs/{jobId} 或 GET /exports/{exportId} 查看进度。'
    },
    202
  );
}

async function handleGetExport(exportId, userId) {
  const exportRecord = await loadExport(exportId);
  if (!exportRecord) {
    return errorResponse(404, `Export ${exportId} not found`);
  }

  if (exportRecord.userId && exportRecord.userId !== userId) {
    return errorResponse(403, 'You are not allowed to access this export');
  }

  const url = exportRecord.fileKey ? await getPresignedUrl(exportRecord.fileKey) : null;

  return successResponse({
    id: exportRecord.id,
    novelId: exportRecord.novelId,
    format: exportRecord.format,
    status: exportRecord.status,
    fileUrl: url,
    fileSize: exportRecord.fileSize || null,
    createdAt: exportRecord.createdAt,
    updatedAt: exportRecord.updatedAt,
    jobId: exportRecord.jobId
  });
}

async function buildExportAsset({ format, novel, storyboard, panels }) {
  switch (format) {
    case 'pdf': {
      const buffer = await createPdfBuffer(novel, storyboard, panels);
      return {
        buffer,
        filename: 'comic.pdf',
        contentType: 'application/pdf'
      };
    }
    case 'webtoon': {
      const buffer = await createWebtoonPlaceholder(storyboard, panels);
      return {
        buffer,
        filename: 'webtoon.png',
        contentType: 'image/png'
      };
    }
    case 'resources': {
      const buffer = await createResourcesArchive(novel, storyboard, panels);
      return {
        buffer,
        filename: 'resources.zip',
        contentType: 'application/zip'
      };
    }
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

async function loadNovel(novelId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `NOVEL#${novelId}`,
        SK: `NOVEL#${novelId}`
      }
    })
  );
  if (!result.Item) {
    return null;
  }
  return {
    ...result.Item,
    id: result.Item.id || novelId
  };
}

async function loadStoryboard(novelId, storyboardId) {
  if (!novelId || !storyboardId) {
    return null;
  }
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `NOVEL#${novelId}`,
        SK: `STORYBOARD#${storyboardId}`
      }
    })
  );
  if (!result.Item) {
    return null;
  }
  return {
    ...result.Item,
    id: result.Item.id || storyboardId
  };
}

async function loadPanels(storyboardId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `STORYBOARD#${storyboardId}`,
        ':sk': 'PANEL#'
      }
    })
  );
  return result.Items || [];
}

async function createExportJob({
  jobId,
  userId,
  novel,
  storyboard,
  format,
  timestamp,
  timestampNumber,
  initialStatus = 'queued'
}) {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `JOB#${jobId}`,
        SK: `JOB#${jobId}`,
        id: jobId,
        type: `export_${format}`,
        status: initialStatus,
        novelId: novel.id,
        storyboardId: storyboard.id,
        userId,
        progress: {
          total: 1,
          completed: 0,
          failed: 0,
          percentage: 0,
          stage: initialStatus === 'queued' ? 'queued' : 'in_progress',
          message:
            initialStatus === 'queued'
              ? '导出任务已排队，等待 ExportWorker 执行'
              : '导出任务执行中'
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        GSI1PK: `USER#${userId}`,
        GSI1SK: `JOB#${timestampNumber}`,
        GSI2PK: `NOVEL#${novel.id}`,
        GSI2SK: timestampNumber
      }
    })
  );
}

async function createQueuedExportRecord({
  exportId,
  novel,
  storyboard,
  format,
  userId,
  jobId,
  timestamp,
  timestampNumber,
  panelCount
}) {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `EXPORT#${exportId}`,
        SK: `EXPORT#${exportId}`,
        id: exportId,
        novelId: novel.id,
        storyboardId: storyboard.id,
        userId,
        format,
        status: 'queued',
        fileKey: null,
        fileSize: null,
        jobId,
        panelCount,
        createdAt: timestamp,
        updatedAt: timestamp,
        GSI1PK: `USER#${userId}`,
        GSI1SK: `EXPORT#${timestampNumber}`,
        GSI2PK: `NOVEL#${novel.id}`,
        GSI2SK: timestampNumber
      }
    })
  );
}

async function enqueueExportTask({ exportId, jobId, novelId, storyboardId, format, userId }) {
  if (!EXPORT_QUEUE_URL) {
    throw new Error('EXPORT_QUEUE_URL environment variable not set');
  }
  const payload = {
    exportId,
    jobId,
    novelId,
    storyboardId,
    format,
    userId,
    enqueuedAt: Date.now()
  };

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: EXPORT_QUEUE_URL,
      MessageBody: JSON.stringify(payload),
      MessageAttributes: {
        exportId: { DataType: 'String', StringValue: exportId },
        format: { DataType: 'String', StringValue: format }
      }
    })
  );
}

async function updateJob(jobId, { status, progress, result, error }) {
  const expressions = ['updatedAt = :updatedAt'];
  const names = {};
  const values = {
    ':updatedAt': new Date().toISOString()
  };

  if (status) {
    expressions.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = status;
  }
  if (progress) {
    expressions.push('progress = :progress');
    values[':progress'] = progress;
  }
  if (result) {
    expressions.push('#result = :result');
    names['#result'] = 'result';
    values[':result'] = result;
  }
  if (error) {
    expressions.push('#error = :error');
    names['#error'] = 'error';
    values[':error'] = error;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `JOB#${jobId}`,
        SK: `JOB#${jobId}`
      },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
      ExpressionAttributeValues: values
    })
  );
}

async function persistExportRecord({ exportId, s3Key, size, jobId }) {
  const timestamp = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `EXPORT#${exportId}`,
        SK: `EXPORT#${exportId}`
      },
      ConditionExpression: 'attribute_exists(PK)',
      UpdateExpression: 'SET #status = :status, fileKey = :fileKey, fileSize = :fileSize, jobId = :jobId, updatedAt = :updatedAt, error = :error',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'completed',
        ':fileKey': s3Key,
        ':fileSize': size,
        ':jobId': jobId,
        ':updatedAt': timestamp,
        ':error': null
      }
    })
  );
}

async function markExportRecordFailed({ exportId, jobId, error }) {
  const timestamp = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `EXPORT#${exportId}`,
        SK: `EXPORT#${exportId}`
      },
      ConditionExpression: 'attribute_exists(PK)',
      UpdateExpression: 'SET #status = :status, error = :error, jobId = :jobId, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':error': error || '导出失败',
        ':jobId': jobId,
        ':updatedAt': timestamp
      }
    })
  );
}

async function loadExport(exportId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `EXPORT#${exportId}`,
        SK: `EXPORT#${exportId}`
      }
    })
  );
  return result.Item || null;
}

async function createPdfBuffer(novel, storyboard, panels = []) {
  const sortedPanels = sortPanels(panels);
  const assets = await fetchPanelImageAssets(sortedPanels);
  const pdf = await PDFDocument.create();
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);
  const headingFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const cover = pdf.addPage([612, 792]);
  const coverWidth = cover.getWidth();
  let cursorY = cover.getHeight() - 80;
  cover.drawText(novel.title || 'Untitled Novel', {
    x: 50,
    y: cursorY,
    size: 28,
    font: headingFont
  });
  cursorY -= 40;
  cover.drawText(`Storyboard: ${storyboard.id}`, {
    x: 50,
    y: cursorY,
    size: 14,
    font: bodyFont
  });
  cursorY -= 20;
  cover.drawText(`Panels: ${sortedPanels.length}`, {
    x: 50,
    y: cursorY,
    size: 14,
    font: bodyFont
  });
  cursorY -= 30;
  cover.drawRectangle({
    x: 50,
    y: cursorY,
    width: coverWidth - 100,
    height: 1,
    color: rgb(0.4, 0.4, 0.4)
  });
  cursorY -= 30;
  cover.drawText(`Generated at ${new Date().toISOString()}`, {
    x: 50,
    y: cursorY,
    size: 12,
    font: bodyFont,
    color: rgb(0.3, 0.3, 0.3)
  });

  const panelAssets = assets.length > 0 ? assets : [{ panel: null, buffer: PLACEHOLDER_PNG, format: 'png' }];
  for (const { panel, buffer, format } of panelAssets) {
    const page = pdf.addPage([612, 792]);
    const margin = 40;
    const textBlockHeight = 160;
    const imageAreaHeight = page.getHeight() - margin * 2 - textBlockHeight;
    const availableWidth = page.getWidth() - margin * 2;
    let embeddedImage;
    try {
      if (format === 'jpeg' || format === 'jpg') {
        embeddedImage = await pdf.embedJpg(buffer);
      } else {
        embeddedImage = await pdf.embedPng(buffer);
      }
    } catch (error) {
      console.warn('[Export] Failed to embed panel image in PDF, using placeholder:', error?.message);
      embeddedImage = await pdf.embedPng(PLACEHOLDER_PNG);
    }

    const scale = Math.min(
      availableWidth / embeddedImage.width,
      imageAreaHeight / embeddedImage.height,
      1.2
    );
    const drawWidth = embeddedImage.width * scale;
    const drawHeight = embeddedImage.height * scale;
    const imageX = margin + (availableWidth - drawWidth) / 2;
    const imageY = page.getHeight() - margin - drawHeight;
    page.drawImage(embeddedImage, {
      x: imageX,
      y: imageY,
      width: drawWidth,
      height: drawHeight
    });

    let textY = imageY - 20;
    const panelLabel = panel
      ? `Page ${panel.page ?? '?'} · Panel ${panel.index ?? '?'}`
      : 'Panel';
    page.drawText(panelLabel, {
      x: margin,
      y: textY,
      size: 13,
      font: headingFont
    });
    textY -= 18;

    const narrative = panel ? buildPanelNarrativeLines(panel) : ['No storyboard data provided'];
    for (const line of narrative) {
      if (textY < margin) break;
      page.drawText(line, {
        x: margin,
        y: textY,
        size: 11,
        font: bodyFont,
        color: rgb(0.2, 0.2, 0.2)
      });
      textY -= 14;
    }
  }

  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes);
}

async function createWebtoonPlaceholder(storyboard, panels = []) {
  const sortedPanels = sortPanels(panels);
  const assets = await fetchPanelImageAssets(sortedPanels);
  const decodedImages = [];

  for (const asset of assets.length > 0 ? assets : [{ buffer: PLACEHOLDER_PNG, format: 'png', panel: null }]) {
    const buffer = asset.buffer || PLACEHOLDER_PNG;
    const format = asset.format || detectImageFormat(buffer)?.type || 'png';
    const decoded = decodeImageToRgba(buffer, format);
    if (decoded) {
      decodedImages.push(decoded);
    }
  }

  if (decodedImages.length === 0) {
    const fallback = decodeImageToRgba(PLACEHOLDER_PNG, 'png');
    decodedImages.push(fallback);
  }

  const gutter = 32;
  const width = Math.max(decodedImages.reduce((max, img) => Math.max(max, img.width), 0), 512);
  const height =
    decodedImages.reduce((sum, img, index) => sum + img.height + (index > 0 ? gutter : 0), 0) || 512;
  const canvas = new PNG({ width, height });
  canvas.data.fill(255);

  let offsetY = 0;
  for (const img of decodedImages) {
    const offsetX = Math.floor((width - img.width) / 2);
    compositeImage(canvas, img, offsetX, offsetY);
    offsetY += img.height + gutter;
  }

  return PNG.sync.write(canvas);
}

async function createResourcesArchive(novel, storyboard, panels = []) {
  const now = new Date();
  const sortedPanels = sortPanels(panels);
  const assets = await fetchPanelImageAssets(sortedPanels);
  const entries = [];

  const manifest = [];
  sortedPanels.forEach((panel, index) => {
    const asset = assets[index];
    const baseName = buildPanelBaseName(panel, index);
    const jsonFile = `panels/${baseName}.json`;
    entries.push({
      name: jsonFile,
      data: JSON.stringify(panel, null, 2),
      date: now
    });

    let imageFile = null;
    if (asset?.buffer) {
      const ext = asset.extension || (asset.format === 'jpeg' ? 'jpg' : 'png');
      imageFile = `images/${baseName}.${ext}`;
      entries.push({
        name: imageFile,
        data: asset.buffer,
        date: now
      });
    }

    manifest.push({
      id: panel.id,
      page: panel.page,
      index: panel.index,
      scene: panel.scene || panel.content?.scene || '',
      dialogue: panel.dialogue || panel.content?.dialogue || [],
      panelFile: jsonFile,
      imageFile,
      imageSource: asset?.key || null
    });
  });

  const metadata = {
    novel: {
      id: novel.id,
      title: novel.title || null,
      author: novel.author || null
    },
    storyboard: {
      id: storyboard.id,
      title: storyboard.title || null,
      createdAt: storyboard.createdAt || null,
      updatedAt: storyboard.updatedAt || null
    },
    panelCount: panels.length,
    generatedAt: now.toISOString(),
    panels: manifest
  };

  entries.push({
    name: 'metadata.json',
    data: JSON.stringify(metadata, null, 2),
    date: now
  });

  entries.push({
    name: 'novel.json',
    data: JSON.stringify(novel, null, 2),
    date: now
  });

  entries.push({
    name: 'storyboard.json',
    data: JSON.stringify(storyboard, null, 2),
    date: now
  });

  const summary = sortedPanels.map((panel, index) => ({
    id: panel.id,
    page: panel.page,
    index: panel.index,
    scene: panel.scene || panel.content?.scene || '',
    dialogue: panel.dialogue || panel.content?.dialogue || [],
    imagesS3: panel.imagesS3 || {},
    imageFile: manifest[index]?.imageFile || null
  }));

  entries.push({
    name: 'panels.json',
    data: JSON.stringify(summary, null, 2),
    date: now
  });

  return createZipBuffer(entries);
}

function sortPanels(panels = []) {
  return panels
    .slice()
    .sort((a, b) =>
      (a.page ?? Number.MAX_SAFE_INTEGER) === (b.page ?? Number.MAX_SAFE_INTEGER)
        ? (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER)
        : (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER)
    );
}

async function fetchPanelImageAssets(panels = []) {
  const assets = [];
  for (const panel of panels) {
    const key = selectPanelImageKey(panel);
    if (!key) {
      assets.push({
        panel,
        buffer: PLACEHOLDER_PNG,
        format: 'png',
        extension: 'png',
        mime: 'image/png',
        key: null,
        placeholder: true
      });
      continue;
    }

    try {
      const location = resolveS3Location(key);
      const buffer = await downloadImageBuffer(location);
      const formatInfo = detectImageFormat(buffer) || {
        type: inferExtensionFromKey(location.key) || 'bin',
        extension: inferExtensionFromKey(location.key) || 'bin',
        mime: 'application/octet-stream'
      };
      assets.push({
        panel,
        buffer,
        format: formatInfo.type,
        extension: formatInfo.extension,
        mime: formatInfo.mime,
        key: `${location.bucket}/${location.key}`,
        placeholder: false
      });
    } catch (error) {
      console.error(`[Export] Unable to download panel image ${panel?.id || key}:`, error?.message);
      assets.push({
        panel,
        buffer: PLACEHOLDER_PNG,
        format: 'png',
        extension: 'png',
        mime: 'image/png',
        key,
        placeholder: true
      });
    }
  }
  return assets;
}

function selectPanelImageKey(panel) {
  if (!panel?.imagesS3) {
    return null;
  }
  const preference = ['pdf', 'hd', 'original', 'preview', 'thumb'];
  for (const key of preference) {
    if (panel.imagesS3[key]) {
      return panel.imagesS3[key];
    }
  }
  const values = Object.values(panel.imagesS3);
  return values[0] || null;
}

function resolveS3Location(value) {
  if (!value) return null;
  if (value.startsWith('s3://')) {
    const without = value.slice(5);
    const [bucket, ...rest] = without.split('/');
    return { bucket, key: rest.join('/') };
  }
  if (!ASSETS_BUCKET) {
    throw new Error('ASSETS_BUCKET environment variable not set');
  }
  return {
    bucket: ASSETS_BUCKET,
    key: value.replace(/^\/+/, '')
  };
}

async function downloadImageBuffer(location) {
  if (!location?.bucket || !location?.key) {
    throw new Error('Invalid S3 object location');
  }
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: location.bucket,
      Key: location.key
    })
  );
  return streamToBuffer(response.Body);
}

async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body.arrayBuffer === 'function') {
    const arrayBuffer = await body.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    body.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    body.on('end', () => resolve(Buffer.concat(chunks)));
    body.on('error', reject);
  });
}

function detectImageFormat(buffer) {
  if (!buffer || buffer.length < 4) {
    return null;
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { type: 'png', extension: 'png', mime: 'image/png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { type: 'jpeg', extension: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buffer.length > 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { type: 'webp', extension: 'webp', mime: 'image/webp' };
  }
  return null;
}

function decodeImageToRgba(buffer, format) {
  try {
    if (format === 'jpeg' || format === 'jpg') {
      const decoded = jpeg.decode(buffer, { useTArray: true });
      return {
        width: decoded.width,
        height: decoded.height,
        data: Buffer.from(decoded.data)
      };
    }
    if (format === 'png') {
      const png = PNG.sync.read(buffer);
      return {
        width: png.width,
        height: png.height,
        data: png.data
      };
    }
  } catch (error) {
    console.warn('[Export] Unable to decode image buffer:', error?.message);
  }
  return null;
}

function compositeImage(canvas, image, offsetX, offsetY) {
  const destData = canvas.data;
  const canvasWidth = canvas.width;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const destIndex = ((offsetY + y) * canvasWidth + (offsetX + x)) * 4;
      const srcIndex = (y * image.width + x) * 4;
      const alpha = image.data[srcIndex + 3] / 255;
      if (alpha <= 0) {
        continue;
      }
      const invAlpha = 1 - alpha;
      destData[destIndex] = Math.round(image.data[srcIndex] * alpha + 255 * invAlpha);
      destData[destIndex + 1] = Math.round(image.data[srcIndex + 1] * alpha + 255 * invAlpha);
      destData[destIndex + 2] = Math.round(image.data[srcIndex + 2] * alpha + 255 * invAlpha);
      destData[destIndex + 3] = 255;
    }
  }
}

function buildPanelNarrativeLines(panel) {
  if (!panel) {
    return ['Panel metadata unavailable'];
  }
  const lines = [];
  const scene = panel.scene || panel.content?.scene;
  if (scene) {
    lines.push(...wrapText(scene));
  }
  const prompt = panel.visualPrompt || panel.content?.visualPrompt;
  if (prompt) {
    lines.push(...wrapText(`Prompt: ${prompt}`));
  }
  const dialogueEntries = panel.dialogue || panel.content?.dialogue || [];
  for (const entry of dialogueEntries) {
    const speaker = entry.speaker || 'Narrator';
    const text = entry.text || '';
    if (text) {
      lines.push(...wrapText(`${speaker}: ${text}`));
    }
  }
  const characters = panel.characters?.map((char) => char.name).filter(Boolean);
  if (characters && characters.length > 0) {
    lines.push(`Characters: ${characters.join(', ')}`);
  }
  return lines.length > 0 ? lines : ['No scene description or dialogue'];
}

function wrapText(text, maxLength = 90) {
  if (!text) {
    return [];
  }
  const words = String(text).trim().split(/\s+/);
  if (words.length === 0) {
    return [];
  }
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!word) continue;
    const tentative = current ? `${current} ${word}` : word;
    if (tentative.length <= maxLength) {
      current = tentative;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (word.length > maxLength) {
      lines.push(...breakLongWord(word, maxLength));
    } else {
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function breakLongWord(word, maxLength) {
  const segments = [];
  for (let i = 0; i < word.length; i += maxLength) {
    segments.push(word.slice(i, i + maxLength));
  }
  return segments;
}

function buildPanelBaseName(panel, index) {
  const seq = padNumber(index + 1, 3);
  const page = padNumber(panel?.page ?? 0, 2);
  const idx = padNumber(panel?.index ?? 0, 2);
  const slug = slugify(panel?.id) || `panel-${seq}`;
  return `${seq}-p${page}-i${idx}-${slug}`;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60) || 'panel';
}

function padNumber(value, size) {
  const num = Number.isFinite(Number(value)) ? Number(value) : 0;
  return String(Math.abs(Math.trunc(num))).padStart(size, '0');
}

function inferExtensionFromKey(key) {
  const match = key?.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function createZipBuffer(entries) {
  let offset = 0;
  const centralRecords = [];
  const buffers = [];

  for (const entry of entries) {
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const nameBuffer = Buffer.from(entry.name);
    const crc = crc32(dataBuffer);
    const { dosTime, dosDate } = dateToDos(entry.date || new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    buffers.push(localHeader, nameBuffer, dataBuffer);

    const localHeaderOffset = offset;
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localHeaderOffset, 42);

    centralRecords.push(centralHeader, nameBuffer);
  }

  const centralSize = centralRecords.reduce((sum, buf) => sum + buf.length, 0);
  const centralOffset = offset;
  buffers.push(...centralRecords);
  offset += centralSize;

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(centralOffset, 16);
  endRecord.writeUInt16LE(0, 20);
  buffers.push(endRecord);

  return Buffer.concat(buffers);
}

function crc32(buffer) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function dateToDos(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  return { dosDate, dosTime };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c >>>= 1;
      }
    }
    table[i] = c >>> 0;
  }
  return table;
})();

exports.buildExportAsset = buildExportAsset;
exports.loadNovel = loadNovel;
exports.loadStoryboard = loadStoryboard;
exports.loadPanels = loadPanels;
exports.updateJob = updateJob;
exports.persistExportRecord = persistExportRecord;
exports.markExportRecordFailed = markExportRecordFailed;
