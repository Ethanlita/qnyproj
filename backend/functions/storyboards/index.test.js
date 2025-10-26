const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddbMock = mockClient(DynamoDBDocumentClient);

process.env.TABLE_NAME = 'test-table';

const { handler } = require('./index');

function buildEvent(overrides = {}) {
  return {
    httpMethod: 'GET',
    pathParameters: {},
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-1'
        }
      },
      http: { method: 'GET' }
    },
    ...overrides
  };
}

describe('StoryboardsFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('lists storyboards for a novel in chapter order', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'NOVEL#novel-1',
        SK: 'NOVEL#novel-1',
        userId: 'user-1'
      }
    });
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          id: 'sb-2',
          novelId: 'novel-1',
          chapterNumber: 2,
          totalPages: 8,
          totalPanels: 24,
          status: 'generated',
          createdAt: '2024-01-02T00:00:00.000Z'
        },
        {
          id: 'sb-1',
          novelId: 'novel-1',
          chapterNumber: 1,
          totalPages: 6,
          totalPanels: 18,
          status: 'generated',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      ]
    });

    const response = await handler(
      buildEvent({ pathParameters: { id: 'novel-1' } })
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: 'sb-1',
      chapterNumber: 1,
      totalPages: 6,
      panelCount: 18
    });
    expect(body.items[1]).toMatchObject({
      id: 'sb-2',
      chapterNumber: 2
    });
  });

  it('rejects access when user does not own the novel', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'NOVEL#novel-1',
        SK: 'NOVEL#novel-1',
        userId: 'other-user'
      }
    });

    const response = await handler(
      buildEvent({ pathParameters: { id: 'novel-1' } })
    );

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toMatch(/not allowed/i);
  });
});
