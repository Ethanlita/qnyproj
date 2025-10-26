const changeRequestService = require('../change-request');

exports.handler = async (event) => {
  const records = event.Records || [];
  for (const record of records) {
    const body = parseBody(record.body);
    if (!body) {
      console.error('[ChangeRequestWorker] 无法解析的 SQS 消息');
      continue;
    }
    try {
      await changeRequestService.processChangeRequestMessage(body);
    } catch (error) {
      console.error('[ChangeRequestWorker] 处理消息失败:', error);
    }
  }
};

function parseBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (error) {
    console.error('[ChangeRequestWorker] JSON 解析失败:', error);
    return null;
  }
}
