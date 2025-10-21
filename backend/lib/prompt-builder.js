/**
 * Prompt builder utilities shared by Imagen/Gemini workflows.
 *
 * The objective is to convert strongly typed domain objects
 * (characters, panels) into rich natural language prompts that
 * emphasise composition, camera work and style consistency.
 */

const DEFAULT_NEGATIVE_PROMPT = [
  'nsfw',
  'blurry',
  'low quality',
  'extra limbs',
  'deformed hands',
  'text watermark',
  'logo',
  'cropped face',
  'overexposed',
  'underexposed'
].join(', ');

function normaliseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value];
}

function appendIfDefined(parts, value) {
  if (!value) return;
  if (Array.isArray(value) && value.length === 0) {
    return;
  }
  parts.push(value);
}

/**
 * Build a portrait prompt for a specific character configuration.
 *
 * @param {object} character - Character entity (including appearance/tags)
 * @param {object} [options]
 * @param {string} [options.view] - e.g. 'front', 'side'
 * @param {string} [options.mode] - 'preview' | 'hd'
 * @returns {{ text: string, negativePrompt: string }}
 */
function buildCharacterPrompt(character = {}, options = {}) {
  const {
    name,
    role,
    appearance = {},
    tags = []
  } = character;
  const { view = 'front', mode = 'preview' } = options;

  const parts = ['ultra detailed manga character portrait'];

  appendIfDefined(parts, `${view} view`);
  appendIfDefined(parts, `${mode === 'hd' ? 'high resolution' : 'illustrated'} render`);
  appendIfDefined(parts, role ? `${role} archetype` : null);
  appendIfDefined(parts, name);
  appendIfDefined(parts, appearance.gender);
  appendIfDefined(parts, appearance.age ? `age ${appearance.age}` : null);
  appendIfDefined(parts, appearance.build);
  appendIfDefined(parts, buildHairDescription(appearance));
  appendIfDefined(parts, appearance.eyeColor ? `${appearance.eyeColor} eyes` : null);

  const clothing = normaliseList(appearance.clothing);
  if (clothing.length > 0) {
    parts.push(`wearing ${clothing.join(', ')}`);
  }

  const accessories = normaliseList(appearance.accessories);
  if (accessories.length > 0) {
    parts.push(`accessories ${accessories.join(', ')}`);
  }

  const distinguishing = normaliseList(appearance.distinctiveFeatures);
  if (distinguishing.length > 0) {
    parts.push(`distinctive features ${distinguishing.join(', ')}`);
  }

  const tagList = normaliseList(tags);
  if (tagList.length > 0) {
    parts.push(`style keywords: ${tagList.join(', ')}`);
  }

  parts.push('studio lighting', 'clean background', 'line art with screentone shading');

  return {
    text: parts.join(', '),
    negativePrompt: DEFAULT_NEGATIVE_PROMPT
  };
}

function buildHairDescription(appearance) {
  const { hairColor, hairStyle } = appearance || {};
  if (!hairColor && !hairStyle) return null;
  if (hairColor && hairStyle) {
    return `${hairColor} ${hairStyle} hair`;
  }
  return hairColor ? `${hairColor} hair` : `${hairStyle} hair`;
}

/**
 * Build a panel prompt that blends scene context and character details.
 *
 * @param {object} panel - Panel record from DynamoDB
 * @param {object} [characterRefs] - Map of charId -> { portraits, appearance }
 * @param {object} [options]
 * @param {string} [options.mode] - preview | hd
 * @returns {{ text: string, negativePrompt: string, referenceImages: string[] }}
 */
function buildPanelPrompt(panel = {}, characterRefs = {}, options = {}) {
  const { mode = 'preview' } = options;
  const {
    scene,
    shotType,
    cameraAngle,
    mood,
    composition,
    artStyle,
    characters = [],
    visualPrompt
  } = panel;

  const parts = ['manga panel illustration'];
  appendIfDefined(parts, mode === 'hd' ? 'high resolution detailed render' : 'preview quality');
  appendIfDefined(parts, scene);
  appendIfDefined(parts, shotType ? `${shotType} shot` : null);
  appendIfDefined(parts, cameraAngle ? `camera angle ${cameraAngle}` : null);
  appendIfDefined(parts, mood ? `mood ${mood}` : null);

  if (composition && typeof composition === 'object') {
    appendIfDefined(parts, composition.focusPoint ? `focus on ${composition.focusPoint}` : null);
    appendIfDefined(parts, composition.rule ? `${composition.rule} composition` : null);
  }

  if (artStyle && typeof artStyle === 'object') {
    appendIfDefined(parts, artStyle.genre);
    appendIfDefined(parts, artStyle.lineWeight ? `${artStyle.lineWeight} line weight` : null);
    appendIfDefined(parts, artStyle.shading ? `${artStyle.shading} shading` : null);
    appendIfDefined(parts, artStyle.colorPalette ? `${artStyle.colorPalette} palette` : null);
  }

  const refUris = [];
  for (const character of normaliseList(characters)) {
    const { name, pose, expression, charId, configId } = character || {};
    appendIfDefined(parts, formatCharacterDescriptor({ name, pose, expression }));

    if (charId && characterRefs[charId]) {
      const { portraitsS3 = [], gcsPortraitUris = [] } = characterRefs[charId];
      const portraitUris = collectReferenceUris(portraitsS3, gcsPortraitUris, { charId, configId, mode });
      refUris.push(...portraitUris);
    }
  }

  appendIfDefined(parts, visualPrompt);
  parts.push('dynamic lighting', 'high quality manga aesthetics');

  return {
    text: parts.join(', '),
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    referenceImages: Array.from(new Set(refUris))
  };
}

function formatCharacterDescriptor({ name, pose, expression }) {
  const segments = [];
  appendIfDefined(segments, name);
  appendIfDefined(segments, pose ? `${pose} pose` : null);
  appendIfDefined(segments, expression ? `${expression} expression` : null);
  if (segments.length === 0) {
    return null;
  }
  return segments.join(' ').trim();
}

function collectReferenceUris(portraitsS3 = [], gcsPortraitUris = [], context = {}) {
  const result = [];

  for (const uri of normaliseList(gcsPortraitUris)) {
    if (uri.startsWith('gs://')) {
      result.push(uri);
    }
  }

  for (const s3Key of normaliseList(portraitsS3)) {
    if (typeof s3Key === 'string') {
      result.push(s3Key.startsWith('s3://') ? s3Key : `s3://${process.env.ASSETS_BUCKET}/${s3Key}`);
    }
  }

  if (result.length === 0 && context.charId) {
    // Provide deterministic placeholder to help downstream caching.
    const bucket = process.env.ASSETS_BUCKET;
    if (bucket) {
      const fallbackKey = `characters/${context.charId}/${context.configId || 'default'}/portrait-fallback.png`;
      result.push(`s3://${bucket}/${fallbackKey}`);
    }
  }

  return result;
}

module.exports = {
  DEFAULT_NEGATIVE_PROMPT,
  buildCharacterPrompt,
  buildPanelPrompt
};
