const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { getPresignedUrl, uploadImage } = require('../../lib/s3-utils');
const { v4: uuid } = require('uuid');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const ASSETS_BUCKET = process.env.ASSETS_BUCKET;

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

    const userId = getUserId(event) || 'anonymous';

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

  const storyboard = await loadStoryboard(novel.storyboardId);
  if (!storyboard) {
    return errorResponse(404, `Storyboard ${novel.storyboardId} not found`);
  }

  const panels = await loadPanels(storyboard.id);

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
    timestampNumber
  });

  try {
    const { buffer, filename, contentType } = await buildExportAsset({
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

    await persistExportRecord({
      exportId,
      novel,
      storyboard,
      format,
      userId,
      s3Key,
      size: buffer.length,
      jobId,
      timestamp,
      timestampNumber
    });

    await updateJob(jobId, {
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
        percentage: 100
      }
    });

    return successResponse(
      {
        exportId,
        jobId,
        status: 'completed',
        format
      },
      202
    );
  } catch (error) {
    console.error('[Export] Failed to generate asset:', error);
    await updateJob(jobId, {
      status: 'failed',
      error: error.message,
      progress: {
        total: 1,
        completed: 0,
        failed: 1,
        percentage: 0
      }
    });
    return errorResponse(500, `Failed to generate export: ${error.message}`);
  }
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
      const buffer = createPdfBuffer(novel, storyboard, panels);
      return {
        buffer,
        filename: 'comic.pdf',
        contentType: 'application/pdf'
      };
    }
    case 'webtoon': {
      const buffer = createWebtoonPlaceholder(storyboard, panels);
      return {
        buffer,
        filename: 'webtoon.png',
        contentType: 'image/png'
      };
    }
    case 'resources': {
      const buffer = createResourcesArchive(novel, storyboard, panels);
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
  return result.Item || null;
}

async function loadStoryboard(storyboardId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `STORYBOARD#${storyboardId}`,
        SK: `STORYBOARD#${storyboardId}`
      }
    })
  );
  return result.Item || null;
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

async function createExportJob({ jobId, userId, novel, storyboard, format, timestamp, timestampNumber }) {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `JOB#${jobId}`,
        SK: `JOB#${jobId}`,
        id: jobId,
        type: `export_${format}`,
        status: 'in_progress',
        novelId: novel.id,
        storyboardId: storyboard.id,
        userId,
        progress: {
          total: 1,
          completed: 0,
          failed: 0,
          percentage: 0
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
    expressions.push('result = :result');
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

async function persistExportRecord({
  exportId,
  novel,
  storyboard,
  format,
  userId,
  s3Key,
  size,
  jobId,
  timestamp,
  timestampNumber
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
        status: 'completed',
        fileKey: s3Key,
        fileSize: size,
        jobId,
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

function createPdfBuffer(novel, storyboard, panels) {
  const lines = [];
  lines.push(`Title: ${novel.title || 'Untitled Novel'}`);
  lines.push(`Storyboard: ${storyboard.id}`);
  lines.push('');

  const sorted = panels.slice().sort((a, b) => {
    if (a.page === b.page) {
      return (a.index || 0) - (b.index || 0);
    }
    return (a.page || 0) - (b.page || 0);
  });

  for (const panel of sorted) {
    const scene = panel.scene || panel.content?.scene || 'Scene description missing';
    const dialogue = (panel.dialogue || panel.content?.dialogue || [])
      .map((d) => `${d.speaker || '??'}: ${d.text || ''}`)
      .join(' | ');

    lines.push(`P${panel.page ?? '?'}-${panel.index ?? '?'}: ${scene}`);
    if (dialogue) {
      lines.push(`    Dialogue: ${dialogue}`);
    }
    lines.push('');
  }

  const pageContent = buildPdfContent(lines);
  const contentLength = Buffer.byteLength(pageContent, 'utf8');

  const objects = [];
  const offsets = [];
  let cursor = 0;

  const header = '%PDF-1.4\n';
  cursor += Buffer.byteLength(header, 'utf8');

  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  offsets.push(cursor);
  cursor += Buffer.byteLength(obj1, 'utf8');

  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  offsets.push(cursor);
  cursor += Buffer.byteLength(obj2, 'utf8');

  const obj3 =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
  offsets.push(cursor);
  cursor += Buffer.byteLength(obj3, 'utf8');

  const obj4 = `4 0 obj\n<< /Length ${contentLength} >>\nstream\n${pageContent}\nendstream\nendobj\n`;
  offsets.push(cursor);
  cursor += Buffer.byteLength(obj4, 'utf8');

  const obj5 = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  offsets.push(cursor);
  cursor += Buffer.byteLength(obj5, 'utf8');

  const xrefOffset = cursor;
  const xrefHeader = `xref\n0 6\n0000000000 65535 f \n`;
  let xrefBody = '';
  for (const offset of offsets) {
    xrefBody += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const buffers = [
    Buffer.from(header, 'utf8'),
    Buffer.from(obj1, 'utf8'),
    Buffer.from(obj2, 'utf8'),
    Buffer.from(obj3, 'utf8'),
    Buffer.from(obj4, 'utf8'),
    Buffer.from(obj5, 'utf8'),
    Buffer.from(xrefHeader, 'utf8'),
    Buffer.from(xrefBody, 'utf8'),
    Buffer.from(trailer, 'utf8')
  ];

  return Buffer.concat(buffers);
}

function buildPdfContent(lines) {
  const textLines = lines.length > 0 ? lines : ['(empty page)'];
  const content = ['BT', '/F1 12 Tf', '72 720 Td'];
  for (const line of textLines) {
    content.push(`(${escapePdfText(line)}) Tj`);
    content.push('0 -16 Td');
  }
  content.push('ET');
  return content.join('\n');
}

function createWebtoonPlaceholder(storyboard, panels) {
  // Include minimal metadata so downstream systems can read context even though image is placeholder
  const metadata = {
    storyboardId: storyboard.id,
    panelCount: panels.length,
    generatedAt: new Date().toISOString()
  };

  const metaBuffer = Buffer.from(JSON.stringify(metadata), 'utf8');
  return Buffer.concat([PLACEHOLDER_PNG, metaBuffer]);
}

function createResourcesArchive(novel, storyboard, panels) {
  const entries = [];
  const now = new Date();

  const metadata = {
    novelId: novel.id,
    title: novel.title,
    storyboardId: storyboard.id,
    totalPanels: panels.length,
    exportedAt: now.toISOString()
  };

  entries.push({
    name: 'metadata.json',
    data: JSON.stringify(metadata, null, 2),
    date: now
  });

  const panelData = panels.map((panel) => ({
    id: panel.id,
    page: panel.page,
    index: panel.index,
    scene: panel.scene || panel.content?.scene || '',
    dialogue: panel.dialogue || panel.content?.dialogue || [],
    imagesS3: panel.imagesS3 || {}
  }));

  entries.push({
    name: 'panels.json',
    data: JSON.stringify(panelData, null, 2),
    date: now
  });

  return createZipBuffer(entries);
}

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function createZipBuffer(entries) {
  let offset = 0;
  const fileRecords = [];
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

