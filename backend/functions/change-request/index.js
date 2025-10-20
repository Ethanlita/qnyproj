const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

/**
 * 修改请求 Lambda 函数 (Mock 实现)
 * 真实实现在 M4 阶段
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event) || 'mock-user';
    const body = JSON.parse(event.body || '{}');
    const { novelId, naturalLanguage } = body;
    
    console.log(`Change request for novel: ${novelId}`);
    console.log(`Natural language: ${naturalLanguage}`);
    
    const crId = uuid();
    const jobId = uuid();
    
    // Mock DSL 解析结果
    const dsl = {
      scope: 'panel',
      targetId: 'panel-003',
      type: 'art',
      ops: [
        {
          action: 'inpaint',
          params: {
            region: 'face',
            instruction: 'change expression to smile'
          }
        }
      ]
    };
    
    return successResponse({
      crId,
      jobId,
      dsl,
      message: 'Change request is being processed'
    }, 202);
    
  } catch (error) {
    console.error('ChangeRequestFunction error:', error);
    return errorResponse(500, error.message);
  }
};



