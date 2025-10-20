const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

/**
 * 分析小说文本生成分镜 (Mock 实现)
 * 真实实现在 M2 阶段
 */
exports.handler = async (event) => {
  try {
    const novelId = event.pathParameters?.id;
    const userId = getUserId(event) || 'mock-user';
    const body = JSON.parse(event.body || '{}');
    
    console.log(`Analyzing novel: ${novelId} for user: ${userId}`);
    console.log('Options:', body.options);
    
    // Mock: 立即返回任务ID
    const jobId = uuid();
    
    return successResponse({
      jobId,
      status: 'pending',
      message: 'Analysis started. Use GET /jobs/{jobId} to check progress.'
    }, 202);
    
  } catch (error) {
    console.error('AnalyzeNovelFunction error:', error);
    return errorResponse(500, error.message);
  }
};



