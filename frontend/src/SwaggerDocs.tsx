import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

/**
 * Swagger API 文档组件
 * 
 * 展示项目的 OpenAPI 规范文档
 * 可以直接在浏览器中测试 API
 */
export function SwaggerDocs() {
  return (
    <div style={{ height: '100vh', overflow: 'auto' }}>
      <SwaggerUI 
        url="/openapi.yaml"
        docExpansion="list"
        defaultModelsExpandDepth={1}
        defaultModelExpandDepth={1}
      />
    </div>
  );
}

export default SwaggerDocs;
