const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  GetCommand
} = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { getQwenConfig, getGeminiConfig } = require('../../lib/ai-secrets');
const QwenAdapter = require('../../lib/qwen-adapter');
const ImagenAdapter = require('../../lib/imagen-adapter');
const { uploadImage } = require('../../lib/s3-utils');
const { s3ImageToBase64 } = require('../../lib/s3-image-utils');
const { buildPanelPrompt } = require('../../lib/prompt-builder');
const { v4: uuid } = require('uuid');
const CR_DSL_SCHEMA = require('../../schemas/cr-dsl.json');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const ASSETS_BUCKET = process.env.ASSETS_BUCKET;

let qwenAdapterPromise = null;
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
      console.error('[ChangeRequest] TABLE_NAME not configured');
      return errorResponse(500, 'TABLE_NAME environment variable not set');
    }
    if (!ASSETS_BUCKET) {
      console.error('[ChangeRequest] ASSETS_BUCKET not configured');
      return errorResponse(500, 'ASSETS_BUCKET environment variable not set');
    }

    const userId = getUserId(event);
    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }
    const body = JSON.parse(event.body || '{}');
    const { novelId, naturalLanguage, context = {} } = body;

    if (!novelId) {
      return errorResponse(400, 'novelId is required');
    }
    if (!naturalLanguage || typeof naturalLanguage !== 'string') {
      return errorResponse(400, 'naturalLanguage is required');
    }

    const novel = await loadNovel(novelId);
    if (!novel) {
      return errorResponse(404, `Novel ${novelId} not found`);
    }
    if (!novel.storyboardId) {
      return errorResponse(409, 'Storyboard not generated yet. Run /novels/{id}/analyze first.');
    }

    const crId = uuid();
    const jobId = uuid();
    const timestamp = new Date().toISOString();
    const timestampNumber = Date.now();

    const crItem = {
      PK: `NOVEL#${novelId}`,
      SK: `CR#${crId}`,
      id: crId,
      novelId,
      storyboardId: novel.storyboardId,
      naturalLanguage,
      status: 'parsing',
      userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      context,
      GSI1PK: `USER#${userId}`,
      GSI1SK: `CR#${timestampNumber}`,
      GSI2PK: `NOVEL#${novelId}`,
      GSI2SK: timestampNumber
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: crItem
      })
    );

    const qwen = await getQwenAdapter();
    const dsl = await qwen.parseChangeRequest({
      naturalLanguage,
      jsonSchema: CR_DSL_SCHEMA,
      context: {
        novelId,
        storyboardId: novel.storyboardId,
        ...context
      }
    });

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `NOVEL#${novelId}`,
          SK: `CR#${crId}`
        },
        UpdateExpression: 'SET dsl = :dsl, #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':dsl': dsl,
          ':status': 'pending',
          ':updatedAt': new Date().toISOString()
        }
      })
    );

    const jobItem = {
      PK: `JOB#${jobId}`,
      SK: `JOB#${jobId}`,
      id: jobId,
      type: 'change_request',
      status: 'in_progress',
      novelId,
      storyboardId: novel.storyboardId,
      crId,
      userId,
      progress: {
        total: dsl.ops?.length || 1,
        completed: 0,
        failed: 0,
        percentage: 0
      },
      result: {
        scope: dsl.scope,
        type: dsl.type,
        targetId: dsl.targetId,
        operations: []
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      GSI1PK: `USER#${userId}`,
      GSI1SK: `JOB#${timestampNumber}`,
      GSI2PK: `NOVEL#${novelId}`,
      GSI2SK: timestampNumber
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: jobItem
      })
    );

    try {
      const executionResult = await executeChangeRequest({
        dsl,
        crId,
        jobId,
        novel,
        userId,
        naturalLanguage
      });

      await finalizeChangeRequest({
        crId,
        novelId,
        jobId,
        status: 'completed'
      });

      return successResponse(
        {
          crId,
          jobId,
          dsl,
          result: executionResult,
          message: 'Change request completed'
        },
        202
      );
    } catch (executionError) {
      console.error('[ChangeRequest] Execution failed:', executionError);

      await finalizeChangeRequest({
        crId,
        novelId,
        jobId,
        status: 'failed',
        error: executionError.message
      });

      return errorResponse(500, `Failed to execute change request: ${executionError.message}`);
    }
  } catch (error) {
    console.error('[ChangeRequest] Unexpected error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

async function getQwenAdapter() {
  if (!qwenAdapterPromise) {
    qwenAdapterPromise = (async () => {
      const config = await getQwenConfig();
      if (!config.apiKey) {
        console.warn('[ChangeRequest] Qwen API key missing, running in mock mode');
      }
      return new QwenAdapter({
        apiKey: config.apiKey || 'mock-key',
        endpoint: config.endpoint,
        model: config.model || 'qwen-plus'
      });
    })();
  }
  return qwenAdapterPromise;
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

async function executeChangeRequest({ dsl, crId, jobId, novel, userId, naturalLanguage }) {
  const progress = {
    total: dsl.ops?.length || 1,
    completed: 0,
    failed: 0,
    percentage: 0
  };

  const result = {
    scope: dsl.scope,
    type: dsl.type,
    targetId: dsl.targetId,
    operations: []
  };

  const storyboardId = novel.storyboardId;
  const jobKey = {
    PK: `JOB#${jobId}`,
    SK: `JOB#${jobId}`
  };

  const sharedContext = {
    storyboardId,
    crId,
    jobId,
    userId,
    naturalLanguage
  };

  if (!Array.isArray(dsl.ops) || dsl.ops.length === 0) {
    throw new Error('Parsed CR-DSL does not contain any operations');
  }

  for (const op of dsl.ops) {
    try {
      let opResult;
      switch (dsl.type) {
        case 'art':
          opResult = await executeArtOperation(dsl, op, sharedContext);
          break;
        case 'dialogue':
          opResult = await executeDialogueOperation(dsl, op, sharedContext);
          break;
        case 'layout':
          opResult = await executeLayoutOperation(dsl, op, sharedContext);
          break;
        case 'style':
          opResult = await executeStyleOperation(dsl, op, sharedContext);
          break;
        default:
          throw new Error(`Unsupported change request type: ${dsl.type}`);
      }

      result.operations.push({
        action: op.action,
        status: 'completed',
        output: opResult
      });

      progress.completed += 1;
      progress.percentage = Math.round((progress.completed / progress.total) * 100);

      await updateJob(jobKey, {
        status: progress.completed === progress.total ? 'completed' : 'in_progress',
        progress,
        result
      });
    } catch (error) {
      progress.failed += 1;
      progress.percentage = Math.round((progress.completed / progress.total) * 100);

      result.operations.push({
        action: op.action,
        status: 'failed',
        error: error.message
      });

      await updateJob(jobKey, {
        status: 'failed',
        progress,
        result,
        error: error.message
      });

      throw error;
    }
  }

  return result;
}

async function executeArtOperation(dsl, op, context) {
  if (!dsl.targetId) {
    throw new Error('Art change requests require targetId (panel id)');
  }

  const panel = await loadPanelById(dsl.targetId);
  if (!panel) {
    throw new Error(`Panel ${dsl.targetId} not found`);
  }

  const adapter = await getImagenAdapter();
  const aspectRatio = determineAspectRatio(panel) || '16:9';
  const mode = selectImageMode(panel, op);
  const panelPrompt = buildPanelPrompt(panel, {}, { mode });
  const promptSuffix = buildPromptSuffix(op);
  const now = new Date().toISOString();

  switch (op.action) {
    case 'inpaint':
    case 'bg_swap':
    case 'outpaint':
    case 'repose':
    case 'regen_panel': {
      const baseKey = selectPanelImageKey(panel, mode);
      let sourceImageBase64 = null;
      if (baseKey) {
        const sourceUri = baseKey.startsWith('s3://') ? baseKey : `s3://${ASSETS_BUCKET}/${baseKey}`;
        sourceImageBase64 = await s3ImageToBase64(sourceUri);
      }

      const prompt = [panelPrompt.text, promptSuffix].filter(Boolean).join('. ');
      let imageResult;

      if (op.action === 'inpaint' || op.action === 'bg_swap' || op.action === 'repose') {
        if (!sourceImageBase64) {
          throw new Error(`Panel ${panel.id} does not have an existing image to edit`);
        }
        imageResult = await adapter.edit({
          prompt,
          sourceImage: sourceImageBase64,
          aspectRatio,
          mode
        });
      } else if (op.action === 'outpaint') {
        imageResult = await adapter.generate({
          prompt,
          negativePrompt: panelPrompt.negativePrompt,
          mode,
          aspectRatio,
          referenceImages: sourceImageBase64 ? [sourceImageBase64] : []
        });
      } else {
        imageResult = await adapter.generate({
          prompt,
          negativePrompt: panelPrompt.negativePrompt,
          mode,
          aspectRatio
        });
      }

      const s3Key = `edits/${panel.id}/${context.crId}/${Date.now()}-${op.action}-${mode}.png`;
      await uploadImage(s3Key, imageResult.buffer, {
        contentType: imageResult.mimeType || 'image/png',
        metadata: {
          'panel-id': panel.id,
          'change-request-id': context.crId,
          'operation': op.action,
          mode
        }
      });

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
            ':updatedAt': now,
            ':empty': [],
            ':entry': [
              {
                jobId: context.jobId,
                crId: context.crId,
                action: op.action,
                s3Key,
                mode,
                createdAt: now
              }
            ]
          }
        })
      );

      return { s3Key, mode };
    }
    case 'add_effect': {
      const effect = op.params?.effect || 'tone';
      const intensity = typeof op.params?.intensity === 'number' ? op.params.intensity : 0.5;

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: panel.PK,
            SK: panel.SK
          },
          UpdateExpression:
            'SET effects = list_append(if_not_exists(effects, :empty), :entry), updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':empty': [],
            ':entry': [
              {
                effect,
                intensity,
                createdAt: now,
                crId: context.crId
              }
            ],
            ':updatedAt': now
          }
        })
      );

      return { effect, intensity };
    }
    case 'resize': {
      const width = Number(op.params?.width);
      const height = Number(op.params?.height);
      if (!width || !height) {
        throw new Error('resize action requires width and height params');
      }

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: panel.PK,
            SK: panel.SK
          },
          UpdateExpression: 'SET #layout.width = :width, #layout.height = :height, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#layout': 'layout'
          },
          ExpressionAttributeValues: {
            ':width': width,
            ':height': height,
            ':updatedAt': now
          }
        })
      );

      return { width, height };
    }
    default:
      throw new Error(`Unsupported art action: ${op.action}`);
  }
}

async function executeDialogueOperation(dsl, op, context) {
  if (!dsl.targetId) {
    throw new Error('Dialogue change requests require targetId (panel id)');
  }

  const panel = await loadPanelById(dsl.targetId);
  if (!panel) {
    throw new Error(`Panel ${dsl.targetId} not found`);
  }

  const dialogues = Array.isArray(panel.dialogue) ? panel.dialogue.slice() : [];
  let targetIndex = -1;

  if (op.params?.dialogueId) {
    targetIndex = dialogues.findIndex((item) => item.id === op.params.dialogueId);
  }
  if (targetIndex === -1 && op.params?.speaker) {
    targetIndex = dialogues.findIndex((item) => item.speaker === op.params.speaker);
  }
  if (targetIndex === -1 && dialogues.length > 0) {
    targetIndex = 0;
  }

  const qwen = await getQwenAdapter();
  const original = targetIndex >= 0 ? dialogues[targetIndex] : null;
  const originalText = original?.text || '';

  let newText = op.params?.newText;
  if (!newText || newText.trim().length === 0) {
    const instruction =
      op.params?.prompt ||
      op.params?.instruction ||
      context.naturalLanguage ||
      'Rewrite dialogue to match instruction';
    newText = await qwen.rewriteDialogue(originalText, instruction);
  }

  const updatedDialogue = {
    ...(original || {}),
    speaker: op.params?.speaker || original?.speaker || 'Unknown',
    text: newText,
    bubbleType: original?.bubbleType || 'speech',
    id: original?.id || `dlg-${uuid()}`
  };

  if (targetIndex >= 0) {
    dialogues[targetIndex] = updatedDialogue;
  } else {
    dialogues.push(updatedDialogue);
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: panel.PK,
        SK: panel.SK
      },
      UpdateExpression: 'SET dialogue = :dialogue, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':dialogue': dialogues,
        ':updatedAt': new Date().toISOString()
      }
    })
  );

  return {
    dialogueId: updatedDialogue.id,
    speaker: updatedDialogue.speaker,
    text: updatedDialogue.text
  };
}

async function executeLayoutOperation(dsl, op, context) {
  const panel = dsl.targetId ? await loadPanelById(dsl.targetId) : null;
  if (!panel) {
    throw new Error(`Panel ${dsl.targetId} not found for layout operation`);
  }

  const storyboardId = panel.storyboardId;

  switch (op.action) {
    case 'reorder': {
      const fromIndex =
        typeof op.params?.fromIndex === 'number' ? op.params.fromIndex : panel.index;
      const toIndex =
        typeof op.params?.toIndex === 'number' ? op.params.toIndex : panel.index;

      if (fromIndex === toIndex) {
        return { index: toIndex, page: panel.page };
      }

      const panels = await loadPanelsByPage(storyboardId, panel.page);
      if (panels.length === 0) {
        throw new Error(`No panels found on page ${panel.page}`);
      }

      const sorted = panels.sort((a, b) => a.index - b.index);
      const movingIndex = sorted.findIndex((item) => item.id === panel.id);
      if (movingIndex === -1) {
        throw new Error(`Panel ${panel.id} not found in page collection`);
      }

      const [moving] = sorted.splice(movingIndex, 1);
      sorted.splice(toIndex, 0, moving);

      await Promise.all(
        sorted.map(async (item, idx) => {
          if (item.index === idx) return;
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: {
                PK: item.PK,
                SK: item.SK
              },
              UpdateExpression: 'SET #index = :index, updatedAt = :updatedAt',
              ExpressionAttributeNames: {
                '#index': 'index'
              },
              ExpressionAttributeValues: {
                ':index': idx,
                ':updatedAt': new Date().toISOString()
              }
            })
          );
        })
      );

      return { page: panel.page, order: sorted.map((item) => item.id) };
    }
    case 'resize': {
      const width = Number(op.params?.width);
      const height = Number(op.params?.height);

      if (!width || !height) {
        throw new Error('resize action requires width and height params');
      }

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: panel.PK,
            SK: panel.SK
          },
          UpdateExpression:
            'SET #layout.width = :width, #layout.height = :height, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#layout': 'layout'
          },
          ExpressionAttributeValues: {
            ':width': width,
            ':height': height,
            ':updatedAt': new Date().toISOString()
          }
        })
      );

      return { width, height };
    }
    default:
      throw new Error(`Unsupported layout action: ${op.action}`);
  }
}

async function executeStyleOperation(dsl, op, context) {
  const storyboard = await loadStoryboard(context.storyboardId);
  if (!storyboard) {
    throw new Error(`Storyboard ${context.storyboardId} not found`);
  }

  const overrides = Object.assign({}, storyboard.styleOverrides || {});

  if (op.params?.prompt) {
    overrides.prompt = op.params.prompt;
  }
  if (op.params?.style) {
    overrides.style = op.params.style;
  }
  if (op.params?.palette) {
    overrides.palette = op.params.palette;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `STORYBOARD#${storyboard.id}`,
        SK: `STORYBOARD#${storyboard.id}`
      },
      UpdateExpression:
        'SET styleOverrides = :overrides, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':overrides': overrides,
        ':updatedAt': new Date().toISOString()
      }
    })
  );

  return overrides;
}

async function updateJob(jobKey, { status, progress, result, error }) {
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
      Key: jobKey,
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
      ExpressionAttributeValues: values
    })
  );
}

async function finalizeChangeRequest({ crId, novelId, jobId, status, error }) {
  const timestamp = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `NOVEL#${novelId}`,
        SK: `CR#${crId}`
      },
      UpdateExpression: 'SET #status = :status, jobId = :jobId, updatedAt = :updatedAt, error = :error',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':jobId': jobId,
        ':updatedAt': timestamp,
        ':error': error || null
      }
    })
  );
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
  const item = result.Items?.[0];
  if (!item) {
    return null;
  }
  return item;
}

async function loadPanelsByPage(storyboardId, page) {
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
  return (result.Items || [])
    .filter((item) => item.page === page)
    .map((item) => item);
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

function selectImageMode(panel, op) {
  if (op.params?.mode) {
    return op.params.mode;
  }
  if (panel.imagesS3?.hd) {
    return 'hd';
  }
  if (panel.imagesS3?.preview) {
    return 'preview';
  }
  return 'preview';
}

function selectPanelImageKey(panel, mode) {
  if (!panel.imagesS3) return null;
  if (panel.imagesS3[mode]) {
    return panel.imagesS3[mode];
  }
  const keys = Object.values(panel.imagesS3);
  return keys.length > 0 ? keys[0] : null;
}

function buildPromptSuffix(op) {
  if (!op || !op.params) {
    return '';
  }

  const parts = [];

  if (op.params.prompt) {
    parts.push(op.params.prompt);
  }
  if (op.params.instruction) {
    parts.push(op.params.instruction);
  }
  if (op.params.region) {
    parts.push(`Focus on region ${JSON.stringify(op.params.region)}`);
  }
  if (op.params.backgroundPrompt) {
    parts.push(`Replace background with ${op.params.backgroundPrompt}`);
  }
  if (op.params.pose) {
    parts.push(`Update character pose to ${op.params.pose}`);
  }

  return parts.join('. ');
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
