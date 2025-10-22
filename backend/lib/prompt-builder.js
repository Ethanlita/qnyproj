/**
 * Prompt builder utilities shared by Imagen/Gemini workflows.
 *
 * The objective is to convert strongly typed domain objects
 * (characters, panels) into rich natural language prompts that
 * emphasise composition, camera work and style consistency.
 */

// ⭐ 问题 3 修复: 视角映射表
const VIEW_MAPPING = {
  'front': 'front view, facing forward, centered composition',
  'three-quarter': 'three-quarter view, slightly angled, dynamic perspective',
  'side': 'side profile view, 90-degree angle, clear silhouette',
  '45-degree': '45-degree angle view, diagonal composition',
  'back': 'back view, rear angle, looking away',
  'top-down': 'top-down view, birds eye perspective',
  'low-angle': 'low-angle view, looking up, dramatic perspective'
};

// ⭐ 问题 3 修复: 姿态映射表
const POSE_MAPPING = {
  'standing': 'standing pose, upright posture, natural stance',
  'sitting': 'sitting pose, relaxed position',
  'walking': 'walking pose, mid-stride, dynamic movement',
  'running': 'running pose, fast movement, action lines',
  'action': 'dynamic action pose, intense movement',
  'fighting': 'fighting pose, combat stance, aggressive posture',
  'defensive': 'defensive pose, guarding position',
  'casual': 'casual pose, relaxed body language',
  'formal': 'formal pose, dignified posture',
  'dramatic': 'dramatic pose with motion blur, cinematic composition'
};

// ⭐ 问题 3 修复: 风格映射表
const STYLE_MAPPING = {
  'anime': 'anime style, cel-shaded, vibrant colors, expressive features',
  'realistic': 'photorealistic style, detailed rendering, natural lighting',
  'chibi': 'chibi style, super deformed, cute proportions, simplified features',
  'comic': 'comic book style, bold outlines, halftone shading, dynamic composition',
  'manga': 'manga style, screentone shading, clean line art, high contrast',
  'oil-painting': 'oil painting style, artistic brushstrokes, textured canvas feel',
  'watercolor': 'watercolor style, soft edges, pastel colors, artistic wash effects',
  'sketch': 'sketch style, rough lines, pencil texture, unfinished aesthetic',
  'noir': 'noir style, high contrast black and white, dramatic shadows',
  'retro': 'retro anime style, 80s-90s aesthetic, classic cel animation look'
};

// ⭐ 问题 3 修复: 表情映射表
const EXPRESSION_MAPPING = {
  'neutral': 'neutral expression, calm face',
  'happy': 'happy expression, bright smile',
  'sad': 'sad expression, downcast eyes',
  'angry': 'angry expression, furrowed brows, intense glare',
  'surprised': 'surprised expression, wide eyes, open mouth',
  'scared': 'scared expression, fearful eyes',
  'determined': 'determined expression, focused gaze, resolute face',
  'confused': 'confused expression, tilted head, questioning look',
  'embarrassed': 'embarrassed expression, blushing, averted eyes',
  'smirking': 'smirking expression, slight grin, confident look'
};

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
 * @param {string} [options.view] - e.g. 'front', 'side', 'three-quarter'
 * @param {string} [options.pose] - e.g. 'standing', 'sitting', 'action'
 * @param {string} [options.style] - e.g. 'anime', 'realistic', 'chibi'
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
  const { 
    view = 'front', 
    pose = 'standing',
    style = 'manga',
    mode = 'preview' 
  } = options;

  const parts = ['ultra detailed manga character portrait'];

  // ⭐ 问题 3 修复: 使用视角映射
  const viewText = VIEW_MAPPING[view] || `${view} view`;
  appendIfDefined(parts, viewText);

  // ⭐ 问题 3 修复: 使用姿态映射
  const poseText = POSE_MAPPING[pose] || `${pose} pose`;
  appendIfDefined(parts, poseText);

  // ⭐ 问题 3 修复: 使用风格映射
  const styleText = STYLE_MAPPING[style] || style;
  appendIfDefined(parts, styleText);

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
  
  // ⭐ 问题 3 修复: 使用姿态映射
  if (pose) {
    const poseText = POSE_MAPPING[pose] || `${pose} pose`;
    segments.push(poseText);
  }
  
  // ⭐ 问题 3 修复: 使用表情映射
  if (expression) {
    const expressionText = EXPRESSION_MAPPING[expression] || `${expression} expression`;
    segments.push(expressionText);
  }
  
  if (segments.length === 0) {
    return null;
  }
  return segments.join(', ').trim();
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
  VIEW_MAPPING,
  POSE_MAPPING,
  STYLE_MAPPING,
  EXPRESSION_MAPPING,
  buildCharacterPrompt,
  buildPanelPrompt
};
