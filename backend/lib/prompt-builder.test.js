const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

describe('prompt builder utilities', () => {
  const originalBucket = process.env.ASSETS_BUCKET;

  beforeEach(() => {
    process.env.ASSETS_BUCKET = 'test-bucket';
  });

  afterEach(() => {
    process.env.ASSETS_BUCKET = originalBucket;
  });

  it('buildCharacterPrompt assembles key traits with default negative prompt', () => {
    const { buildCharacterPrompt, DEFAULT_NEGATIVE_PROMPT } = require('./prompt-builder');

    const prompt = buildCharacterPrompt({
      name: 'Alice',
      role: 'protagonist',
      appearance: {
        gender: 'female',
        age: 18,
        clothing: ['armor'],
        distinctiveFeatures: ['scar']
      },
      tags: ['hero']
    }, { view: 'front', mode: 'hd' });

    expect(prompt.text).toContain('Alice');
    expect(prompt.text).toContain('high resolution');
    expect(prompt.text).toContain('armor');
    expect(prompt.negativePrompt).toBe(DEFAULT_NEGATIVE_PROMPT);
  });

  it('buildPanelPrompt returns fallback reference when none provided', () => {
    const { buildPanelPrompt } = require('./prompt-builder');

    const panelPrompt = buildPanelPrompt({
      scene: 'Forest at night',
      characters: [
        { charId: 'char-1', name: 'Alice', pose: 'standing', expression: 'determined' }
      ]
    }, {
      'char-1': {
        portraitsS3: [],
        gcsPortraitUris: []
      }
    }, { mode: 'preview' });

    expect(panelPrompt.text).toContain('Forest at night');
    expect(panelPrompt.referenceImages).toContain('s3://test-bucket/characters/char-1/default/portrait-fallback.png');
  });

  it('buildPanelPrompt merges reference sources without duplicates', () => {
    const { buildPanelPrompt } = require('./prompt-builder');

    const panelPrompt = buildPanelPrompt({
      scene: 'Castle hall',
      characters: [
        { charId: 'char-2', name: 'Bob', pose: 'running', expression: 'surprised' }
      ]
    }, {
      'char-2': {
        portraitsS3: ['characters/char-2/portrait.png'],
        gcsPortraitUris: ['gs://bucket/portrait.png']
      }
    }, { mode: 'hd' });

    expect(panelPrompt.referenceImages).toEqual([
      'gs://bucket/portrait.png',
      's3://test-bucket/characters/char-2/portrait.png'
    ]);
    expect(panelPrompt.text).toContain('high resolution detailed render');
    expect(panelPrompt.text).toContain('Bob');
  });
});
