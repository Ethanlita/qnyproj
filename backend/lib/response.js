/**
 * 统一响应格式工具函数
 */

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };
}

function successResponse(data, statusCode = 200) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(data)
  };
}

function errorResponse(statusCode, message, details = null) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({
      error: message,
      ...(details && { details })
    })
  };
}

module.exports = {
  corsHeaders,
  successResponse,
  errorResponse
};



