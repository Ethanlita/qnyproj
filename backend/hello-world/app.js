/**
 * Lambda handler for API Gateway integration
 * Supports multiple routes: /items and /edge-probe
 * 
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html 
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 */
exports.lambdaHandler = async (event, context) => {
    try {
        // 路由处理
        const path = event.path || event.rawPath;
        const method = event.httpMethod || event.requestContext?.http?.method;
        
        // Edge Probe endpoint - 返回请求头信息
        if (path === '/edge-probe' || path === '/dev/edge-probe') {
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    receivedHost: event.headers?.Host || event.headers?.host || 'unknown',
                    requestContextDomain: event.requestContext?.domainName || 'unknown',
                    method: method,
                    path: path,
                    headers: event.headers || {},
                    timestamp: new Date().toISOString()
                })
            };
        }
        
        // Items endpoint - 返回示例数据
        if (path === '/items' || path === '/dev/items') {
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify([
                    { id: 1, name: 'My Awesome Item' },
                    { id: 2, name: 'Another Great Item' }
                ])
            };
        }
        
        // 默认响应
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                message: 'Hello from Lambda!',
                path: path,
                method: method
            })
        };
        
    } catch (err) {
        console.error('Error:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: err.message
            })
        };
    }
};
