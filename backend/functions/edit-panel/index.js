const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  PutCommand
} = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { getGeminiConfig } = require('../../lib/ai-secrets');
const ImagenAdapter = require('../../lib/imagen-adapter');
const { uploadImage } = require('../../lib/s3-utils');
const { s3ImageToBase64 } = require('../../lib/s3-image-utils');
const { buildPanelPrompt } = require('../../lib/prompt-builder');
const { v4: uuid } = require('uuid');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const ASSETS_BUCKET = process.env.ASSETS_BUCKET;

let imagenAdapterPromise = null;

exports.handler = async (event) => {
  try {
    const method = event.httpMethod || event.requestContext?.http?.method;

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
      console.error('[EditPanel] TABLE_NAME not configured');
      return errorResponse(500, 'TABLE_NAME environment variable not set');
    }
    if (!ASSETS_BUCKET) {
      console.error('[EditPanel] ASSETS_BUCKET not configured');
      return errorResponse(500, 'ASSETS_BUCKET environment variable not set');
    }

    const panelId = event.pathParameters?.panelId;
    if (!panelId) {
      return errorResponse(400, 'panelId path parameter is required');
    }

    const userId = getUserId(event) || 'anonymous';
    const payload = JSON.parse(event.body || '{}');
    const { editMode, instruction, mask } = payload;

    if (!editMode) {
      return errorResponse(400, 'editMode is required');
    }
    if (!instruction) {
      return errorResponse(400, 'instruction is required');
    }

    const panel = await loadPanelById(panelId);
    if (!panel) {
      return errorResponse(404, `Panel ${panelId} not found`);
    }

    const jobId = uuid();
    const timestamp = new Date().toISOString();
    const timestampNumber = Date.now();

    await createJob({
      jobId,
      userId,
      panel,
      editMode,
      instruction,
      timestamp,
      timestampNumber
    });

    try {
      const result = await processEdit({
        panel,
        editMode,
        instruction,
        mask,
        jobId,
        userId
      });

      await updateJob(jobId, {
        status: 'completed',
        result,
        progress: {
          total: 1,
          completed: 1,
          failed: 0,
          percentage: 100
        }
      });

      return successResponse(
        {
          jobId,
          result
        },
        202
      );
    } catch (processingError) {
      console.error('[EditPanel] Processing failed:', processingError);
      await updateJob(jobId, {
        status: 'failed',
        error: processingError.message,
        progress: {
          total: 1,
          completed: 0,
          failed: 1,
          percentage: 0
        }
      });
      return errorResponse(500, processingError.message || 'Failed to edit panel');
    }
  } catch (error) {
    console.error('[EditPanel] Unexpected error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

async function processEdit({ panel, editMode, instruction, mask, jobId, userId }) {
  const adapter = await getImagenAdapter();
  const panelPrompt = buildPanelPrompt(panel, {}, { mode: selectMode(panel) });
  const aspectRatio = determineAspectRatio(panel) || '16:9';
  const baseKey = selectPanelImageKey(panel);

  if (!baseKey) {
    throw new Error('Panel does not have an existing image to edit');
  }

  const sourceUri = baseKey.startsWith('s3://') ? baseKey : `s3://${ASSETS_BUCKET}/${baseKey}`;
  const sourceImageBase64 = await s3ImageToBase64(sourceUri);

  const mode = selectMode(panel);
  const promptParts = [panelPrompt.text, instruction];
  if (mask?.region) {
    promptParts.push(`Focus on region ${JSON.stringify(mask.region)}`);
  }
  const prompt = promptParts.filter(Boolean).join('. ');

  let imageResult;
  switch (editMode) {
    case 'inpaint':
      imageResult = await adapter.edit({
        prompt,
        sourceImage: sourceImageBase64,
        aspectRatio,
        mode
      });
      break;
    case 'bg_swap':
      imageResult = await adapter.edit({
        prompt,
        sourceImage: sourceImageBase64,
        aspectRatio,
        mode
      });
      break;
    case 'outpaint': {
      imageResult = await adapter.generate({
        prompt,
        negativePrompt: panelPrompt.negativePrompt,
        aspectRatio,
        mode,
        referenceImages: [sourceImageBase64]
      });
      break;
    }
    default:
      throw new Error(`Unsupported edit mode: ${editMode}`);
  }

  const s3Key = `edits/panels/${panel.id}/${jobId}-${editMode}-${mode}.png`;
  await uploadImage(s3Key, imageResult.buffer, {
    contentType: imageResult.mimeType || 'image/png',
    metadata: {
      'panel-id': panel.id,
      'job-id': jobId,
      'edit-mode': editMode,
      mode
    }
  });

  const updatedAt = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: panel.PK,
        SK: panel.SK
      },
      UpdateExpression:
        'SET imagesS3.#mode = :s3Key, updatedAt = :updatedAt, editHistory = list_append(if_not_exists(editHistory, :empty), :entry)',
      ExpressionAttributeNames: {
        '#mode': mode
      },
      ExpressionAttributeValues: {
        ':s3Key': s3Key,
        ':updatedAt': updatedAt,
        ':empty': [],
        ':entry': [
          {
            jobId,
            userId,
            mode,
            editMode,
            s3Key,
            instruction,
            createdAt: updatedAt
          }
        ]
      }
    })
  );

  return {
    panelId: panel.id,
    s3Key,
    mode,
    editMode,
    instruction
  };
}

async function createJob({ jobId, userId, panel, editMode, instruction, timestamp, timestampNumber }) {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `JOB#${jobId}`,
        SK: `JOB#${jobId}`,
        id: jobId,
        type: 'panel_edit',
        status: 'in_progress',
        panelId: panel.id,
        storyboardId: panel.storyboardId,
        novelId: panel.novelId,
        userId,
        request: {
          editMode,
          instruction
        },
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
        GSI2PK: `PANEL#${panel.id}`,
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

async function loadPanelById(panelId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `PANEL#${panelId}`,
        ':sk': `PANEL#${panelId}`
      },
      Limit: 1
    })
  );
  return result.Items?.[0] || null;
}

function selectPanelImageKey(panel) {
  if (panel.imagesS3?.hd) {
    return panel.imagesS3.hd;
  }
  if (panel.imagesS3?.preview) {
    return panel.imagesS3.preview;
  }
  return null;
}

function selectMode(panel) {
  if (panel.imagesS3?.hd) {
    return 'hd';
  }
  if (panel.imagesS3?.preview) {
    return 'preview';
  }
  return 'preview';
}

function determineAspectRatio(panel) {
  if (!panel) return null;
  const layout = panel.layout || {};
  if (layout.aspectRatio) {
    return layout.aspectRatio;
  }
  if (layout.width && layout.height) {
    return `${layout.width}:${layout.height}`;
  }
  return null;
}

async function getImagenAdapter() {
  if (!imagenAdapterPromise) {
    imagenAdapterPromise = (async () => {
      const config = await getGeminiConfig();
      return new ImagenAdapter({
        apiKey: config.apiKey,
        projectId: config.projectId,
        location: config.location,
        model: config.model,
        forceMock: !config.apiKey
      });
    })();
  }
  return imagenAdapterPromise;
}
