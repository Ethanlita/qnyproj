jest.mock('../../lib/bible-manager');

const BibleManager = require('../../lib/bible-manager');
const { handler } = require('./index');

describe('BibleFunction handler', () => {
  beforeEach(() => {
    BibleManager.mockReset();
    process.env.BIBLES_TABLE_NAME = 'test-bibles-table';
    process.env.ASSETS_BUCKET = 'test-assets-bucket';
    delete process.env.BIBLES_BUCKET;
  });

  it('returns latest bible when available', async () => {
    const getBible = jest.fn().mockResolvedValue({
      exists: true,
      novelId: 'novel-123',
      version: 2,
      characters: [{ name: 'Hero' }],
      scenes: [{ id: 'town' }],
      metadata: { updatedAt: '2025-01-01T00:00:00Z' }
    });
    const listHistory = jest.fn();

    BibleManager.mockImplementation(() => ({
      getBible,
      listHistory
    }));

    const response = await handler({
      httpMethod: 'GET',
      resource: '/novels/{novelId}/bible',
      pathParameters: { novelId: 'novel-123' },
      queryStringParameters: null
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.version).toBe(2);
    expect(payload.characters).toHaveLength(1);
    expect(getBible).toHaveBeenCalledWith('novel-123');
    expect(listHistory).not.toHaveBeenCalled();
  });

  it('returns 404 when bible does not exist', async () => {
    BibleManager.mockImplementation(() => ({
      getBible: jest.fn().mockResolvedValue({
        exists: false,
        characters: [],
        scenes: [],
        metadata: {}
      }),
      listHistory: jest.fn()
    }));

    const response = await handler({
      httpMethod: 'GET',
      resource: '/novels/{novelId}/bible',
      pathParameters: { novelId: 'novel-404' },
      queryStringParameters: null
    });

    expect(response.statusCode).toBe(404);
    const payload = JSON.parse(response.body);
    expect(payload.error).toBe('Bible not found');
  });

  it('validates version parameter', async () => {
    const getBible = jest.fn();
    BibleManager.mockImplementation(() => ({
      getBible,
      listHistory: jest.fn()
    }));

    const response = await handler({
      httpMethod: 'GET',
      resource: '/novels/{novelId}/bible',
      pathParameters: { novelId: 'novel-123' },
      queryStringParameters: { version: 'abc' }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('Invalid version parameter');
    expect(getBible).not.toHaveBeenCalled();
  });

  it('returns bible history list', async () => {
    const getBible = jest.fn();
    const listHistory = jest.fn().mockResolvedValue([
      { version: 1, updatedAt: '2025-01-01T00:00:00Z' },
      { version: 2, updatedAt: '2025-01-02T00:00:00Z' }
    ]);

    BibleManager.mockImplementation(() => ({
      getBible,
      listHistory
    }));

    const response = await handler({
      httpMethod: 'GET',
      resource: '/novels/{novelId}/bible/history',
      pathParameters: { novelId: 'novel-123' },
      queryStringParameters: { limit: '10' }
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload).toHaveLength(2);
    expect(listHistory).toHaveBeenCalledWith('novel-123', { limit: 10 });
  });

  it('returns 400 for invalid history limit', async () => {
    const listHistory = jest.fn();
    BibleManager.mockImplementation(() => ({
      getBible: jest.fn(),
      listHistory
    }));

    const response = await handler({
      httpMethod: 'GET',
      resource: '/novels/{novelId}/bible/history',
      pathParameters: { novelId: 'novel-123' },
      queryStringParameters: { limit: '-5' }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('Invalid limit parameter');
    expect(listHistory).not.toHaveBeenCalled();
  });

  it('returns 400 when novelId missing', async () => {
    const response = await handler({
      httpMethod: 'GET',
      resource: '/novels/{novelId}/bible',
      pathParameters: {},
      queryStringParameters: null
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('Missing novelId path parameter');
  });
});
