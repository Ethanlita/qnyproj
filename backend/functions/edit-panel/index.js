const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

/**
 * 编辑面板 Lambda 函数 (Mock 实现)
 * 真实实现在 M4 阶段
 */
exports.handler = async (event) => {
  try {
    const panelId = event.pathParameters?.panelId;
    const userId = getUserId(event) || 'mock-user';
    const body = JSON.parse(event.body || '{}');
    
    console.log(`Editing panel: ${panelId}, mode: ${body.editMode}`);
    
    const jobId = uuid();
    
    return successResponse({
      jobId
    }, 202);
    
  } catch (error) {
    console.error('EditPanelFunction error:', error);
    return errorResponse(500, error.message);
  }
};



