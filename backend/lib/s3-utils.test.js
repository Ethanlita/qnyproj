const { describe, it, expect, beforeEach } = require('@jest/globals');

const mockSend = jest.fn();
const mockPresign = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    CopyObjectCommand: jest.fn().mockImplementation((input) => ({ input }))
  };
});

jest.mock(
  '@aws-sdk/s3-request-presigner',
  () => ({
    getSignedUrl: (...args) => mockPresign(...args)
  }),
  { virtual: true }
);

describe('s3-utils helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSend.mockReset();
    mockPresign.mockReset();
    process.env.ASSETS_BUCKET = 'test-bucket';
  });

  it('uploads image with expected parameters', async () => {
    const { uploadImage } = require('./s3-utils');
    mockSend.mockResolvedValueOnce({});

    const uri = await uploadImage('folder/file.png', Buffer.from('data'), {
      contentType: 'image/png',
      metadata: { foo: 'bar' }
    });

    expect(uri).toBe('s3://test-bucket/folder/file.png');
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'folder/file.png',
        ContentType: 'image/png'
      })
    }));
  });

  it('generates presigned URL when presigner available', async () => {
    mockPresign.mockResolvedValueOnce('https://signed-url');
    const { getPresignedUrl } = require('./s3-utils');

    const url = await getPresignedUrl('folder/file.png', 600);
    expect(url).toBe('https://signed-url');
    expect(mockPresign).toHaveBeenCalled();
  });

  it('falls back to unsigned URL when presigner unavailable', async () => {
    jest.resetModules();
    mockSend.mockReset();
    mockPresign.mockReset();
    process.env.ASSETS_BUCKET = 'fallback-bucket';

    jest.doMock(
      '@aws-sdk/s3-request-presigner',
      () => {
        throw new Error('module not found');
      },
      { virtual: true }
    );

    let promise;
    jest.isolateModules(() => {
      const { getPresignedUrl } = require('./s3-utils');
      promise = getPresignedUrl('file.txt');
    });

    await expect(promise).resolves.toBe('https://fallback-bucket.s3.amazonaws.com/file.txt?fallback=1&expiresIn=900');
  });

  it('throws when bucket not configured', async () => {
    delete process.env.ASSETS_BUCKET;
    jest.resetModules();

    const { uploadImage } = require('./s3-utils');
    await expect(uploadImage('key', Buffer.from('1'))).rejects.toThrow('ASSETS_BUCKET environment variable not set');
  });
});
