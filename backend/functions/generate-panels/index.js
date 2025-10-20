const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

/**
 * 批量生成面板图像 (Mock 实现)
 * 真实实现在 M3 阶段
 */
exports.handler = async (event) => {
  try {
    const storyboardId = event.pathParameters?.id;
    const mode = event.queryStringParameters?.mode || 'preview';
    const userId = getUserId(event) || 'mock-user';
    
    console.log(`Generating panels for storyboard: ${storyboardId}, mode: ${mode}`);
    
    const jobId = uuid();
    
    return successResponse({
      jobId,
      status: 'pending',
      totalPanels: 8,
      message: 'Panel generation started. Use GET /jobs/{jobId} to check progress.'
    }, 202);
    
  } catch (error) {
    console.error('GeneratePanelsFunction error:', error);
    return errorResponse(500, error.message);
  }
};



