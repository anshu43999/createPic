const state = {
  mode: "text",
  quality: "精细",
  referenceImage: null,
  referenceDraft: null,
  activeImage: null,
  generatedCount: 0,
  assets: [],
  batches: []
};

const storageKeys = {
  apiKey: "tk-image-workbench-key",
  draft: "tk-image-workbench-draft-v2",
  libraryCollapsed: "tk-image-workbench-library-collapsed"
};

const fixedApiBase = "http://49.51.182.250:3000";
const fixedImageModel = "gpt-image-2";
const maxSavedAssets = 30;
const maxSavedReferenceLength = 900000;
const maxSavedQueueItems = 80;
const maxSavedBatches = 20;
const idleHistorySyncIntervalMs = 10000;
const activeHistorySyncIntervalMs = 3000;
let draftReady = false;
let draftSaveTimer = 0;
let historySyncTimer = 0;
let historySyncInFlight = false;
let historySyncPromise = null;
let librarySelectionMode = false;
let queueExpanded = false;
let activePreviewGroup = { batchId: "", index: 0, items: [] };
let editBrushEnabled = true;
let editBrushDrawing = false;
let editHasMarks = false;
let editLastPoint = null;
let editReferencePreviewUrl = "";
const selectedAssetImages = new Set();
const expandedBatchIds = new Set();

const apiPaths = {
  imageGenerations: "/v1/images/generations",
  imageEdits: "/v1/images/edits",
  models: "/v1/models"
};
const remoteHistoryEnabled = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const mainPreview = $("#main-preview");
const mainTitle = $("#main-title");
const mainResolution = $("#main-resolution");
const resultStateLabel = $("#result-state-label");
const resultSizeLabel = $("#result-size-label");
const mainFrame = $("#main-frame");
const emptyPreview = $("#empty-preview");
const statusModel = $("#status-model");
const statusSize = $("#status-size");
const statusApi = $("#status-api");
const statusQueue = $("#status-queue");
const queueCount = $("#queue-count");
const queueList = $("#queue-list");
const removeFailedQueue = $("#remove-failed-queue");
const removeDoneQueue = $("#remove-done-queue");
const clearQueue = $("#clear-queue");
const retryFailedQueue = $("#retry-failed-queue");
const queueToggle = $("#toggle-queue-list");
const widthInput = $("#width");
const heightInput = $("#height");
const uploadGroup = $("#upload-group");
const workflowFeedback = $("#workflow-feedback");
const templateSection = $("#template-section");
const templateSectionTitle = $("#template-section-title");
const playSection = $("#play-section");
const playSectionLabel = $("#play-section-label");
const stageHint = $("#stage-hint");
const referenceLabel = $("#reference-label");
const referenceAction = $("#reference-action");
const referenceHint = $("#reference-hint");
const referenceUpload = $("#reference-upload");
const referencePreview = $("#reference-preview");
const promptInput = $("#prompt");
const promptLabel = $("#prompt-label");
const promptScore = $("#prompt-score");
const blankCanvas = $("#blank-canvas");
const openEditorButton = $("#open-editor");
const editModal = $("#edit-modal");
const editPreviewImage = $("#edit-preview-image");
const editDrawCanvas = $("#edit-draw-canvas");
const editPromptInput = $("#edit-prompt");
const closeEditorButton = $("#close-editor");
const toggleBrushButton = $("#toggle-brush");
const clearBrushButton = $("#clear-brush");
const useAsReferenceButton = $("#use-as-reference");
const generateEditButton = $("#generate-edit");
const previewPrev = $("#preview-prev");
const previewNext = $("#preview-next");
const previewGroupLabel = $("#preview-group-label");
const batchHistoryCount = $("#batch-history-count");
const batchList = $("#batch-list");
const librarySearch = $("#library-search");
const libraryPanel = $(".library-panel");
const libraryBody = $("#library-body");
const toggleLibrary = $("#toggle-library");
const libraryCount = $("#library-count");
const selectAssetsButton = $("#select-assets");
const deleteAssetsButton = $("#delete-assets");
const deleteAllAssetsButton = $("#delete-all-assets");
const finishAssetSelectButton = $("#finish-asset-select");
const apiBaseInput = $("#api-base");
const apiKeyInput = $("#api-key");
const platformSelect = $("#platform");
const claritySelect = $("#clarity");
const finalSize = $("#final-size");
const requestSize = $("#request-size");
const productName = $("#product-name");
const productSellingPoints = $("#product-selling-points");
const platformLabel = $("#platform-label");
const productNameLabel = $("#product-name-label");
const productSellingPointsLabel = $("#product-selling-points-label");
const scenePoseLabel = $("#scene-pose-label");
const copyDirectionLabel = $("#copy-direction-label");
const scenePose = $("#scene-pose");
const copyDirection = $("#copy-direction");
const referenceUrlInput = $("#reference-url");
const batchTotal = $("#batch-total");
const batchCount = $("#batch-count");
const variantStrip = $(".variant-strip");
const clearPromptButton = $("#clear-prompt");
const modelSelect = $("#model");
const styleSelect = $("#style");
const customStyleInput = $("#custom-style");
const generateButtons = [$("#generate"), $("#top-generate")];
const batchConcurrencyLimit = 10;

function normalizeApiBase(value) {
  let raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const embeddedHttpUrl = raw.match(/https?:\/\/[^\s)\]]+/i);
  if (embeddedHttpUrl) {
    raw = embeddedHttpUrl[0];
  } else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    raw = `http://${raw}`;
  }

  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) {
      return "";
    }
    if (!isUsableApiHost(url.hostname)) {
      return "";
    }

    const endpointBase = url.pathname.match(/^(.*?\/v1)\/images\/(?:generations|edits)\/?$/i);
    if (endpointBase) {
      url.pathname = endpointBase[1];
      url.search = "";
    }

    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function isUsableApiHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "file") {
    return false;
  }
  return host === "localhost"
    || host.includes(".")
    || host.includes(":")
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

if (apiBaseInput) {
  apiBaseInput.value = fixedApiBase;
  apiBaseInput.disabled = true;
}
const savedApiKey = sessionStorage.getItem(storageKeys.apiKey) || "";
let apiKeyEdited = false;
apiKeyInput.value = savedApiKey;

const sizePresets = {
  "1k": {
    "1:1": [1024, 1024],
    "3:4": [768, 1024],
    "4:3": [1024, 768],
    "3:2": [1152, 768],
    "2:3": [768, 1152],
    "9:16": [576, 1024],
    "16:9": [1024, 576],
    "4:7": [768, 1344]
  },
  "2k": {
    "1:1": [2048, 2048],
    "3:4": [1536, 2048],
    "4:3": [2048, 1536],
    "3:2": [1536, 1024],
    "2:3": [1024, 1536],
    "9:16": [1152, 2048],
    "16:9": [2048, 1152],
    "4:7": [1024, 1792]
  },
  "4k": {
    "1:1": [4096, 4096],
    "3:4": [3072, 4096],
    "4:3": [4096, 3072],
    "3:2": [3840, 2560],
    "2:3": [2560, 3840],
    "9:16": [2160, 3840],
    "16:9": [3840, 2160],
    "4:7": [2160, 3780]
  }
};

const platformPresets = {
  unrestricted: {
    title: "不限平台",
    summary: "不套具体平台规范，适合自由创作、临时测试和多平台复用。",
    rules: "优先保证画面完成度、主体清晰、构图好看；不要强制添加平台样式、平台水印、二维码或不可读小字。"
  },
  amazon: {
    title: "Amazon 主图",
    summary: "白底商品主图，主体占比高，适合 marketplace 首图。",
    rules: "纯白或接近纯白背景，主体完整居中，保留自然阴影；不添加促销文字、徽章、水印、二维码；不夸张改变商品比例。"
  },
  taobao: {
    title: "淘宝 / 天猫",
    summary: "突出商品质感和购买理由，适合店铺首图与详情承接。",
    rules: "主体清晰，允许轻量氛围与卖点排版；保留品牌与包装文字；画面干净，适合中文电商。"
  },
  jd: {
    title: "京东",
    summary: "偏理性、清晰、可信赖的商品展示。",
    rules: "商品边缘锐利，参数和功能表达清楚；避免夸张装饰，突出品质和可靠性。"
  },
  temu: {
    title: "Temu",
    summary: "高转化列表图，主体醒目，适合跨境平台。",
    rules: "画面对比明确，商品完整，背景简洁；避免复杂文案和不可读小字。"
  },
  shopee: {
    title: "Shopee",
    summary: "适合东南亚电商的清爽商品和场景图。",
    rules: "色彩明快但不过曝，商品主体明确，适合移动端列表浏览。"
  },
  shopify: {
    title: "独立站",
    summary: "品牌感更强，适合官网商品页和落地页。",
    rules: "可使用高级摄影棚、生活方式场景和品牌调性构图；保留商品真实结构。"
  },
  xiaohongshu: {
    title: "小红书",
    summary: "种草图和生活方式视觉，适合笔记封面。",
    rules: "自然光、真实使用环境、轻生活方式表达；避免硬广感和复杂大字。"
  },
  douyin: {
    title: "抖音",
    summary: "适合短视频封面、竖版种草图和强第一眼视觉。",
    rules: "移动端优先，主体强、对比清楚、竖版友好；可有短标题空间，但避免密集小字、平台水印和二维码。"
  },
  weibo: {
    title: "微博",
    summary: "适合热点图、分享图和话题传播视觉。",
    rules: "画面信息一眼可读，适合横图或方图传播；视觉记忆点明确，避免过度营销感、水印和不可读小字。"
  },
  kuaishou: {
    title: "快手",
    summary: "适合真实生活感、短视频封面和直播间视觉。",
    rules: "主体真实自然，色彩明快，移动端可读；避免过度精修导致假感，不添加平台水印或二维码。"
  },
  wechat: {
    title: "微信 / 朋友圈",
    summary: "适合朋友圈分享、头像、封面和私域内容。",
    rules: "画面自然克制，适合熟人社交场景；避免强广告感、复杂排版、水印、二维码和夸张大字。"
  },
  bilibili: {
    title: "B站",
    summary: "适合视频封面、头像、二创和内容栏目图。",
    rules: "画面有标题安全区和内容辨识度，适合横图或方图；风格可以更年轻，但避免乱码文字、水印和无关元素。"
  },
  instagram: {
    title: "Instagram",
    summary: "社媒视觉，强调构图、光影和品牌氛围。",
    rules: "高级摄影感，视觉焦点明确，适合方图或竖图动态。"
  },
  tiktok: {
    title: "TikTok",
    summary: "短视频封面和竖版电商视觉。",
    rules: "强主体、竖版优先、背景有场景但不抢商品；适合移动端第一眼识别。"
  }
};

const modePresets = {
  text: {
    label: "文生图",
    summary: "纯提示词创作，不需要参考图。"
  },
  image: {
    label: "图生图",
    summary: "先上传参考图，再做换背景、重绘、扩图和一致性编辑。"
  }
};

const templatePresets = {
  main: {
    tool: "AI 主图",
    style: "干净白底",
    scene: "浅灰摄影棚背景，商品居中，边缘清晰，保留自然投影",
    copy: "无文字，不生成水印、二维码或无关字样",
    prompt: "生成一张电商商品主图，突出商品本体与核心卖点。"
  },
  detail: {
    tool: "详情页长图",
    style: "高级质感",
    scene: "纵向详情页视觉，包含头图、卖点模块、使用场景和参数对比",
    copy: "中文卖点短句，文案区域清晰，避免小字乱码",
    prompt: "生成一张电商详情页长图，按卖点、场景、参数生成连续视觉模块。"
  },
  model: {
    tool: "模特图",
    style: "生活场景",
    scene: "真实模特自然穿戴展示，姿态舒展，商品细节清楚",
    copy: "无文字，突出穿戴效果和材质",
    prompt: "生成一张模特穿戴展示图，保持商品结构和材质准确。"
  },
  background: {
    tool: "换背景",
    style: "生活场景",
    scene: "把商品放入真实使用环境，背景自然，有空间层次",
    copy: "无文字，保留商品主体比例和边缘",
    prompt: "为现有商品图更换适合投放的场景背景，保留商品主体不变。"
  }
};

const boardPresets = {
  commerce: {
    label: "电商",
    summary: "主图、详情、场景图优先，适合上架和投放。",
    template: "main",
    prompt: "生成一张电商商品主图，突出商品本体与核心卖点。"
  },
  personal: {
    label: "玩图",
    summary: "头像、写真、贴纸、壁纸等个人玩法优先。",
    template: "main",
    style: "电影写实",
    prompt: "生成一张适合个人社交头像或朋友圈分享的创意图片，人物自然、有情绪、有故事感。"
  },
  trending: {
    label: "纯提示词",
    summary: "只保留自由提示词输入，用户自己决定画面内容。",
    template: "background",
    style: "极简自然光",
    prompt: ""
  }
};

const boardUiPresets = {
  commerce: {
    templateVisible: true,
    playVisible: false,
    templateTitle: "电商模板",
    playLabel: "玩法灵感",
    platformLabel: "销售平台",
    productLabel: "商品名称",
    sellingLabel: "卖点",
    sceneLabel: "场景/姿态",
    copyLabel: "文案方向",
    productPlaceholder: "例如：折叠露营灯",
    sellingPlaceholder: "防水、长续航、轻量",
    scenePlaceholder: "浅灰摄影棚，商品居中",
    copyPlaceholder: "无文字、中文卖点、英文短句"
  },
  personal: {
    templateVisible: false,
    playVisible: true,
    templateTitle: "快捷模板",
    playLabel: "玩图灵感",
    platformLabel: "发布平台",
    productLabel: "主体/人物",
    sellingLabel: "想玩的效果",
    sceneLabel: "画面感觉",
    copyLabel: "用途/文案",
    productPlaceholder: "例如：我、情侣、宠物、头像主体",
    sellingPlaceholder: "写真、贴纸、壁纸、朋友圈封面",
    scenePlaceholder: "自然光、真实生活感、电影氛围",
    copyPlaceholder: "无文字、短标题、头像用途"
  },
  trending: {
    templateVisible: false,
    playVisible: false,
    freePrompt: true,
    templateTitle: "快捷模板",
    playLabel: "玩法灵感",
    platformLabel: "发布平台",
    productLabel: "主体/参考对象",
    sellingLabel: "玩法方向",
    sceneLabel: "流行场景",
    copyLabel: "发布用途",
    productPlaceholder: "例如：人物、宠物、产品、旅行照",
    sellingPlaceholder: "真实随拍、微缩世界、漫画分镜",
    scenePlaceholder: "近期流行玩法，真实自然，可分享",
    copyPlaceholder: "无文字、短标题、社媒封面"
  }
};

const workflowDefaults = {
  commerce: {
    text: { template: "main", platform: "amazon" },
    image: { template: "background", platform: "amazon" }
  },
  personal: {
    text: { play: "avatar", tool: "", platform: "unrestricted" },
    image: { play: "avatar", tool: "", platform: "unrestricted" }
  },
  trending: {
    text: { tool: "", platform: "unrestricted" },
    image: { tool: "", platform: "unrestricted" }
  }
};

const playPresets = {
  avatar: {
    style: "电影写实",
    scene: "自然光人像摄影，干净背景，脸部清晰，情绪松弛，高级头像质感",
    copy: "无文字",
    prompt: "生成一张高级头像写真，保留人物特征，光线自然，适合社交头像。"
  },
  film: {
    style: "生活场景",
    scene: "复古胶片随拍，轻微颗粒，真实街头或居家环境，像手机随手拍",
    copy: "无文字",
    prompt: "生成一张复古胶片随拍风格图片，真实自然，不像棚拍。"
  },
  miniature: {
    style: "高级质感",
    scene: "微缩世界和玩具盒场景，主体像精致模型，浅景深，细节丰富",
    copy: "无文字",
    prompt: "生成一个微缩世界场景，把主体做成精致模型或玩具盒陈列。"
  },
  comic: {
    style: "促销海报",
    scene: "漫画分镜构图，3 到 4 个画面格，动作连续，故事清楚",
    copy: "短句标题，可留空白字框",
    prompt: "生成一张漫画分镜图，用连续画面讲一个轻松有趣的小故事。"
  },
  sticker: {
    style: "极简自然光",
    scene: "透明或干净背景，表情夸张可爱，边缘适合裁切成贴纸",
    copy: "无文字或极短表情字",
    prompt: "生成一组适合聊天使用的表情贴纸，表情明确，边缘干净。"
  },
  wallpaper: {
    style: "Apple 产品摄影",
    scene: "竖版手机壁纸构图，留出图标区域，光影柔和，视觉安静",
    copy: "无文字",
    prompt: "生成一张高级手机壁纸，画面干净，有空间感和光影层次。"
  }
};

const scenePresets = {
  white: "标准白底货架图，主体占画面约 75%，边缘清晰，保留自然投影",
  lifestyle: "真实生活使用环境，自然光，背景有层次但不抢商品",
  promo: "促销海报构图，预留文案安全区，背景干净，有活动氛围"
};

function showToast(message, tone = "default") {
  const existing = $(".toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 2400);
}

function getApiKey() {
  return apiKeyInput.value.trim();
}

function rememberApiKey() {
  const value = getApiKey();
  if (value) {
    sessionStorage.setItem(storageKeys.apiKey, value);
  } else {
    sessionStorage.removeItem(storageKeys.apiKey);
  }
}

function getApiBase() {
  const base = normalizeApiBase(fixedApiBase);
  if (base) {
    return base;
  }

  throw new Error("请求地址必须是 http 或 https 地址");
}

function apiUrl(path) {
  const base = getApiBase();
  if (base.endsWith("/v1") && path.startsWith("/v1/")) {
    return `${base}${path.slice(3)}`;
  }
  return `${base}${path}`;
}

function authHeaders() {
  const key = getApiKey();
  if (!key) {
    throw new Error("请先填写 API Key");
  }
  return {
    Authorization: key.toLowerCase().startsWith("bearer ") ? key : `Bearer ${key}`
  };
}

function updateStatus() {
  const providerSize = resolveProviderSize();
  const activeAsset = getActiveAsset();
  const targetResolution = getTargetResolutionLabel();
  const previewResolution = activeAsset?.resolution || targetResolution;
  statusModel.textContent = fixedImageModel;
  statusSize.textContent = targetResolution;
  mainResolution.textContent = previewResolution;
  resultSizeLabel.textContent = previewResolution;
  finalSize.textContent = providerSize
    ? `目标尺寸：${claritySelect.value.toUpperCase()} · ${getActiveRatio()} · ${targetResolution}`
    : "目标尺寸：接口默认";
  requestSize.textContent = providerSize ? `请求尺寸：${formatProviderSize(providerSize)}` : "请求尺寸：不指定";
  statusQueue.textContent = `${queueList.children.length} 个任务`;
  queueCount.textContent = queueList.children.length;
  libraryCount.textContent = state.assets.length;
  batchCount.textContent = getBatchTotal();
  queueList.classList.toggle("empty", queueList.children.length === 0);
  queueList.classList.toggle("is-limited", !queueExpanded && queueList.children.length > 5);
  if (queueToggle) {
    queueToggle.hidden = queueList.children.length <= 5;
    queueToggle.textContent = queueExpanded ? "收起队列" : `展开全部 ${queueList.children.length}`;
  }
  updateQueueRetryControls();
  $("#asset-list").classList.toggle("empty", $("#asset-list").children.length === 0);
  updateLibrarySelectionUi();
  if (variantStrip) {
    variantStrip.classList.toggle("empty", variantStrip.children.length === 0);
  }
  updatePreviewAspectRatio(previewResolution);
  updateEditorAvailability();
  scheduleWorkspaceDraftSave();
}

function syncPressedState(buttons) {
  buttons.forEach((button) => {
    button.setAttribute("aria-pressed", button.classList.contains("active") ? "true" : "false");
  });
}

function setActive(buttons, activeButton = null) {
  buttons.forEach((button) => {
    button.classList.toggle("active", button === activeButton);
  });
  syncPressedState(buttons);
}

function toggleOptionalActive(buttons, button) {
  if (button.classList.contains("active")) {
    button.classList.remove("active");
    syncPressedState(buttons);
    return false;
  }

  setActive(buttons, button);
  return true;
}

function getActiveBoard() {
  return $("[data-board].active")?.dataset.board || "commerce";
}

function isFreePromptBoard() {
  return getActiveBoard() === "trending";
}

function getWorkflowLabels() {
  const mode = modePresets[state.mode] || modePresets.text;
  const board = boardPresets[getActiveBoard()] || boardPresets.commerce;
  return { mode, board };
}

function renderWorkflowFeedback(message = "") {
  const { mode, board } = getWorkflowLabels();
  workflowFeedback.querySelector("strong").textContent = `${mode.label} · ${board.label}`;
  workflowFeedback.querySelector("span").textContent = message || `${mode.summary} ${board.summary}`;
}

function announceWorkflow(message) {
  renderWorkflowFeedback(message);
  workflowFeedback.classList.remove("pulse");
  window.requestAnimationFrame(() => {
    workflowFeedback.classList.add("pulse");
  });
  window.setTimeout(() => {
    workflowFeedback.classList.remove("pulse");
  }, 650);
  showToast(message);
}

function updateModeUi() {
  const isImageMode = state.mode === "image";
  uploadGroup.classList.toggle("visible", isImageMode);
  uploadGroup.classList.toggle("required", isImageMode);
  referenceLabel.textContent = "图生图参考图";
  referenceAction.textContent = state.referenceImage ? "已选择参考图，可重新选择" : "上传或导入参考图";
  referenceHint.textContent = state.referenceImage
    ? "生成时会使用当前参考图"
    : "图生图会以这张图作为主体、风格或构图依据";
  stageHint.textContent = isImageMode ? "上传参考图后生成真实编辑结果" : "输入提示词后生成真实图片";
  renderWorkflowFeedback();
}

function hasActiveReference() {
  return state.mode === "image" && Boolean(state.referenceImage);
}

function updateReferencePreview(src = "") {
  const hasImage = Boolean(src);
  referencePreview.hidden = !hasImage;
  if (hasImage) {
    referencePreview.src = src;
  } else {
    referencePreview.removeAttribute("src");
  }
  uploadGroup.classList.toggle("has-reference", hasImage);
  referenceAction.textContent = hasImage ? "已选择参考图，可重新选择" : "上传或导入参考图";
  referenceHint.textContent = hasImage
    ? "生成时会使用当前参考图"
    : "图生图会以这张图作为主体、风格或构图依据";
}

function getActiveImageForEdit() {
  const previewSource = mainPreview.currentSrc || mainPreview.getAttribute("src") || mainPreview.src || "";
  if (mainPreview.hidden || !previewSource) {
    return "";
  }
  return sanitizeImageSource(state.activeImage) || sanitizeImageSource(previewSource);
}

function updateEditorAvailability() {
  if (!openEditorButton) {
    return;
  }
  const hasEditableImage = Boolean(getActiveImageForEdit());
  openEditorButton.disabled = !hasEditableImage;
  openEditorButton.setAttribute("aria-disabled", hasEditableImage ? "false" : "true");
}

function revokeEditReferencePreviewUrl() {
  if (editReferencePreviewUrl) {
    URL.revokeObjectURL(editReferencePreviewUrl);
    editReferencePreviewUrl = "";
  }
}

function resizeEditCanvas() {
  if (!editDrawCanvas || !editPreviewImage || !editPreviewImage.src) {
    return;
  }

  const imageRect = editPreviewImage.getBoundingClientRect();
  const wrapRect = editPreviewImage.parentElement.getBoundingClientRect();
  if (!imageRect.width || !imageRect.height) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(imageRect.width * ratio));
  const height = Math.max(1, Math.round(imageRect.height * ratio));
  if (editDrawCanvas.width !== width || editDrawCanvas.height !== height) {
    const previous = document.createElement("canvas");
    previous.width = editDrawCanvas.width || width;
    previous.height = editDrawCanvas.height || height;
    previous.getContext("2d").drawImage(editDrawCanvas, 0, 0);
    editDrawCanvas.width = width;
    editDrawCanvas.height = height;
    if (editHasMarks) {
      editDrawCanvas.getContext("2d").drawImage(previous, 0, 0, width, height);
    }
  }

  editDrawCanvas.style.left = `${imageRect.left - wrapRect.left}px`;
  editDrawCanvas.style.top = `${imageRect.top - wrapRect.top}px`;
  editDrawCanvas.style.width = `${imageRect.width}px`;
  editDrawCanvas.style.height = `${imageRect.height}px`;
}

function clearEditMarks() {
  if (!editDrawCanvas) {
    return;
  }
  const ctx = editDrawCanvas.getContext("2d");
  ctx.clearRect(0, 0, editDrawCanvas.width, editDrawCanvas.height);
  editHasMarks = false;
  editLastPoint = null;
}

function setEditBrushEnabled(enabled) {
  editBrushEnabled = Boolean(enabled);
  if (toggleBrushButton) {
    toggleBrushButton.classList.toggle("active", editBrushEnabled);
    toggleBrushButton.setAttribute("aria-pressed", editBrushEnabled ? "true" : "false");
  }
  if (editDrawCanvas) {
    editDrawCanvas.classList.toggle("is-disabled", !editBrushEnabled);
  }
}

function editCanvasPoint(event) {
  const rect = editDrawCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  return {
    x: (event.clientX - rect.left) * ratio,
    y: (event.clientY - rect.top) * ratio
  };
}

function drawEditStroke(from, to) {
  const ctx = editDrawCanvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 5 * ratio;
  ctx.strokeStyle = "rgba(255, 42, 64, 0.92)";
  ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
  ctx.shadowBlur = 2 * ratio;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
  editHasMarks = true;
}

function beginEditDraw(event) {
  if (!editBrushEnabled || !editDrawCanvas) {
    return;
  }
  event.preventDefault();
  resizeEditCanvas();
  editBrushDrawing = true;
  editLastPoint = editCanvasPoint(event);
  editDrawCanvas.setPointerCapture?.(event.pointerId);
}

function moveEditDraw(event) {
  if (!editBrushDrawing || !editLastPoint) {
    return;
  }
  event.preventDefault();
  const next = editCanvasPoint(event);
  drawEditStroke(editLastPoint, next);
  editLastPoint = next;
}

function endEditDraw(event) {
  if (!editBrushDrawing) {
    return;
  }
  editBrushDrawing = false;
  editLastPoint = null;
  editDrawCanvas.releasePointerCapture?.(event.pointerId);
}

function openImageEditor() {
  const image = getActiveImageForEdit();
  if (!image) {
    showToast("请先选择一张图片", "error");
    return;
  }
  editPreviewImage.src = image;
  clearEditMarks();
  setEditBrushEnabled(true);
  editPromptInput.value = promptInput.value.trim()
    || "基于当前图片继续修改，保留主体结构和主要风格，只调整需要变化的部分。";
  editModal.hidden = false;
  document.body.classList.add("modal-open");
  window.setTimeout(() => {
    resizeEditCanvas();
    editPromptInput.focus();
  }, 0);
}

function closeImageEditor() {
  if (!editModal) {
    return;
  }
  editModal.hidden = true;
  document.body.classList.remove("modal-open");
  editBrushDrawing = false;
  editLastPoint = null;
}

async function imageBlobFromUrl(imageUrl, { timeoutMs = 20000 } = {}) {
  const safeImage = sanitizeImageSource(imageUrl);
  if (!safeImage) {
    throw new Error("当前图片地址不安全，无法作为参考图");
  }

  if (safeImage.startsWith("data:image/")) {
    const file = dataUrlToFile(safeImage, "reference.png");
    return { blob: file, safeImage };
  }

  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  let response;
  try {
    response = await fetch(safeImage, controller ? { signal: controller.signal } : undefined);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("参考图读取超时，请稍后重试");
    }
    throw error;
  } finally {
    if (timer) {
      window.clearTimeout(timer);
    }
  }
  if (!response.ok) {
    throw new Error(`参考图读取失败：${response.status}`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("当前图片无法作为参考图");
  }
  return { blob, safeImage };
}

function blobFromCanvas(canvas, type = "image/png", quality = 0.95) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("标注图片导出失败"));
      }
    }, type, quality);
  });
}

function imageElementFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("参考图读取失败"));
    };
    image.src = url;
  });
}

async function drawableImageFromBlob(blob) {
  if (window.createImageBitmap) {
    const bitmap = await createImageBitmap(blob);
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close?.()
    };
  }

  const image = await imageElementFromBlob(blob);
  return {
    image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    dispose: () => {}
  };
}

async function buildMarkedReferenceBlob(imageUrl) {
  const { blob, safeImage } = await imageBlobFromUrl(imageUrl);
  if (!editHasMarks || !editDrawCanvas) {
    return { blob, safeImage, marked: false };
  }

  const drawable = await drawableImageFromBlob(blob);
  const canvas = document.createElement("canvas");
  canvas.width = drawable.width;
  canvas.height = drawable.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(drawable.image, 0, 0);
  ctx.drawImage(editDrawCanvas, 0, 0, canvas.width, canvas.height);
  drawable.dispose();
  const markedBlob = await blobFromCanvas(canvas);
  return { blob: markedBlob, safeImage, marked: true };
}

async function useCurrentImageAsReference({ announce = true, includeMarks = false } = {}) {
  const image = getActiveImageForEdit();
  if (!image) {
    showToast("请先选择一张图片", "error");
    return false;
  }

  try {
    const { blob, safeImage, marked } = includeMarks
      ? await buildMarkedReferenceBlob(image)
      : await imageBlobFromUrl(image);
    const extension = blob.type.split("/")[1] || "png";
    const name = `reference.${extension}`;
    state.referenceImage = {
      file: new File([blob], name, { type: blob.type }),
      name
    };

    revokeEditReferencePreviewUrl();
    const preview = marked ? URL.createObjectURL(blob) : safeImage;
    if (marked) {
      editReferencePreviewUrl = preview;
    }
    state.referenceDraft = {
      kind: marked || preview.startsWith("blob:") ? "object" : preview.startsWith("data:image/") ? "data" : "url",
      url: marked ? "" : safeImage,
      preview,
      name,
      type: blob.type
    };
    referenceUrlInput.value = marked ? "" : safeImage;
    updateReferencePreview(preview);
    state.mode = "image";
    activateByDataset("[data-mode]", "mode", "image");
    updateModeUi();
    updateStatus();
    scheduleWorkspaceDraftSave();
    if (announce) {
      showToast(marked ? "已把标注图设为参考图" : "已把当前图设为参考图");
    }
    return true;
  } catch (error) {
    showToast(error.message || "参考图设置失败", "error");
    return false;
  }
}

async function generateEditFromCurrentImage() {
  if (isGenerationBusy()) {
    showToast("当前正在生成，请稍后再编辑", "error");
    return;
  }

  const nextPrompt = editPromptInput.value.trim();
  if (!nextPrompt) {
    showToast("请先输入修改提示词", "error");
    editPromptInput.focus();
    return;
  }

  const ready = await useCurrentImageAsReference({ announce: false, includeMarks: true });
  if (!ready) {
    return;
  }

  promptInput.value = editHasMarks
    ? `${nextPrompt}\n\n红色画笔标记的是需要重点修改的位置。最终成图不要保留红色标记、圈线或涂鸦。`
    : nextPrompt;
  closeImageEditor();
  showToast("已进入图生图，开始生成修改版");
  generateImage();
}

function updateBoardUi(name = getActiveBoard()) {
  const preset = boardUiPresets[name] || boardUiPresets.commerce;
  const isFreePrompt = Boolean(preset.freePrompt);
  document.body.classList.toggle("free-prompt-board", isFreePrompt);
  templateSection.classList.toggle("is-hidden", !preset.templateVisible);
  playSection.classList.toggle("is-hidden", !preset.playVisible);
  if (promptLabel) {
    promptLabel.textContent = isFreePrompt ? "自由提示词" : "提示词";
  }
  promptInput.placeholder = isFreePrompt
    ? "直接输入完整生图需求。这里不会自动套模板、平台规则或推荐玩法。"
    : "输入或生成提示词";
  templateSectionTitle.textContent = preset.templateTitle;
  playSectionLabel.textContent = preset.playLabel;
  platformLabel.textContent = preset.platformLabel;
  productNameLabel.textContent = preset.productLabel;
  productSellingPointsLabel.textContent = preset.sellingLabel;
  scenePoseLabel.textContent = preset.sceneLabel;
  copyDirectionLabel.textContent = preset.copyLabel;
  productName.placeholder = preset.productPlaceholder;
  productSellingPoints.placeholder = preset.sellingPlaceholder;
  scenePose.placeholder = preset.scenePlaceholder;
  copyDirection.placeholder = preset.copyPlaceholder;
}

function setToolActive(toolName = "") {
  const buttons = $$("[data-tool]");
  const target = toolName ? buttons.find((button) => button.dataset.tool === toolName) : null;
  setActive(buttons, target || null);
}

function getFieldLabel(labelElement, fallback) {
  return (labelElement?.textContent || fallback).replace(/[：:]/g, "").trim();
}

function getAccuracyRule() {
  const board = getActiveBoard();
  if (board === "commerce") {
    return hasActiveReference()
      ? "要求：保持参考图商品主体准确，不改变品牌标识和关键结构，画面清晰，适合电商上架，不要生成水印、二维码或无关文字。"
      : "要求：商品设定清晰可信，主体完整，画面清晰，适合电商上架；未提供参考图时不要生成真实品牌 Logo、包装小字、水印或二维码。";
  }

  if (board === "personal") {
    return hasActiveReference()
      ? "要求：保持参考图人物或主体特征一致，画面自然有情绪，适合头像、分享或个人创作，不要水印和无关文字。"
      : "要求：主体自然、有情绪、有故事感，画面清晰高级，适合头像、分享或个人创作，不要水印和无关文字。";
  }

  return hasActiveReference()
    ? "要求：保留参考图主体特征，生成近期流行且可分享的视觉效果，真实自然，不要水印、二维码或乱码。"
    : "要求：主体设定清晰可信，生成近期流行且可分享的视觉效果，真实自然，不要水印、二维码或乱码。";
}

function setBusy(isBusy) {
  generateButtons.forEach((button) => {
    button.disabled = isBusy;
    button.classList.toggle("loading", isBusy);
  });
  updateQueueRetryControls();
}

function setLibraryCollapsed(collapsed, persist = true) {
  libraryPanel.classList.toggle("is-collapsed", collapsed);
  libraryBody.hidden = collapsed;
  toggleLibrary.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggleLibrary.textContent = collapsed ? "展开" : "收起";
  toggleLibrary.title = collapsed ? "展开作品库" : "收起作品库";

  if (persist) {
    localStorage.setItem(storageKeys.libraryCollapsed, collapsed ? "true" : "false");
  }
}

function restoreLibraryCollapsed() {
  setLibraryCollapsed(false, false);
}

function setLibrarySelectionMode(enabled) {
  librarySelectionMode = Boolean(enabled);
  libraryPanel.classList.toggle("is-selecting", librarySelectionMode);
  selectAssetsButton.hidden = librarySelectionMode;
  deleteAssetsButton.hidden = !librarySelectionMode;
  deleteAllAssetsButton.hidden = librarySelectionMode;
  finishAssetSelectButton.hidden = !librarySelectionMode;
  if (!librarySelectionMode) {
    selectedAssetImages.clear();
  }
  $$(".asset-item").forEach((item) => {
    const selected = isAssetSelected(item.dataset.image);
    item.classList.toggle("is-selected", selected);
    item.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  updateLibrarySelectionUi();
}

function toggleAssetSelection(image) {
  const safeImage = sanitizeImageSource(image);
  if (!safeImage) {
    return;
  }
  if (isAssetSelected(safeImage)) {
    deleteAssetSelection(safeImage);
  } else {
    selectedAssetImages.add(safeImage);
  }
  $$(".asset-item").forEach((item) => {
    if (!sameAssetImage(item.dataset.image, safeImage)) {
      return;
    }
    const selected = isAssetSelected(safeImage);
    item.classList.toggle("is-selected", selected);
    item.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  updateLibrarySelectionUi();
}

function updateLibrarySelectionUi() {
  if (libraryCount) {
    libraryCount.textContent = state.assets.length;
  }
  if (!deleteAssetsButton) {
    return;
  }
  const selectedCount = selectedAssetImages.size;
  deleteAssetsButton.disabled = selectedCount === 0;
  deleteAssetsButton.textContent = selectedCount ? `删除 ${selectedCount}` : "删除";
  if (deleteAllAssetsButton) {
    deleteAllAssetsButton.disabled = state.assets.length === 0;
  }
}

function sanitizeImageSource(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(raw)) {
    return raw;
  }

  if (raw.startsWith("blob:")) {
    return raw;
  }

  try {
    const parsed = new URL(raw, fixedApiBase);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return "";
  }

  return "";
}

function getAssetImageKey(image, depth = 0) {
  const safeImage = sanitizeImageSource(image);
  if (!safeImage) {
    return "";
  }
  if (safeImage.startsWith("data:image/") || safeImage.startsWith("blob:")) {
    return safeImage;
  }

  try {
    const parsed = new URL(safeImage, fixedApiBase);
    if (isGeneratedImagePath(parsed.pathname) || parsed.origin === fixedApiBase || parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return safeImage;
  }
}

function sameAssetImage(left, right) {
  const leftKey = getAssetImageKey(left);
  return Boolean(leftKey && leftKey === getAssetImageKey(right));
}

function getAssetTraceKey(record = {}) {
  const clientRequestId = String(record.clientRequestId || record.client_request_id || "").trim();
  if (clientRequestId) {
    return `request:${clientRequestId}`;
  }

  const clientBatchId = String(record.clientBatchId || record.client_batch_id || "").trim();
  const clientItemId = String(record.clientItemId || record.client_item_id || "").trim();
  if (clientBatchId && clientItemId) {
    return `item:${clientBatchId}:${clientItemId}`;
  }
  if (clientItemId && clientItemId.startsWith("batch-")) {
    return `item:${clientItemId}`;
  }
  return "";
}

function sameAssetTrace(left, right) {
  const leftKey = getAssetTraceKey(left);
  return Boolean(leftKey && leftKey === getAssetTraceKey(right));
}

function sameAssetRecord(left, right) {
  return sameAssetTrace(left, right) || sameAssetImage(left?.image, right?.image);
}

function findAssetByImage(image) {
  const key = getAssetImageKey(image);
  if (!key) {
    return null;
  }
  return state.assets.find((asset) => getAssetImageKey(asset.image) === key) || null;
}

function findAssetIndexByImage(image) {
  const key = getAssetImageKey(image);
  if (!key) {
    return -1;
  }
  return state.assets.findIndex((asset) => getAssetImageKey(asset.image) === key);
}

function findAssetIndexByRecord(record = {}) {
  const traceKey = getAssetTraceKey(record);
  if (traceKey) {
    const traceIndex = state.assets.findIndex((asset) => getAssetTraceKey(asset) === traceKey);
    if (traceIndex >= 0) {
      return traceIndex;
    }
  }
  return findAssetIndexByImage(record.image);
}

function isAssetSelected(image) {
  const key = getAssetImageKey(image);
  return Boolean(key && Array.from(selectedAssetImages).some((selected) => getAssetImageKey(selected) === key));
}

function deleteAssetSelection(image) {
  const key = getAssetImageKey(image);
  if (!key) {
    return;
  }
  Array.from(selectedAssetImages).forEach((selected) => {
    if (getAssetImageKey(selected) === key) {
      selectedAssetImages.delete(selected);
    }
  });
}

function canPersistImageSource(value) {
  const raw = String(value || "");
  if (!raw || raw.startsWith("blob:")) {
    return false;
  }
  return !raw.startsWith("data:image/") || raw.length <= maxSavedReferenceLength;
}

function getActiveAsset() {
  return findAssetByImage(state.activeImage);
}

function formatResolution(width, height) {
  const safeWidth = Math.round(Number(width) || 0);
  const safeHeight = Math.round(Number(height) || 0);
  return safeWidth > 0 && safeHeight > 0 ? `${safeWidth} x ${safeHeight}` : "";
}

function formatProviderSize(value = "") {
  const dimensions = parseResolutionDimensions(value);
  return dimensions ? formatResolution(dimensions.width, dimensions.height) : String(value || "");
}

function getAssetResolution(asset = {}) {
  return asset.resolution || formatResolution(asset.width, asset.height);
}

function setDisplayedResolution(resolution = "") {
  const displayResolution = resolution || getTargetResolutionLabel();
  mainResolution.textContent = displayResolution;
  resultSizeLabel.textContent = displayResolution;
  updatePreviewAspectRatio(displayResolution);
}

function syncImageResolution(image, resolution) {
  const safeImage = sanitizeImageSource(image);
  const dimensions = parseResolutionDimensions(resolution);
  if (!safeImage || !dimensions) {
    return false;
  }

  const normalizedResolution = formatResolution(dimensions.width, dimensions.height);
  let changed = false;
  const asset = findAssetByImage(safeImage);
  if (asset && asset.resolution !== normalizedResolution) {
    asset.resolution = normalizedResolution;
    asset.width = dimensions.width;
    asset.height = dimensions.height;
    changed = true;
  }

  $$(".asset-item, .variant-card").forEach((item) => {
    if (!sameAssetImage(item.dataset.image, safeImage)) {
      return;
    }

    item.dataset.resolution = normalizedResolution;
    const sizeLabel = item.querySelector(".asset-size");
    if (sizeLabel) {
      sizeLabel.textContent = normalizedResolution;
    }
  });

  if (state.activeImage === safeImage) {
    setDisplayedResolution(normalizedResolution);
  }

  return changed;
}

function captureImageResolution(image, element) {
  if (!element?.naturalWidth || !element?.naturalHeight) {
    return;
  }

  const resolution = formatResolution(element.naturalWidth, element.naturalHeight);
  if (syncImageResolution(image, resolution)) {
    scheduleWorkspaceDraftSave();
  }
}

function captureLoadedImageResolution(image, element) {
  if (!element) {
    return;
  }

  if (element.complete && element.naturalWidth && element.naturalHeight) {
    captureImageResolution(image, element);
  }
}

function getPreviewFrameWidth(ratio) {
  const shell = mainFrame.parentElement;
  const shellStyle = shell ? getComputedStyle(shell) : null;
  const paddingX = shellStyle
    ? parseFloat(shellStyle.paddingLeft) + parseFloat(shellStyle.paddingRight)
    : 0;
  const paddingY = shellStyle
    ? parseFloat(shellStyle.paddingTop) + parseFloat(shellStyle.paddingBottom)
    : 0;
  const shellWidth = shell?.clientWidth ? shell.clientWidth - paddingX : 0;
  const shellHeight = shell?.clientHeight ? shell.clientHeight - paddingY : 0;
  const maxWidth = ratio >= 1.28 ? 640 : ratio <= 0.78 ? 360 : 500;
  const availableWidth = Math.max(220, Math.min(maxWidth, shellWidth || maxWidth));
  const fallbackHeight = Math.min(520, Math.max(360, window.innerHeight * 0.64));
  const availableHeight = Math.max(320, Math.min(520, shellHeight || fallbackHeight));
  const widthByHeight = availableHeight * ratio;
  return Math.max(180, Math.round(Math.min(availableWidth, widthByHeight)));
}

function updatePreviewAspectRatio(resolution = "") {
  const dimensions = parseResolutionDimensions(resolution) || {
    width: Number(widthInput.value),
    height: Number(heightInput.value)
  };
  const width = Math.max(1, Number(dimensions.width) || 1);
  const height = Math.max(1, Number(dimensions.height) || 1);
  const ratio = width / height;

  mainFrame.style.setProperty("--preview-aspect-ratio", `${width} / ${height}`);
  mainFrame.style.setProperty("--preview-ratio", String(ratio));
  mainFrame.style.setProperty("--preview-frame-width", `${getPreviewFrameWidth(ratio)}px`);
  mainFrame.classList.toggle("is-wide", ratio >= 1.28);
  mainFrame.classList.toggle("is-portrait", ratio <= 0.78);
}

function parseResolutionDimensions(value = "") {
  const match = String(value).match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!match) {
    return null;
  }
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

function selectImageFromData({ image, title, resolution }, options = {}) {
  const safeImage = sanitizeImageSource(image);
  if (!safeImage) {
    showToast("图片地址不安全或不可识别", "error");
    return;
  }

  if (!options.preserveGroup) {
    clearPreviewGroup();
  }

  const asset = findAssetByImage(safeImage);
  const displayResolution = resolution || getAssetResolution(asset) || getTargetResolutionLabel();
  state.activeImage = safeImage;
  mainPreview.src = safeImage;
  mainPreview.hidden = false;
  emptyPreview.hidden = true;
  mainFrame.classList.add("has-image");
  mainTitle.textContent = title;
  mainResolution.textContent = displayResolution;
  resultStateLabel.textContent = "已完成";
  resultSizeLabel.textContent = displayResolution;
  updatePreviewAspectRatio(displayResolution);
  requestAnimationFrame(() => {
    captureLoadedImageResolution(safeImage, mainPreview);
  });

  $$(".variant-card").forEach((item) => {
    item.classList.toggle("active", sameAssetImage(item.dataset.image, safeImage));
  });
  $$(".asset-item").forEach((item) => {
    item.classList.toggle("active", sameAssetImage(item.dataset.image, safeImage));
  });
  updateEditorAvailability();
  scheduleWorkspaceDraftSave();
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("Content-Type") || "";
  const text = await response.text();
  assertNotHtmlResponse(url, contentType, text);
  const data = text ? safeJson(text) : {};

  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `请求失败：${response.status}`);
  }

  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function assertNotHtmlResponse(url, contentType, text) {
  const sample = String(text || "").trim().slice(0, 120).toLowerCase();
  if (contentType.includes("text/html") || sample.startsWith("<!doctype html") || sample.startsWith("<html")) {
    throw new Error(`接口返回了 HTML 页面，不是 JSON。请检查服务器代理路由或密钥：${url}`);
  }
}

async function checkApi() {
  try {
    getApiBase();
  } catch {
    statusApi.textContent = "地址无效";
    statusApi.classList.remove("ok");
    return false;
  }

  if (!getApiKey()) {
    statusApi.textContent = "未连接";
    statusApi.classList.remove("ok");
    return false;
  }

  statusApi.textContent = "已填写";
  statusApi.classList.add("ok");
  return true;
}

async function ensureApiReadyForGeneration() {
  try {
    getApiBase();
    authHeaders();
    checkApi();
    return true;
  } catch (error) {
    showToast(error.message, "error");
    return false;
  }
}

function isAuthError(error) {
  return /401|api[_\s-]*key|required|authorization|authentication|unauthorized|未授权|密钥/i.test(error?.message || "");
}

function clearUntrustedAutofill() {
  window.setTimeout(() => {
    if (apiKeyEdited || savedApiKey || !apiKeyInput.value.trim()) {
      return;
    }
    apiKeyInput.value = "";
    checkApi();
  }, 700);
}

function shortError(message = "") {
  return String(message || "未知错误").replace(/\s+/g, " ").slice(0, 72);
}

function formatNoteText(note = "") {
  const clean = String(note || "").trim();
  return clean ? `备注：${clean}` : "";
}

function getQueueRetryContext(item) {
  if (!item) {
    return null;
  }

  const requestPrompt = String(item.dataset.requestPrompt || "").trim();
  if (!requestPrompt) {
    return null;
  }

  return {
    mode: item.dataset.mode === "image" ? "image" : "text",
    requestPrompt,
    quality: String(item.dataset.requestQuality || "").trim(),
    title: String(item.dataset.title || "生成任务"),
    batchId: String(item.dataset.batchId || ""),
    batchItemId: String(item.dataset.batchItemId || ""),
    requestId: String(item.dataset.requestId || ""),
    target: {
      width: Number(item.dataset.targetWidth) || 0,
      height: Number(item.dataset.targetHeight) || 0,
      label: String(item.dataset.targetLabel || "").trim()
    }
  };
}

function updateQueueRetryUi(item) {
  if (!item) {
    return;
  }

  const retryButton = item.querySelector(".queue-retry-button");
  if (!retryButton) {
    return;
  }

  const retryContext = getQueueRetryContext(item);
  const canRetry = item.classList.contains("failed") && Boolean(retryContext);
  retryButton.hidden = !canRetry;
  retryButton.disabled = !canRetry || isGenerationBusy();
}

function updateQueueRetryControls() {
  const retryableItems = $$(".queue-item").filter((item) => item.classList.contains("failed") && getQueueRetryContext(item));
  if (retryFailedQueue) {
    retryFailedQueue.disabled = retryableItems.length === 0 || isGenerationBusy();
  }
  $$(".queue-item").forEach(updateQueueRetryUi);
}

function createQueueItem({
  title,
  status = "请求中",
  failed = false,
  done = false,
  progress = 0,
  createdAt = Date.now(),
  jobId = "",
  batchId = "",
  batchItemId = "",
  requestId = "",
  note = "",
  mode = state.mode,
  targetWidth = 0,
  targetHeight = 0,
  targetLabel = "",
  requestPrompt = "",
  requestQuality = ""
}) {
  const item = document.createElement("div");
  item.className = "queue-item";
  item.classList.toggle("failed", Boolean(failed));
  item.classList.toggle("done", Boolean(done));
  item.dataset.jobId = jobId || `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  item.dataset.batchId = String(batchId || "");
  item.dataset.batchItemId = String(batchItemId || "");
  item.dataset.requestId = String(requestId || "");
  item.dataset.title = title || "生成任务";
  item.dataset.status = status || "请求中";
  item.dataset.createdAt = String(createdAt || Date.now());
  item.dataset.note = String(note || "").slice(0, 120);
  item.dataset.mode = mode === "image" ? "image" : "text";
  item.dataset.targetWidth = String(Number(targetWidth) || 0);
  item.dataset.targetHeight = String(Number(targetHeight) || 0);
  item.dataset.targetLabel = String(targetLabel || "").slice(0, 80);
  item.dataset.requestPrompt = String(requestPrompt || "").slice(0, 5000);
  item.dataset.requestQuality = String(requestQuality || "").slice(0, 20);
  item.innerHTML = `
    <div class="queue-item-main">
      <strong>${escapeHtml(item.dataset.title)}</strong>
      <div class="queue-item-actions">
        <span class="queue-status">${escapeHtml(item.dataset.status)}</span>
        <button class="queue-retry-button" type="button" data-queue-action="retry">重试</button>
        <button class="queue-note-button" type="button" data-queue-action="note">备注</button>
      </div>
    </div>
    <small class="queue-note" ${item.dataset.note ? "" : "hidden"}>${escapeHtml(formatNoteText(item.dataset.note))}</small>
    <progress max="100"></progress>
  `;
  item.querySelector("progress").value = Number(progress) || 0;
  updateQueueRetryUi(item);
  return item;
}

function addQueueJob(title, meta = {}) {
  const item = createQueueItem({ title, ...meta });

  queueList.prepend(item);
  updateStatus();
  return item;
}

function updateQueueJobStatus(item, status, progress = null) {
  if (!item) {
    return;
  }

  item.classList.remove("failed", "done");
  const statusEl = item.querySelector(".queue-status");
  if (statusEl) {
    statusEl.textContent = status;
  }
  const progressEl = item.querySelector("progress");
  if (progressEl && progress !== null) {
    progressEl.value = Math.max(Number(progressEl.value) || 0, Number(progress) || 0);
  }
  item.dataset.status = status;
  item.dataset.failed = "false";
  item.dataset.done = "false";
  updateQueueRetryUi(item);
  scheduleWorkspaceDraftSave();
}

function finishQueueJob(item, status, failed = false) {
  if (!item) {
    return;
  }

  item.classList.toggle("failed", failed);
  item.classList.toggle("done", !failed);
  const statusEl = item.querySelector(".queue-status");
  if (statusEl) {
    statusEl.textContent = status;
  }
  item.querySelector("progress").value = 100;
  item.dataset.status = status;
  item.dataset.failed = failed ? "true" : "false";
  item.dataset.done = failed ? "false" : "true";
  updateQueueRetryUi(item);
  scheduleWorkspaceDraftSave();
}

function isGenerationBusy() {
  return generateButtons.some((button) => button.disabled);
}

function removeQueueItems(predicate, label) {
  const items = $$(".queue-item").filter(predicate);
  if (!items.length) {
    showToast(`没有可删除的${label}任务`);
    return;
  }

  items.forEach((item) => item.remove());
  updateStatus();
  scheduleWorkspaceDraftSave();
  showToast(`已删除${label}任务 ${items.length} 个`);
}

function removeFailedQueueItems() {
  removeQueueItems((item) => item.classList.contains("failed"), "失败");
}

function removeDoneQueueItems() {
  removeQueueItems((item) => item.classList.contains("done") && !item.classList.contains("failed"), "完成");
}

function clearQueueItems() {
  if (isGenerationBusy()) {
    showToast("生成中不能清空队列", "error");
    return;
  }

  const count = queueList.children.length;
  if (!count) {
    showToast("队列已经是空的");
    return;
  }

  queueExpanded = false;
  queueList.replaceChildren();
  updateStatus();
  scheduleWorkspaceDraftSave();
  showToast(`已清空队列 ${count} 个`);
}

async function retryFailedQueueItems() {
  const items = $$(".queue-item").filter((item) => item.classList.contains("failed") && getQueueRetryContext(item));
  if (!items.length) {
    showToast("没有可重试的失败任务");
    return;
  }

  if (isGenerationBusy()) {
    showToast("生成中，请等待当前任务完成", "error");
    return;
  }

  const apiReady = await ensureApiReadyForGeneration();
  if (!apiReady) {
    return;
  }

  const needsReference = items.some((item) => getQueueRetryContext(item)?.mode === "image");
  if (needsReference) {
    const hasReference = await ensureReferenceImageReady();
    if (!hasReference) {
      showToast("图生图重试需要先恢复或重新选择参考图", "error");
      return;
    }
  }

  setBusy(true);
  resultStateLabel.textContent = items.length > 1 ? "重试失败任务中" : "重试任务中";
  const summary = { success: 0, failed: 0 };
  for (const item of items) {
    const ok = await retryQueueItem(item, { keepBusy: true, silentSummary: true });
    if (ok) {
      summary.success += 1;
    } else {
      summary.failed += 1;
    }
  }
  setBusy(false);
  resultStateLabel.textContent = summary.failed
    ? summary.success ? "部分重试完成" : "重试失败"
    : "重试完成";
  showToast(
    summary.failed
      ? `重试完成：成功 ${summary.success} 个，失败 ${summary.failed} 个`
      : `已重试成功 ${summary.success} 个`,
    summary.failed ? "error" : undefined
  );
  updateStatus();
}

async function retryQueueItem(item, options = {}) {
  if (!item) {
    return false;
  }

  if (!item.classList.contains("failed")) {
    showToast("只有失败任务可以重试");
    return false;
  }

  if (!options.keepBusy && isGenerationBusy()) {
    showToast("生成中，请等待当前任务完成", "error");
    return false;
  }

  const context = getQueueRetryContext(item);
  if (!context) {
    showToast("这个任务缺少重试参数，请重新生成", "error");
    return false;
  }

  const apiReady = await ensureApiReadyForGeneration();
  if (!apiReady) {
    return false;
  }

  if (context.mode === "image") {
    const hasReference = await ensureReferenceImageReady();
    if (!hasReference) {
      showToast("图生图重试需要先恢复或重新选择参考图", "error");
      return false;
    }
  }

  if (!options.keepBusy) {
    setBusy(true);
  }

  const requestId = `retry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  item.dataset.requestId = requestId;
  updateBatchItem(context.batchId, context.batchItemId, {
    requestId,
    state: "running",
    status: "重试中"
  });
  updateQueueJobStatus(item, "重试中", 35);
  resultStateLabel.textContent = "重试中";

  try {
    const response = context.mode === "image"
      ? await generateImageEdit(context.requestPrompt, context.target, {
        batchId: context.batchId,
        batchItemId: context.batchItemId,
        requestId
      }, { promptReady: true, quality: context.quality })
      : await generateImageFromText(context.requestPrompt, context.target, {
        batchId: context.batchId,
        batchItemId: context.batchItemId,
        requestId
      }, { promptReady: true, quality: context.quality });

    const images = extractImages(response);
    const imageUrl = await resolveFirstLoadableImage(images);
    if (!imageUrl) {
      throw new Error(buildNoImageError(response));
    }

    state.generatedCount += 1;
    const resolution = formatResolution(context.target.width, context.target.height) || "接口默认";
    const asset = addGeneratedAsset({
      image: imageUrl,
      title: context.title,
      resolution,
      meta: `${context.mode === "image" ? "图生图" : "文生图"} / 重试 / ${context.target.label || "接口默认"}`,
      clientBatchId: context.batchId,
      clientItemId: context.batchItemId,
      clientRequestId: requestId,
      targetWidth: context.target.width,
      targetHeight: context.target.height
    });
    selectImageFromData(asset || { image: imageUrl, title: context.title, resolution });
    updateBatchItem(context.batchId, context.batchItemId, {
      state: "done",
      status: "重试完成",
      image: imageUrl,
      title: context.title,
      resolution
    });
    finishQueueJob(item, "重试完成");
    if (!options.silentSummary) {
      showToast("重试完成");
    }
    return true;
  } catch (error) {
    updateBatchItem(context.batchId, context.batchItemId, {
      state: "failed",
      status: shortError(error.message)
    });
    if (isAuthError(error)) {
      statusApi.textContent = "Key无效";
      statusApi.classList.remove("ok");
    }
    finishQueueJob(item, `重试失败：${shortError(error.message)}`, true);
    resultStateLabel.textContent = "重试失败";
    if (!options.silentSummary) {
      showToast(`重试失败：${shortError(error.message)}`, "error");
    }
    console.warn("Image generation retry failed:", error.message);
    return false;
  } finally {
    if (!options.keepBusy) {
      setBusy(false);
    }
    updateStatus();
  }
}

function editQueueItemNote(item) {
  if (!item) {
    return;
  }
  const current = item.dataset.note || "";
  const next = window.prompt("给这个队列任务添加备注", current);
  if (next === null) {
    return;
  }
  const note = String(next || "").trim().slice(0, 120);
  item.dataset.note = note;
  const noteEl = item.querySelector(".queue-note");
  if (noteEl) {
    noteEl.textContent = formatNoteText(note);
    noteEl.hidden = !note;
  }
  scheduleWorkspaceDraftSave();
  showToast(note ? "备注已保存" : "备注已清除");
}

function editBatchNote(batchId) {
  const batch = state.batches.find((record) => record.id === batchId);
  if (!batch) {
    return;
  }
  const next = window.prompt("给这个生成批次添加备注", batch.note || "");
  if (next === null) {
    return;
  }
  batch.note = String(next || "").trim().slice(0, 120);
  renderBatchHistory();
  scheduleWorkspaceDraftSave();
  showToast(batch.note ? "备注已保存" : "备注已清除");
}

function createGenerationBatch(prompt, targets) {
  const batchId = `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const batch = {
    id: batchId,
    createdAt: Date.now(),
    prompt,
    mode: state.mode,
    quality: state.quality,
    note: "",
    status: "等待中",
    total: targets.length,
    success: 0,
    failed: 0,
    running: 0,
    items: targets.map((target, index) => {
      const itemId = `${batchId}-${index}`;
      return {
        id: itemId,
        requestId: `${itemId}-${Math.random().toString(16).slice(2)}`,
        label: `${index + 1}/${targets.length} · ${target.label}`,
        status: "等待",
        state: "queued",
        image: "",
        title: "",
        resolution: "",
        targetWidth: Number(target.width) || 0,
        targetHeight: Number(target.height) || 0,
        targetSize: resolveProviderSize(target.width, target.height)
      };
    })
  };

  state.batches.unshift(batch);
  state.batches = state.batches.slice(0, maxSavedBatches);
  renderBatchHistory();
  scheduleWorkspaceDraftSave();
  return batch;
}

function updateBatchItem(batchId, itemId, updates = {}) {
  const batch = state.batches.find((record) => record.id === batchId);
  if (!batch) {
    return;
  }

  const item = batch.items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  Object.assign(item, updates);
  refreshBatchSummary(batch);
  if (activePreviewGroup.batchId === batchId) {
    activePreviewGroup.items = getBatchPreviewItems(batch);
    activePreviewGroup.index = Math.min(activePreviewGroup.index, Math.max(0, activePreviewGroup.items.length - 1));
    updatePreviewGroupControls();
  } else if (updates.image && !activePreviewGroup.batchId) {
    const items = getBatchPreviewItems(batch);
    const preferredIndex = items.findIndex((entry) => sameAssetImage(entry.image, updates.image));
    activePreviewGroup = {
      batchId,
      index: preferredIndex >= 0 ? preferredIndex : 0,
      items
    };
    updatePreviewGroupControls();
  }
  renderBatchHistory();
  scheduleWorkspaceDraftSave();
}

function refreshBatchSummary(batch) {
  const items = Array.isArray(batch.items) ? batch.items : [];
  batch.total = items.length;
  batch.success = items.filter((item) => item.state === "done").length;
  batch.failed = items.filter((item) => item.state === "failed").length;
  batch.running = items.filter((item) => item.state === "running").length;
  const finished = batch.success + batch.failed;

  if (!items.length) {
    batch.status = "等待中";
  } else if (finished === items.length) {
    batch.status = batch.failed
      ? batch.success ? "部分完成" : "全部失败"
      : "已完成";
  } else if (batch.running) {
    batch.status = "生成中";
  } else {
    batch.status = "等待中";
  }
}

function getBatchPreviewItems(batch = {}) {
  const backendItems = getBackendBatchPreviewItems(batch);
  return backendItems.length ? backendItems : getDirectBatchPreviewItems(batch);
}

function getBackendBatchPreviewItems(batch = {}) {
  const batchId = String(batch.id || "");
  if (!batchId) {
    return [];
  }

  const itemOrder = new Map((batch.items || []).map((item, index) => [String(item.id || ""), index]));
  const seenImages = new Set();
  return state.assets
    .filter((asset) => String(asset.clientBatchId || "") === batchId)
    .sort((a, b) => {
      const orderA = itemOrder.has(String(a.clientItemId || "")) ? itemOrder.get(String(a.clientItemId || "")) : Number.MAX_SAFE_INTEGER;
      const orderB = itemOrder.has(String(b.clientItemId || "")) ? itemOrder.get(String(b.clientItemId || "")) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return (Number(a.createdAtMs) || 0) - (Number(b.createdAtMs) || 0);
    })
    .map((asset, index) => ({
      image: sanitizeImageSource(asset.image),
      title: asset.title || `后台图片 ${index + 1}`,
      resolution: asset.resolution || "",
      source: "backend",
      index
    }))
    .filter((item) => {
      const key = getAssetImageKey(item.image);
      if (!key || seenImages.has(key)) {
        return false;
      }
      seenImages.add(key);
      return true;
    });
}

function getDirectBatchPreviewItems(batch = {}) {
  const seenImages = new Set();
  return (Array.isArray(batch.items) ? batch.items : [])
    .map((item, index) => ({
      image: sanitizeImageSource(item.image),
      title: item.title || item.label || `生成图 ${index + 1}`,
      resolution: item.resolution || "",
      source: "batch",
      index
    }))
    .filter((item) => {
      const key = getAssetImageKey(item.image);
      if (!key || seenImages.has(key)) {
        return false;
      }
      seenImages.add(key);
      return true;
    });
}

function applyPreviewGroupFromBatch(batchId, preferredImage = "") {
  const batch = state.batches.find((record) => record.id === batchId);
  if (!batch) {
    return false;
  }

  const items = getBatchPreviewItems(batch);
  if (!items.length) {
    showToast("这个批次还没有可预览的图片", "error");
    return false;
  }

  const preferred = sanitizeImageSource(preferredImage);
  const preferredIndex = items.findIndex((item) => sameAssetImage(item.image, preferred));
  activePreviewGroup = {
    batchId,
    index: preferredIndex >= 0 ? preferredIndex : 0,
    items
  };
  showPreviewGroupItem(0);
  renderBatchHistory();
  showToast(items.length > 1 ? `已选择批次图片组 ${items.length} 张` : "已选择批次图片");
  return true;
}

async function setPreviewGroupFromBatch(batchId, preferredImage = "") {
  if (getApiKey()) {
    await syncRemoteHistory({ updateActive: false });
  }
  return applyPreviewGroupFromBatch(batchId, preferredImage);
}

function showPreviewGroupItem(delta) {
  refreshActivePreviewGroupItems();
  const items = activePreviewGroup.items || [];
  if (!items.length) {
    updatePreviewGroupControls();
    return;
  }

  activePreviewGroup.index = (activePreviewGroup.index + delta + items.length) % items.length;
  const item = items[activePreviewGroup.index];
  selectImageFromData(item, { preserveGroup: true });
  updatePreviewGroupControls();
}

function refreshActivePreviewGroupItems() {
  if (!activePreviewGroup.batchId) {
    return;
  }

  const batch = state.batches.find((record) => record.id === activePreviewGroup.batchId);
  if (!batch) {
    clearPreviewGroup();
    return;
  }

  const currentImage = activePreviewGroup.items?.[activePreviewGroup.index]?.image || state.activeImage || "";
  const items = getBatchPreviewItems(batch);
  activePreviewGroup.items = items;
  const matchedIndex = items.findIndex((item) => sameAssetImage(item.image, currentImage));
  activePreviewGroup.index = matchedIndex >= 0
    ? matchedIndex
    : Math.min(activePreviewGroup.index || 0, Math.max(0, items.length - 1));
}

function clearPreviewGroup() {
  const hadGroup = Boolean(activePreviewGroup.batchId);
  activePreviewGroup = { batchId: "", index: 0, items: [] };
  updatePreviewGroupControls();
  if (hadGroup) {
    renderBatchHistory();
  }
}

function updatePreviewGroupControls() {
  const items = activePreviewGroup.items || [];
  const hasGroup = items.length > 0;
  const canSlide = items.length > 1;
  if (previewPrev) {
    previewPrev.hidden = !hasGroup;
    previewPrev.disabled = !canSlide;
    previewPrev.setAttribute("aria-disabled", canSlide ? "false" : "true");
  }
  if (previewNext) {
    previewNext.hidden = !hasGroup;
    previewNext.disabled = !canSlide;
    previewNext.setAttribute("aria-disabled", canSlide ? "false" : "true");
  }
  if (previewGroupLabel) {
    previewGroupLabel.hidden = !hasGroup;
    previewGroupLabel.textContent = hasGroup ? `${activePreviewGroup.index + 1}/${items.length}` : "";
  }
}

function renderBatchHistory() {
  if (!batchList || !batchHistoryCount) {
    return;
  }

  batchHistoryCount.textContent = state.batches.length;
  batchList.classList.toggle("empty", state.batches.length === 0);
  if (!state.batches.length) {
    batchList.replaceChildren();
    return;
  }

  batchList.innerHTML = state.batches.map((batch) => {
    refreshBatchSummary(batch);
    const batchId = String(batch.id || "");
    const isExpanded = expandedBatchIds.has(batchId);
    const imageCount = getBatchPreviewItems(batch).length;
    const created = new Date(batch.createdAt || Date.now()).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const itemHtml = (batch.items || []).map((item) => `
      <div class="batch-item ${item.state === "done" ? "is-done" : item.state === "failed" ? "is-failed" : ""}">
        <strong>${escapeHtml(item.label || "任务")}</strong>
        <span>${escapeHtml(item.status || "等待")}</span>
      </div>
    `).join("");
    const cardClass = batch.status === "全部失败"
      ? "is-failed"
      : batch.status === "已完成" || batch.status === "部分完成" ? "is-done" : "";
    const note = String(batch.note || "").trim();
    const noteHtml = note ? `<small class="batch-note">${escapeHtml(formatNoteText(note))}</small>` : "";

    return `
      <article class="batch-card ${cardClass} ${isExpanded ? "is-expanded" : ""} ${activePreviewGroup.batchId === batchId ? "is-active" : ""}" data-batch-id="${escapeHtml(batchId)}" role="button" tabindex="0">
        <div class="batch-card-head">
          <div class="batch-title">
            <strong>${escapeHtml(created)} · ${escapeHtml(batch.mode === "image" ? "图生图" : "文生图")}</strong>
            <em>${imageCount ? `${imageCount} 张可预览` : "暂无可预览图片"}</em>
          </div>
          <div class="batch-actions">
            <span>${escapeHtml(batch.status || "等待中")}</span>
            <button class="batch-note-button" type="button" data-batch-action="note">备注</button>
            <button class="batch-delete-button" type="button" data-batch-action="delete">删除</button>
            <button class="batch-expand-toggle" type="button" data-batch-action="toggle">${isExpanded ? "收起" : "展开"}</button>
          </div>
        </div>
        <p class="batch-prompt" title="${escapeHtml(batch.prompt || "")}">${escapeHtml(batch.prompt || "未记录提示词")}</p>
        ${noteHtml}
        <div class="batch-stats">
          <span>总数 ${Number(batch.total) || 0}</span>
          <span>成功 ${Number(batch.success) || 0}</span>
          <span>失败 ${Number(batch.failed) || 0}</span>
        </div>
        <div class="batch-items">${itemHtml}</div>
      </article>
    `;
  }).join("");
}

function normalizeBatchDraft(record = {}) {
  const items = Array.isArray(record.items) ? record.items : [];
  const batch = {
    id: String(record.id || `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    createdAt: Number(record.createdAt) || Date.now(),
    prompt: String(record.prompt || ""),
    mode: record.mode === "image" ? "image" : "text",
    quality: String(record.quality || ""),
    note: String(record.note || "").slice(0, 120),
    status: String(record.status || "等待中"),
    total: Number(record.total) || items.length,
    success: Number(record.success) || 0,
    failed: Number(record.failed) || 0,
    running: Number(record.running) || 0,
    items: items.slice(0, 10).map((item, index) => ({
      id: String(item.id || `${record.id || "batch"}-${index}`),
      requestId: String(item.requestId || ""),
      label: String(item.label || `任务 ${index + 1}`),
      status: String(item.status || "等待"),
      state: ["queued", "running", "done", "failed"].includes(item.state) ? item.state : "queued",
      image: sanitizeImageSource(item.image) || "",
      title: String(item.title || "").slice(0, 120),
      resolution: String(item.resolution || "").slice(0, 40),
      targetWidth: Number(item.targetWidth) || 0,
      targetHeight: Number(item.targetHeight) || 0,
      targetSize: String(item.targetSize || "").slice(0, 40)
    }))
  };
  refreshBatchSummary(batch);
  return batch;
}

async function generateImage() {
  const finalPrompt = promptInput.value.trim();
  if (!finalPrompt) {
    showToast("请先输入提示词", "error");
    return;
  }

  if (state.mode === "image") {
    const hasReference = await ensureReferenceImageReady();
    if (!hasReference) {
      showToast("图生图需要先选择参考图", "error");
      return;
    }
  }

  try {
    authHeaders();
  } catch (error) {
    showToast(error.message, "error");
    return;
  }

  const apiReady = await ensureApiReadyForGeneration();
  if (!apiReady) {
    return;
  }

  const targets = getGenerationTargets();
  const batchStart = state.generatedCount;
  const requestPrompt = buildPrompt(finalPrompt);
  const requestQuality = mapQuality();
  const batch = createGenerationBatch(finalPrompt, targets);
  const jobs = targets.map((target, index) => {
    const title = `${promptInput.value.trim().slice(0, 10) || "生成作品"} #${batchStart + index + 1}`;
    const batchItem = batch.items[index] || {};
    return {
      target,
      title,
      batchId: batch.id,
      batchItemId: batchItem.id || "",
      requestId: batchItem.requestId || "",
      item: addQueueJob(targets.length > 1 ? `${title} · ${target.label}` : title, {
        batchId: batch.id,
        batchItemId: batchItem.id || "",
        requestId: batchItem.requestId || "",
        mode: state.mode,
        targetWidth: target.width,
        targetHeight: target.height,
        targetLabel: target.label,
        requestPrompt,
        requestQuality
      })
    };
  });
  const summary = { success: 0, failed: 0, deferred: 0 };

  setBusy(true);
  resultStateLabel.textContent = targets.length > 1 ? "提交后端中" : "等待后端返回";
  requestHistorySyncSoon(900, { updateActive: false });

  let authFailed = false;
  const runGenerationJob = async ({ target, title, item, batchId, batchItemId, requestId }) => {
    if (authFailed) {
      summary.failed += 1;
      updateBatchItem(batchId, batchItemId, {
        state: "failed",
        status: "已取消：Key无效"
      });
      finishQueueJob(item, "已取消：Key无效", true);
      updateStatus();
      return;
    }

    updateBatchItem(batchId, batchItemId, {
      state: "running",
      status: "等待后端返回"
    });
    updateQueueJobStatus(item, "等待后端返回", 40);
    requestHistorySyncSoon(900, { updateActive: false });

    try {
      const response = state.mode === "image"
        ? await generateImageEdit(finalPrompt, target, { batchId, batchItemId, requestId })
        : await generateImageFromText(finalPrompt, target, { batchId, batchItemId, requestId });

      const images = extractImages(response);
      const imageUrl = await resolveFirstLoadableImage(images);
      if (!imageUrl) {
        throw new Error(buildNoImageError(response));
      }

      state.generatedCount += 1;
      summary.success += 1;
      const resolution = formatResolution(target.width, target.height) || "接口默认";
      const asset = addGeneratedAsset({
        image: imageUrl,
        title,
        resolution,
        meta: `${state.mode === "image" ? "图生图" : "文生图"} / ${state.quality} / ${target.label}`,
        clientBatchId: batchId,
        clientItemId: batchItemId,
        clientRequestId: requestId,
        targetWidth: target.width,
        targetHeight: target.height
      });
      selectImageFromData(asset || { image: imageUrl, title, resolution });
      updateBatchItem(batchId, batchItemId, {
        state: "done",
        status: "已完成",
        image: imageUrl,
        title,
        resolution
      });
      finishQueueJob(item, "已完成");
    } catch (error) {
      if (remoteHistoryEnabled && isPossiblyDeferredImageError(error)) {
        summary.deferred += 1;
        updateBatchItem(batchId, batchItemId, {
          state: "running",
          status: "等待后端图片"
        });
        updateQueueJobStatus(item, "等待后端图片", 75);
        resultStateLabel.textContent = "等待后端图片";
        requestHistorySyncSoon(1200, { selectBatchId: batchId, announce: true });
        console.warn("Image generation waiting for history sync:", error.message);
        return;
      }

      summary.failed += 1;
      updateBatchItem(batchId, batchItemId, {
        state: "failed",
        status: shortError(error.message)
      });
      if (isAuthError(error)) {
        authFailed = true;
        statusApi.textContent = "Key无效";
        statusApi.classList.remove("ok");
      }
      finishQueueJob(item, `失败：${shortError(error.message)}`, true);
      resultStateLabel.textContent = "生成失败";
      console.warn("Image generation failed:", error.message);
    } finally {
      updateStatus();
    }
  };

  const [firstJob, ...remainingJobs] = jobs;
  if (firstJob) {
    await runGenerationJob(firstJob);
  }

  if (authFailed && remainingJobs.length) {
    for (const job of remainingJobs) {
      await runGenerationJob(job);
    }
    showToast("Key 无效，已停止剩余批量任务", "error");
  } else if (remainingJobs.length) {
    resultStateLabel.textContent = "并发生成中";
    await runConcurrent(remainingJobs, Math.min(batchConcurrencyLimit, remainingJobs.length), runGenerationJob);
  }

  setBusy(false);
  resultStateLabel.textContent = summary.failed
    ? summary.success ? "部分完成" : "生成失败"
    : summary.deferred ? "等待后端图片"
    : "已完成";
  if (summary.failed) {
    showToast(`批量完成：成功 ${summary.success} 张，失败 ${summary.failed} 张`, "error");
  } else if (summary.deferred) {
    showToast(`后端仍在回传 ${summary.deferred} 张，已开始同步`);
  } else {
    showToast(targets.length > 1 ? `并发完成 ${summary.success} 张` : "生成完成");
  }
  updateStatus();
}

async function runConcurrent(items, limit, worker) {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function generateImageFromText(prompt, target, trace = {}, options = {}) {
  const size = resolveProviderSize(target.width, target.height);
  const body = {
    model: getImageModel(),
    prompt: options.promptReady ? prompt : buildPrompt(prompt),
    quality: options.quality || mapQuality(),
    n: 1
  };
  if (size) {
    body.size = size;
  }

  return requestJson(apiUrl(apiPaths.imageGenerations), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      ...buildClientTraceHeaders(target, trace)
    },
    body: JSON.stringify(body)
  });
}

async function generateImageEdit(prompt, target, trace = {}, options = {}) {
  const size = resolveProviderSize(target.width, target.height);
  const form = new FormData();
  form.append("model", getImageModel());
  form.append("prompt", options.promptReady ? prompt : buildPrompt(prompt));
  if (size) {
    form.append("size", size);
  }
  form.append("quality", options.quality || mapQuality());
  form.append("n", "1");
  form.append("image", state.referenceImage.file, state.referenceImage.name);

  const response = await fetch(apiUrl(apiPaths.imageEdits), {
    method: "POST",
    headers: {
      ...authHeaders(),
      ...buildClientTraceHeaders(target, trace)
    },
    body: form
  });
  const contentType = response.headers.get("Content-Type") || "";
  const text = await response.text();
  assertNotHtmlResponse(apiUrl(apiPaths.imageEdits), contentType, text);
  const data = text ? safeJson(text) : {};
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `请求失败：${response.status}`);
  }
  return data;
}

function buildClientTraceHeaders(target = {}, trace = {}) {
  const headers = {};
  const add = (key, value) => {
    const text = String(value || "").trim();
    if (text && /^[\x20-\x7E]+$/.test(text)) {
      headers[key] = text.slice(0, 160);
    }
  };

  add("X-TK-Client-Batch-Id", trace.batchId);
  add("X-TK-Client-Item-Id", trace.batchItemId);
  add("X-TK-Client-Request-Id", trace.requestId);
  const targetWidth = Math.round(Number(target.width) || 0);
  const targetHeight = Math.round(Number(target.height) || 0);
  if (targetWidth > 0) {
    add("X-TK-Target-Width", targetWidth);
  }
  if (targetHeight > 0) {
    add("X-TK-Target-Height", targetHeight);
  }
  add("X-TK-Client-Created-At", new Date().toISOString());
  return headers;
}

function getImageModel() {
  if (modelSelect) {
    modelSelect.value = fixedImageModel;
  }
  return fixedImageModel;
}

function getStyleDirection() {
  if (styleSelect?.value === "custom") {
    return customStyleInput?.value.trim() || "自定义风格";
  }
  return styleSelect?.value || "";
}

function updateCustomStyleUi() {
  if (!customStyleInput || !styleSelect) {
    return;
  }
  const isCustom = styleSelect.value === "custom";
  customStyleInput.hidden = !isCustom;
  if (!isCustom) {
    customStyleInput.value = "";
  }
}

function buildPrompt(prompt) {
  const platform = platformPresets[platformSelect.value] || platformPresets.amazon;
  const consistency = getConsistencyInstruction();
  const activeTool = $("[data-tool].active")?.dataset.tool || "";
  const subjectLabel = getFieldLabel(productNameLabel, "主体");
  const sellingLabel = getFieldLabel(productSellingPointsLabel, "方向");
  const sceneLabel = getFieldLabel(scenePoseLabel, "场景");
  const copyLabel = getFieldLabel(copyDirectionLabel, "用途");
  const parts = [
    prompt,
    activeTool ? `功能增强: ${activeTool}.` : "",
    productName.value.trim() ? `${subjectLabel}: ${productName.value.trim()}.` : "",
    productSellingPoints.value.trim() ? `${sellingLabel}: ${productSellingPoints.value.trim()}.` : "",
    scenePose.value.trim() ? `${sceneLabel}: ${scenePose.value.trim()}.` : "",
    copyDirection.value.trim() ? `${copyLabel}: ${copyDirection.value.trim()}.` : "",
    consistency,
    `${getFieldLabel(platformLabel, "平台")}: ${platform.title}.`,
    `平台规则: ${platform.rules}.`,
    `Style direction: ${getStyleDirection()}.`,
    `Creativity level: ${$("#creativity").value}/100.`,
    `Detail level: ${$("#detail").value}/100.`,
    `Output format preference: ${$("#format").value}.`,
    `Background preference: ${$("#background").value}.`
  ].filter(Boolean);

  return parts.join("\n");
}

function getConsistencyInstruction() {
  const selected = $$("[data-consistency]:checked").map((item) => item.dataset.consistency);
  if (!selected.length) {
    return "";
  }

  const board = getActiveBoard();
  if (board === "personal") {
    return hasActiveReference()
      ? "参考图一致性: 保持人物或主体特征、比例、发型、服饰气质和整体情绪一致."
      : "主体设定: 主体清晰自然，风格、情绪和画面气质稳定；未提供参考图时不要编造真实品牌文字或水印.";
  }

  if (board === "trending") {
    return hasActiveReference()
      ? "参考图一致性: 保留参考图主体特征，同时生成更适合社媒传播的流行视觉效果."
      : "主体设定: 主体可信、风格明确、玩法记忆点突出；未提供参考图时不要编造真实品牌文字或水印.";
  }

  if (hasActiveReference()) {
    return `商品一致性: ${selected.join("；")}.`;
  }

  return "商品设定: 商品结构清晰合理，颜色和材质表达稳定；未提供参考图时不要编造真实品牌 Logo、包装小字或需要严格复刻的文字.";
}

function resolveProviderSize(widthValue = Number(widthInput.value), heightValue = Number(heightInput.value)) {
  const width = Math.round(Number(widthValue) || 0);
  const height = Math.round(Number(heightValue) || 0);
  if (width <= 0 || height <= 0) {
    return "";
  }
  return `${width}x${height}`;
}

function mapQuality() {
  if (state.quality === "快速") return "low";
  if (state.quality === "标准") return "medium";
  if (state.quality === "精细") return "high";
  return "auto";
}

function toDataUrl(b64Json) {
  return b64Json ? `data:image/png;base64,${b64Json}` : "";
}

function extractImages(payload) {
  const images = [];

  const addTrustedUrl = (url) => {
    if (!url) {
      return;
    }
    const clean = normalizeImageUrl(url);
    if (clean) {
      images.push({ url: clean });
    }
  };

  const add = (value) => {
    if (!value) {
      return;
    }
    if (typeof value === "string") {
      const text = value.trim();
      const parsed = parseMaybeJson(text);
      if (parsed) {
        add(parsed);
        return;
      }
      const dataUrl = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/);
      if (dataUrl) {
        images.push({ url: dataUrl[0].replace(/\s/g, "") });
        return;
      }
      const urls = extractUrlCandidates(text);
      if (urls.length) {
        urls.forEach((url) => images.push({ url: normalizeImageUrl(url) }));
      } else if (isLikelyImageUrl(text)) {
        images.push({ url: normalizeImageUrl(text) });
      } else if (looksLikeBase64(text)) {
        images.push({ b64: text.replace(/\s/g, "") });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (typeof value !== "object") {
      return;
    }

    const url = value.url || value.image_url || value.imageUrl || value.output_url || value.src;
    const b64 = value.b64_json || value.b64Json || value.base64 || value.image_base64;
    addTrustedUrl(url);
    if (b64) {
      images.push({ b64 });
    }
    if (value.image) {
      add(value.image);
    }
    if (value.result) {
      add(value.result);
    }
    if (value.content) {
      add(value.content);
    }
  };

  add(payload?.data);
  add(payload?.images);
  add(payload?.image);
  add(payload?.url);
  add(payload?.message);
  add(payload?.result);
  add(payload?.output);

  return images;
}

function buildNoImageError(response) {
  const keys = Object.keys(response || {}).join(", ") || "空";
  const message = typeof response?.message === "string" ? response.message.trim() : "";
  if (message) {
    if (/uploadLikenessButton|上传.*(商品|参考|原始).*图|upload.*image/i.test(message)) {
      return "接口要求上传参考图。请切到图生图并上传商品图，或取消需要复刻 Logo/包装文字的提示。";
    }
    return `接口返回 message，但没有图片：${message.slice(0, 220)}`;
  }
  return `接口返回成功，但没有找到图片字段。返回字段：${keys}`;
}

function isPossiblyDeferredImageError(error) {
  const message = String(error?.message || "");
  return /没有找到图片字段|接口返回 message，但没有图片|图片地址不可访问|timeout|超时|后台可能仍在处理|等待后台/i.test(message);
}

function parseMaybeJson(value) {
  if (!value || !/^[\[{]/.test(value)) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function resolveFirstLoadableImage(images) {
  const failures = [];

  for (const item of images) {
    const candidate = item?.url || toDataUrl(item?.b64);
    if (!candidate) {
      continue;
    }
    if (candidate.startsWith("data:image/")) {
      return candidate;
    }

    try {
      await waitForImageLoad(candidate);
      return candidate;
    } catch {
      failures.push(candidate);
    }
  }

  if (failures.length) {
    throw new Error(`图片地址不可访问：${failures[0]}`);
  }
  return "";
}

function waitForImageLoad(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      reject(new Error("Image load timeout"));
    }, 2500);

    image.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Image load failed"));
    };
    image.src = url;
  });
}

function extractUrlCandidates(text) {
  const markdownUrls = Array.from(text.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)).map((match) => match[1]);
  const plainUrls = text.match(/(?:https?:\/\/|\/generated-images\/|generated-images\/)[^\s"'<>]+/g) || [];
  return [...markdownUrls, ...plainUrls]
    .map(cleanUrlCandidate)
    .filter(isLikelyImageUrl);
}

function cleanUrlCandidate(url) {
  let clean = String(url || "").trim();
  clean = clean.replace(/^["'(<]+/, "").replace(/[)"'>,.;，。]+$/, "");
  if (clean.startsWith("generated-images/")) {
    clean = `/${clean}`;
  }
  return clean;
}

function isLikelyImageUrl(url) {
  const clean = cleanUrlCandidate(url);
  if (!clean) {
    return false;
  }
  if (clean.startsWith("data:image/")) {
    return true;
  }
  if (clean.startsWith("/generated-images/") || clean.includes("/generated-images/")) {
    return true;
  }
  try {
    const parsed = new URL(clean, getApiBase());
    return /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.test(parsed.pathname);
  } catch {
    return /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.test(clean);
  }
}

function normalizeImageUrl(url) {
  const clean = cleanUrlCandidate(url);
  if (clean.startsWith("/") && !clean.startsWith("//")) {
    return new URL(clean, getApiBase()).toString();
  }
  return clean;
}

function normalizeAssetRecord(record = {}) {
  const safeImage = sanitizeImageSource(record.image);
  if (!safeImage) {
    return null;
  }
  const resolution = record.resolution || getAssetResolution(record);
  const dimensions = parseResolutionDimensions(resolution);
  return {
    ...record,
    image: safeImage,
    title: record.title || "生成作品",
    resolution,
    meta: record.meta || "",
    width: Number(record.width) || dimensions?.width || 0,
    height: Number(record.height) || dimensions?.height || 0,
    createdAt: record.createdAt || record.created_at || "",
    createdAtMs: Number(record.createdAtMs) || Date.parse(record.createdAt || record.created_at || "") || 0,
    requestedSize: String(record.requestedSize || record.requested_size || ""),
    mode: String(record.mode || ""),
    model: String(record.model || ""),
    clientBatchId: String(record.clientBatchId || record.client_batch_id || ""),
    clientItemId: String(record.clientItemId || record.client_item_id || ""),
    clientRequestId: String(record.clientRequestId || record.client_request_id || ""),
    targetWidth: Number(record.targetWidth || record.target_width) || 0,
    targetHeight: Number(record.targetHeight || record.target_height) || 0
  };
}

function getImageSourcePriority(image) {
  const safeImage = sanitizeImageSource(image);
  if (!safeImage) {
    return 0;
  }
  if (safeImage.startsWith("data:image/") || safeImage.startsWith("blob:")) {
    return 1;
  }

  try {
    const parsed = new URL(safeImage, fixedApiBase);
    if (parsed.origin === fixedApiBase && isGeneratedImagePath(parsed.pathname)) {
      return 5;
    }
    if (isGeneratedImagePath(parsed.pathname)) {
      return 4;
    }
    if (parsed.origin === fixedApiBase || parsed.origin === window.location.origin) {
      return 3;
    }
    return 2;
  } catch {
    return 1;
  }
}

function shouldPreferImageSource(nextImage, currentImage, allowDifferentImage = false) {
  if (!sameAssetImage(nextImage, currentImage) && !allowDifferentImage) {
    return false;
  }
  return getImageSourcePriority(nextImage) > getImageSourcePriority(currentImage);
}

function syncTrackedImageSource(previousImage, nextImage) {
  const safeNext = sanitizeImageSource(nextImage);
  if (!safeNext || previousImage === safeNext) {
    return;
  }
  if (state.activeImage === previousImage || sameAssetImage(state.activeImage, previousImage)) {
    state.activeImage = safeNext;
  }
  const selectedMatches = Array.from(selectedAssetImages).filter((image) => image === previousImage || sameAssetImage(image, previousImage));
  selectedMatches.forEach((image) => selectedAssetImages.delete(image));
  if (selectedMatches.length) {
    selectedAssetImages.add(safeNext);
  }
}

function shouldUseIncomingText(currentValue, incomingValue, preferIncoming = false) {
  const incoming = String(incomingValue || "").trim();
  if (!incoming) {
    return false;
  }
  if (preferIncoming) {
    return true;
  }
  const current = String(currentValue || "").trim();
  return !current || ["生成作品", "后台完成作品", "尺寸检测中"].includes(current);
}

function mergeAssetRecord(existing, record, options = {}) {
  const incoming = normalizeAssetRecord(record);
  if (!existing || !incoming) {
    return false;
  }

  const previousImage = existing.image;
  const sharedTrace = sameAssetTrace(existing, incoming);
  if (!sanitizeImageSource(existing.image) || shouldPreferImageSource(incoming.image, existing.image, sharedTrace)) {
    existing.image = incoming.image;
    syncTrackedImageSource(previousImage, existing.image);
  }

  ["title", "resolution", "meta"].forEach((key) => {
    if (shouldUseIncomingText(existing[key], incoming[key], options.preferIncoming)) {
      existing[key] = incoming[key];
    }
  });
  ["createdAt", "requestedSize", "mode", "model", "clientBatchId", "clientItemId", "clientRequestId"].forEach((key) => {
    if (!existing[key] && incoming[key]) {
      existing[key] = incoming[key];
    }
  });
  if (!existing.width && incoming.width) existing.width = incoming.width;
  if (!existing.height && incoming.height) existing.height = incoming.height;
  if (!existing.createdAtMs && incoming.createdAtMs) existing.createdAtMs = incoming.createdAtMs;
  if (!existing.targetWidth && incoming.targetWidth) existing.targetWidth = incoming.targetWidth;
  if (!existing.targetHeight && incoming.targetHeight) existing.targetHeight = incoming.targetHeight;
  return true;
}

function upsertAssetRecord(record, options = {}) {
  const incoming = normalizeAssetRecord(record);
  if (!incoming) {
    return { asset: null, isNew: false };
  }

  const existingIndex = findAssetIndexByRecord(incoming);
  if (existingIndex >= 0) {
    const existing = state.assets[existingIndex];
    mergeAssetRecord(existing, incoming, options);
    if (options.moveToFront && existingIndex > 0) {
      state.assets.splice(existingIndex, 1);
      state.assets.unshift(existing);
    }
    return { asset: existing, isNew: false };
  }

  state.assets.unshift(incoming);
  return { asset: incoming, isNew: true };
}

function dedupeAssetRecords(records = []) {
  const deduped = [];
  records.forEach((record) => {
    const asset = normalizeAssetRecord(record);
    if (!asset) {
      return;
    }
    const existing = deduped.find((record) => sameAssetRecord(record, asset));
    if (existing) {
      mergeAssetRecord(existing, asset);
      return;
    }
    deduped.push(asset);
  });
  return deduped;
}

function dedupeStateAssets() {
  const before = state.assets.length;
  state.assets = dedupeAssetRecords(state.assets).slice(0, maxSavedAssets);
  return state.assets.length !== before;
}

function removeRenderedAssetItemsByImage(image) {
  const key = getAssetImageKey(image);
  if (!key) {
    return;
  }
  $$(".asset-item").forEach((item) => {
    if (getAssetImageKey(item.dataset.image) === key) {
      item.remove();
    }
  });
}

function getRenderedAssetRecord(item) {
  return {
    image: item?.dataset?.image || "",
    clientBatchId: item?.dataset?.clientBatchId || "",
    clientItemId: item?.dataset?.clientItemId || "",
    clientRequestId: item?.dataset?.clientRequestId || ""
  };
}

function removeRenderedAssetItemsByRecord(record) {
  const asset = normalizeAssetRecord(record);
  if (!asset) {
    return;
  }
  $$(".asset-item").forEach((item) => {
    if (sameAssetRecord(getRenderedAssetRecord(item), asset)) {
      item.remove();
    }
  });
}

function updateRenderedAssetItem(record) {
  const asset = normalizeAssetRecord(record);
  if (!asset) {
    return;
  }

  const nodes = $$(".asset-item").filter((item) => sameAssetRecord(getRenderedAssetRecord(item), asset));
  nodes.slice(1).forEach((item) => item.remove());
  const item = nodes[0];
  if (!item) {
    return;
  }

  item.dataset.image = asset.image;
  item.dataset.title = asset.title || "";
  item.dataset.resolution = asset.resolution || "";
  item.dataset.clientBatchId = asset.clientBatchId || "";
  item.dataset.clientItemId = asset.clientItemId || "";
  item.dataset.clientRequestId = asset.clientRequestId || "";
  const thumbnail = item.querySelector("img");
  if (thumbnail && thumbnail.getAttribute("src") !== asset.image) {
    thumbnail.src = asset.image;
  }
  if (thumbnail) {
    thumbnail.alt = asset.title || "生成作品";
  }
  const titleElement = item.querySelector("strong");
  if (titleElement) {
    titleElement.textContent = asset.title || "生成作品";
  }
  const sizeElement = item.querySelector(".asset-size");
  if (sizeElement) {
    sizeElement.textContent = asset.resolution || "尺寸检测中";
  }
  const metaElement = item.querySelector(".asset-meta");
  if (metaElement) {
    metaElement.textContent = asset.meta || "";
  }
  const selected = isAssetSelected(asset.image);
  item.classList.toggle("is-selected", selected);
  item.setAttribute("aria-pressed", selected ? "true" : "false");
  item.classList.toggle("active", sameAssetImage(state.activeImage, asset.image));
}

function renderAssetList() {
  const assetList = $("#asset-list");
  assetList.replaceChildren();
  state.assets.forEach((asset) => {
    renderAssetItem(asset, "append");
  });
  updateStatus();
}

function looksLikeBase64(value) {
  return value.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function addGeneratedAsset({ image, title, resolution, meta, clientBatchId = "", clientItemId = "", clientRequestId = "", targetWidth = 0, targetHeight = 0 }) {
  const safeImage = sanitizeImageSource(image);
  if (!safeImage) {
    showToast("接口返回的图片地址不安全，已忽略", "error");
    return;
  }

  const dimensions = parseResolutionDimensions(resolution);
  const { asset } = upsertAssetRecord({
    image: safeImage,
    title,
    resolution,
    meta,
    width: dimensions?.width || Number(widthInput.value),
    height: dimensions?.height || Number(heightInput.value),
    clientBatchId,
    clientItemId,
    clientRequestId,
    targetWidth,
    targetHeight
  }, { preferIncoming: true, moveToFront: true });
  if (!asset) {
    return null;
  }
  renderAssetItem(asset, "prepend");
  scheduleWorkspaceDraftSave();
  return asset;
}

function renderAssetItem(record, mode = "prepend") {
  const assetData = normalizeAssetRecord(record);
  if (!assetData) {
    return;
  }

  const safeImage = assetData.image;
  const { title, resolution, meta } = assetData;
  if (!safeImage) {
    return;
  }

  removeRenderedAssetItemsByRecord(assetData);

  const asset = document.createElement("button");
  asset.className = "asset-item";
  asset.type = "button";
  asset.dataset.image = safeImage;
  asset.dataset.title = title || "";
  asset.dataset.resolution = resolution || "";
  asset.dataset.clientBatchId = assetData.clientBatchId || "";
  asset.dataset.clientItemId = assetData.clientItemId || "";
  asset.dataset.clientRequestId = assetData.clientRequestId || "";
  asset.setAttribute("aria-pressed", isAssetSelected(safeImage) ? "true" : "false");

  const thumbnail = document.createElement("img");
  thumbnail.loading = "lazy";
  thumbnail.decoding = "async";
  thumbnail.addEventListener("load", () => captureImageResolution(safeImage, thumbnail));
  thumbnail.src = safeImage;
  thumbnail.alt = title || "生成作品";
  captureLoadedImageResolution(safeImage, thumbnail);

  const text = document.createElement("span");
  const titleElement = document.createElement("strong");
  titleElement.textContent = title || "生成作品";
  const sizeElement = document.createElement("em");
  sizeElement.className = "asset-size";
  sizeElement.textContent = resolution || "尺寸检测中";
  const metaElement = document.createElement("small");
  metaElement.className = "asset-meta";
  metaElement.textContent = meta || "";
  text.append(titleElement, sizeElement, metaElement);
  const check = document.createElement("span");
  check.className = "asset-check";
  check.setAttribute("aria-hidden", "true");
  asset.classList.toggle("is-selected", isAssetSelected(safeImage));
  asset.append(thumbnail, text, check);

  if (mode === "append") {
    $("#asset-list").append(asset);
  } else {
    $("#asset-list").prepend(asset);
  }
  asset.addEventListener("click", () => {
    if (librarySelectionMode) {
      toggleAssetSelection(safeImage);
      return;
    }
    selectImageFromData(asset.dataset);
  });
  updateStatus();
}

async function syncRemoteHistory() {
  return null;
}

function normalizeHistoryAsset(item = {}) {
  const image = sanitizeImageSource(getHistoryImageSource(item));
  if (!image) {
    return null;
  }

  const promptTitle = String(item.title || item.prompt || item.revisedPrompt || item.revised_prompt || "").trim();
  const requestedSize = item.requestedSize || item.requested_size || item.resolution || item.providerSize || item.provider_size || "";
  const resolution = formatProviderSize(requestedSize);
  const meta = [
    item.mode === "image" ? "图生图" : item.mode === "text" ? "文生图" : "后台同步",
    item.quality || "",
    item.model || "",
    item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false }) : ""
  ].filter(Boolean).join(" / ");

  return {
    image,
    title: promptTitle ? promptTitle.slice(0, 18) : "后台完成作品",
    resolution,
    meta,
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    createdAt: item.createdAt || item.created_at || "",
    createdAtMs: Date.parse(item.createdAt || item.created_at || "") || 0,
    mode: item.mode || "",
    model: item.model || "",
    requestedSize: String(requestedSize || ""),
    clientBatchId: String(item.clientBatchId || item.client_batch_id || ""),
    clientItemId: String(item.clientItemId || item.client_item_id || ""),
    clientRequestId: String(item.clientRequestId || item.client_request_id || ""),
    targetWidth: Number(item.targetWidth || item.target_width) || 0,
    targetHeight: Number(item.targetHeight || item.target_height) || 0
  };
}

function getSelectableBatchAsset(batchId, binding = {}) {
  const id = String(batchId || "");
  if (!id) {
    return null;
  }

  if (binding.latestBoundAssetByBatchId?.[id]) {
    return binding.latestBoundAssetByBatchId[id];
  }

  const batch = state.batches.find((record) => record.id === id);
  if (!batch) {
    return null;
  }

  const items = getBatchPreviewItems(batch);
  return items.length ? items[items.length - 1] : null;
}

function getHistoryImageSource(item = {}) {
  const fields = [
    item.url,
    item.image,
    item.image_url,
    item.imageUrl,
    item.output_url,
    item.outputUrl,
    item.src,
    item.path
  ];

  for (const value of fields) {
    const candidate = getImageSourceFromValue(value);
    if (candidate) {
      return candidate;
    }
  }

  const nested = [item.images, item.outputs, item.output, item.result, item.data];
  for (const value of nested) {
    const candidate = getImageSourceFromValue(value);
    if (candidate) {
      return candidate;
    }
  }

  if (item.filename && String(item.filename).endsWith(".png")) {
    return `/generated-images/${item.filename}`;
  }
  return "";
}

function getImageSourceFromValue(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = getImageSourceFromValue(item);
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }
  if (typeof value === "object") {
    return getHistoryImageSource(value);
  }
  return "";
}

function mergeHistoryAsset(existing, asset) {
  mergeAssetRecord(existing, asset);
}

function bindHistoryAssetsToBatches(assets = []) {
  const result = {
    boundCount: 0,
    finishedQueueCount: 0,
    latestBoundAsset: null,
    latestBoundAssetByBatchId: {}
  };
  const alreadyBoundImages = new Set();
  state.batches.forEach((batch) => {
    (batch.items || []).forEach((item) => {
      const imageKey = getAssetImageKey(item.image);
      if (imageKey) {
        alreadyBoundImages.add(imageKey);
      }
    });
  });

  assets.forEach((asset) => {
    const assetImage = sanitizeImageSource(asset?.image);
    const assetImageKey = getAssetImageKey(assetImage);
    if (!assetImage || alreadyBoundImages.has(assetImageKey)) {
      return;
    }

    const match = findHistoryBatchMatch(asset);
    if (!match) {
      return;
    }

    const isExactBackendMatch = match.source === "exact";
    const itemResolution = asset.resolution || getBatchItemTargetResolution(match.item);
    const itemTitle = match.item.title || asset.title || match.item.label || "后台完成作品";
    updateBatchItem(match.batch.id, match.item.id, {
      state: "done",
      status: isExactBackendMatch ? "后端已返回图片" : "历史回填",
      image: assetImage,
      title: itemTitle,
      resolution: itemResolution
    });
    alreadyBoundImages.add(assetImageKey);

    if (itemResolution) {
      syncImageResolution(assetImage, itemResolution);
    }
    if (isExactBackendMatch && finishQueueForBatchItem(match, "后端已返回图片")) {
      result.finishedQueueCount += 1;
    }
    result.boundCount += 1;
    result.latestBoundAsset = {
      ...asset,
      title: itemTitle,
      resolution: itemResolution || asset.resolution
    };
    result.latestBoundAssetByBatchId[match.batch.id] = result.latestBoundAsset;
  });

  return result;
}

function findHistoryBatchMatch(asset) {
  const exact = findExactHistoryBatchMatch(asset);
  if (exact) {
    return exact;
  }
  return findBestEffortHistoryBatchMatch(asset);
}

function findExactHistoryBatchMatch(asset) {
  const clientBatchId = String(asset.clientBatchId || "");
  const clientItemId = String(asset.clientItemId || "");
  const clientRequestId = String(asset.clientRequestId || "");
  if (!clientBatchId && !clientItemId && !clientRequestId) {
    return null;
  }

  for (const batch of state.batches) {
    if (clientBatchId && batch.id !== clientBatchId) {
      continue;
    }
    const item = (batch.items || []).find((entry) => {
      const isTraceMatched = (clientItemId && entry.id === clientItemId)
        || (clientRequestId && entry.requestId === clientRequestId);
      if (entry.image && !isTraceMatched) {
        return false;
      }
      return isTraceMatched;
    });
    if (item) {
      return { batch, item, source: "exact" };
    }
  }
  return null;
}

function findBestEffortHistoryBatchMatch(asset) {
  const candidates = [];
  state.batches.forEach((batch) => {
    (batch.items || []).forEach((item, index) => {
      if (item.image || !canHistoryAssetMatchBatchItem(asset, batch, item)) {
        return;
      }
      candidates.push({ batch, item, index });
    });
  });

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => {
    const timeA = getHistoryBatchTimeDistance(asset, a.batch);
    const timeB = getHistoryBatchTimeDistance(asset, b.batch);
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    if ((a.batch.createdAt || 0) !== (b.batch.createdAt || 0)) {
      return (a.batch.createdAt || 0) - (b.batch.createdAt || 0);
    }
    return a.index - b.index;
  });

  return { ...candidates[0], source: "history" };
}

function canHistoryAssetMatchBatchItem(asset, batch, item) {
  if (!isRestoredHistoryBatch(batch)) {
    return false;
  }
  if (asset.mode && batch.mode && asset.mode !== batch.mode) {
    return false;
  }

  const assetTime = Number(asset.createdAtMs) || 0;
  const batchTime = Number(batch.createdAt) || 0;
  if (assetTime && batchTime) {
    const fiveMinutes = 5 * 60 * 1000;
    const thirtyMinutes = 30 * 60 * 1000;
    if (assetTime < batchTime - fiveMinutes || assetTime > batchTime + thirtyMinutes) {
      return false;
    }
  }

  const assetDims = getHistoryAssetDimensions(asset);
  const itemDims = getBatchItemDimensions(item);
  if (assetDims && itemDims) {
    return assetDims.width === itemDims.width && assetDims.height === itemDims.height;
  }

  return false;
}

function isRestoredHistoryBatch(batch = {}) {
  return (batch.items || []).some((item) => !item.requestId);
}

function getHistoryBatchTimeDistance(asset, batch) {
  const assetTime = Number(asset.createdAtMs) || 0;
  const batchTime = Number(batch.createdAt) || 0;
  if (!assetTime || !batchTime) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.abs(assetTime - batchTime);
}

function getHistoryAssetDimensions(asset = {}) {
  if (asset.targetWidth && asset.targetHeight) {
    return { width: Number(asset.targetWidth), height: Number(asset.targetHeight) };
  }
  return parseResolutionDimensions(asset.requestedSize || asset.resolution);
}

function getBatchItemDimensions(item = {}) {
  if (item.targetWidth && item.targetHeight) {
    return { width: Number(item.targetWidth), height: Number(item.targetHeight) };
  }
  return parseResolutionDimensions(item.targetSize || item.resolution);
}

function getBatchItemTargetResolution(item = {}) {
  const dimensions = getBatchItemDimensions(item);
  return dimensions ? formatResolution(dimensions.width, dimensions.height) : "";
}

function finishQueueForBatchItem(match, status) {
  const pending = getPendingQueueItems();
  const exact = pending.find((item) => {
    return (match.item.id && item.dataset.batchItemId === match.item.id)
      || (match.item.requestId && item.dataset.requestId === match.item.requestId);
  });
  if (!exact) {
    return false;
  }
  finishQueueJob(exact, status);
  return true;
}

function getPendingQueueItems() {
  return $$(".queue-item").filter((item) => !item.classList.contains("done") && !item.classList.contains("failed"));
}

function hasPendingHistoryWork() {
  return getPendingQueueItems().length > 0
    || state.batches.some((batch) => (batch.items || []).some((item) => item.image ? false : ["queued", "running"].includes(item.state)));
}

function scheduleNextHistorySync(delay = hasPendingHistoryWork() ? activeHistorySyncIntervalMs : idleHistorySyncIntervalMs) {
  if (!remoteHistoryEnabled) {
    return;
  }

  if (historySyncTimer) {
    window.clearTimeout(historySyncTimer);
  }
  historySyncTimer = window.setTimeout(async () => {
    historySyncTimer = 0;
    await syncRemoteHistory();
    scheduleNextHistorySync();
  }, delay);
}

function requestHistorySyncSoon(delay = 0, options = {}) {
  if (!remoteHistoryEnabled) {
    return;
  }

  if (historySyncTimer) {
    window.clearTimeout(historySyncTimer);
  }
  historySyncTimer = window.setTimeout(async () => {
    historySyncTimer = 0;
    await syncRemoteHistory(options);
    scheduleNextHistorySync();
  }, Math.max(0, Number(delay) || 0));
}

function startHistorySync() {
  if (!remoteHistoryEnabled) {
    return;
  }

  requestHistorySyncSoon(0, { selectLatest: !state.activeImage });
}

async function downloadImageAsset(asset) {
  if (!asset?.image) {
    throw new Error("没有可下载的图片");
  }
  const filename = `${sanitizeFilename(asset.title || "image")}-${sanitizeFilename(asset.resolution || "output")}.${$("#format").value || "png"}`;
  const directUrl = getDirectDownloadUrl(asset.image);
  if (directUrl) {
    triggerUrlDownload(directUrl, filename);
    return;
  }

  const blob = await fetchImageBlob(asset.image);
  triggerBlobDownload(blob, filename);
}

async function downloadAllAssets() {
  if (!state.assets.length) {
    showToast("还没有可下载的图片", "error");
    return;
  }
  for (const asset of [...state.assets].reverse()) {
    try {
      await downloadImageAsset(asset);
    } catch (error) {
      showToast(error.message, "error");
      return;
    }
  }
  showToast(`已开始下载 ${state.assets.length} 张图片`);
}

async function deleteSelectedAssets() {
  const images = Array.from(selectedAssetImages);
  if (!images.length) {
    return;
  }

  deleteAssetsButton.disabled = true;

  try {
    await deleteRemoteImages(images);
    removeAssetsByImages(images);
    setLibrarySelectionMode(false);
    showToast(`已删除 ${images.length} 张作品`);
  } catch (error) {
    showToast(`删除失败：${shortError(error.message)}`, "error");
    updateLibrarySelectionUi();
  }
}

async function deleteAllAssets() {
  if (!state.assets.length) {
    showToast("作品库已经是空的");
    return;
  }

  const total = state.assets.length;
  if (!window.confirm(`确认删除作品库全部 ${total} 张作品？服务器上的生成图也会一起删除。`)) {
    return;
  }

  deleteAllAssetsButton.disabled = true;
  try {
    const images = state.assets.map((asset) => asset.image);
    await deleteRemoteImages(images);
    removeAssetsByImages(images);
    setLibrarySelectionMode(false);
    showToast(`已删除全部 ${total} 张作品`);
  } catch (error) {
    showToast(`全部删除失败：${shortError(error.message)}`, "error");
  } finally {
    updateLibrarySelectionUi();
  }
}

async function deleteBatch(batchId) {
  const batch = state.batches.find((record) => record.id === batchId);
  if (!batch) {
    return;
  }

  const images = getDirectBatchPreviewItems(batch).map((item) => item.image).filter(Boolean);
  const message = images.length
    ? `确认删除这个批次和关联的 ${images.length} 张作品？`
    : "确认删除这个批次记录？";
  if (!window.confirm(message)) {
    return;
  }

  try {
    await deleteRemoteImages(images);
    state.batches = state.batches.filter((record) => record.id !== batchId);
    expandedBatchIds.delete(batchId);
    if (activePreviewGroup.batchId === batchId) {
      clearPreviewGroup();
    }

    if (images.length) {
      removeAssetsByImages(images);
    } else {
      renderBatchHistory();
      updateStatus();
      scheduleWorkspaceDraftSave();
    }
    showToast("批次已删除");
  } catch (error) {
    showToast(`批次删除失败：${shortError(error.message)}`, "error");
  }
}

async function deleteRemoteImages() {
  return 0;
}

function isServerStoredImage(image) {
  const safeImage = sanitizeImageSource(image);
  if (!safeImage) {
    return false;
  }
  try {
    const parsed = new URL(safeImage, getApiBase());
    return parsed.pathname.startsWith("/generated-images/");
  } catch {
    return false;
  }
}

function removeAssetsByImages(images) {
  const removeSet = new Set(images.map(getAssetImageKey).filter(Boolean));
  if (!removeSet.size) {
    return;
  }

  const removedActive = removeSet.has(getAssetImageKey(state.activeImage));
  const hadPreviewGroup = Boolean(activePreviewGroup.batchId);
  state.assets = state.assets.filter((asset) => !removeSet.has(getAssetImageKey(asset.image)));
  $$(".asset-item").forEach((item) => {
    if (removeSet.has(getAssetImageKey(item.dataset.image))) {
      item.remove();
    }
  });
  $$(".variant-card").forEach((item) => {
    if (removeSet.has(getAssetImageKey(item.dataset.image))) {
      item.remove();
    }
  });
  Array.from(selectedAssetImages).forEach((image) => {
    if (removeSet.has(getAssetImageKey(image))) {
      selectedAssetImages.delete(image);
    }
  });
  const batchesChanged = removeImagesFromBatches(removeSet);
  const groupSelected = hadPreviewGroup
    ? refreshActivePreviewGroupAfterAssetRemoval(removeSet)
    : false;

  if (removedActive && !groupSelected) {
    const nextAsset = state.assets[0];
    if (!hadPreviewGroup && nextAsset) {
      selectImageFromData(nextAsset);
    } else {
      clearMainPreview();
    }
  }

  if (batchesChanged) {
    renderBatchHistory();
  }
  updateStatus();
  scheduleWorkspaceDraftSave();
}

function removeImagesFromBatches(removeSet) {
  let changed = false;
  state.batches.forEach((batch) => {
    const items = Array.isArray(batch.items) ? batch.items : [];
    const nextItems = items.filter((item) => !removeSet.has(getAssetImageKey(item.image)));
    if (nextItems.length !== items.length) {
      batch.items = nextItems;
      refreshBatchSummary(batch);
      changed = true;
    }
  });
  return changed;
}

function refreshActivePreviewGroupAfterAssetRemoval(removeSet) {
  if (!activePreviewGroup.batchId) {
    return false;
  }

  const batch = state.batches.find((record) => record.id === activePreviewGroup.batchId);
  if (!batch) {
    clearPreviewGroup();
    return false;
  }

  const previousIndex = activePreviewGroup.index || 0;
  const currentImage = sanitizeImageSource(state.activeImage);
  const currentKey = getAssetImageKey(currentImage);
  const items = getBatchPreviewItems(batch);
  if (!items.length) {
    clearPreviewGroup();
    return false;
  }

  const currentIndex = items.findIndex((item) => sameAssetImage(item.image, currentImage));
  const nextIndex = currentIndex >= 0
    ? currentIndex
    : Math.min(previousIndex, items.length - 1);

  activePreviewGroup = {
    batchId: batch.id,
    index: nextIndex,
    items
  };

  if (removeSet.has(currentKey)) {
    selectImageFromData(items[nextIndex], { preserveGroup: true });
  } else {
    updatePreviewGroupControls();
  }
  return true;
}

function clearMainPreview() {
  state.activeImage = null;
  mainPreview.removeAttribute("src");
  mainPreview.hidden = true;
  emptyPreview.hidden = false;
  mainFrame.classList.remove("has-image");
  mainTitle.textContent = "未生成";
  resultStateLabel.textContent = "等待生成";
  setDisplayedResolution();
  $$(".asset-item, .variant-card").forEach((item) => item.classList.remove("active"));
  updateEditorAvailability();
}

function selectBlankCanvas() {
  clearPreviewGroup();
  clearMainPreview();
  resultStateLabel.textContent = "空白画布";
  blankCanvas.classList.add("is-pressed");
  window.setTimeout(() => {
    blankCanvas.classList.remove("is-pressed");
  }, 180);
  showToast("已切换到空白画布");
  updateStatus();
  scheduleWorkspaceDraftSave();
}

async function fetchImageBlob(url) {
  const safeUrl = sanitizeImageSource(url);
  if (!safeUrl) {
    throw new Error("图片地址不安全，无法下载");
  }

  if (safeUrl.startsWith("data:image/")) {
    return dataUrlToFile(safeUrl, "image");
  }

  const candidates = getDownloadCandidates(safeUrl);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        credentials: isSameOriginUrl(candidate) ? "same-origin" : "omit"
      });
      if (!response.ok) {
        throw new Error(`下载失败：${response.status}`);
      }
      const blob = await response.blob();
      if (!blob.size) {
        throw new Error("下载到的图片为空");
      }
      return blob;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`下载失败：${shortError(lastError?.message || "图片无法读取")}`);
}

function getDownloadCandidates(url) {
  const candidates = [];
  const addCandidate = (candidate) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  try {
    const parsed = new URL(url, fixedApiBase);
    const sameOriginPath = new URL(`${parsed.pathname}${parsed.search}`, fixedApiBase).toString();

    if (isGeneratedImagePath(parsed.pathname)) {
      addCandidate(sameOriginPath);
    }

    addCandidate(parsed.toString());
  } catch {
    addCandidate(url);
  }

  return candidates;
}

function getDirectDownloadUrl(url) {
  const safeUrl = sanitizeImageSource(url);
  if (!safeUrl || safeUrl.startsWith("data:image/")) {
    return "";
  }

  if (safeUrl.startsWith("blob:")) {
    return safeUrl;
  }

  try {
    const parsed = new URL(safeUrl, fixedApiBase);
    if (isGeneratedImagePath(parsed.pathname)) {
      return new URL(`${parsed.pathname}${parsed.search}`, fixedApiBase).toString();
    }
    if (parsed.origin === window.location.origin) {
      return parsed.toString();
    }
  } catch {
    return "";
  }

  return "";
}

function isGeneratedImagePath(pathname = "") {
  return /\/generated(?:-images)?\//.test(pathname);
}

function isSameOriginUrl(url) {
  try {
    return new URL(url, fixedApiBase).origin === window.location.origin;
  } catch {
    return false;
  }
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  triggerUrlDownload(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerUrlDownload(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function sanitizeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
}

function addVariant({ image, title, resolution }) {
  if (!variantStrip) {
    return;
  }

  const safeImage = sanitizeImageSource(image);
  if (!safeImage) {
    return;
  }

  const variant = document.createElement("button");
  variant.className = "variant-card";
  variant.type = "button";
  variant.dataset.image = safeImage;
  variant.dataset.title = title || "";
  variant.dataset.resolution = resolution || "";

  const thumbnail = document.createElement("img");
  thumbnail.loading = "lazy";
  thumbnail.decoding = "async";
  thumbnail.addEventListener("load", () => captureImageResolution(safeImage, thumbnail));
  thumbnail.src = safeImage;
  thumbnail.alt = title || "生成变体";
  captureLoadedImageResolution(safeImage, thumbnail);
  const badge = document.createElement("span");
  badge.textContent = `V${variantStrip.children.length + 1}`;
  variant.append(thumbnail, badge);
  variant.addEventListener("click", () => selectImageFromData(variant.dataset));
  variantStrip.prepend(variant);
  updateStatus();
}

function scheduleWorkspaceDraftSave() {
  if (!draftReady) {
    return;
  }

  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(saveWorkspaceDraft, 260);
}

function saveWorkspaceDraft() {
  if (!draftReady) {
    return;
  }

  const draft = buildWorkspaceDraft();
  try {
    localStorage.setItem(storageKeys.draft, JSON.stringify(draft));
  } catch {
    try {
      localStorage.setItem(storageKeys.draft, JSON.stringify({ ...draft, assets: [], reference: null }));
    } catch {
      // Storage may be disabled or full; the app should keep working without persistence.
    }
  }
}

function buildWorkspaceDraft() {
  const assets = dedupeAssetRecords(state.assets)
    .filter((asset) => sanitizeImageSource(asset.image) && canPersistImageSource(asset.image))
    .slice(0, maxSavedAssets)
    .map((asset) => ({
      image: sanitizeImageSource(asset.image),
      title: asset.title || "生成作品",
      resolution: getAssetResolution(asset),
      meta: asset.meta || "",
      width: Number(asset.width) || Number(widthInput.value),
      height: Number(asset.height) || Number(heightInput.value),
      clientBatchId: asset.clientBatchId || "",
      clientItemId: asset.clientItemId || "",
      clientRequestId: asset.clientRequestId || "",
      targetWidth: Number(asset.targetWidth) || 0,
      targetHeight: Number(asset.targetHeight) || 0,
      mode: asset.mode || "",
      model: asset.model || "",
      requestedSize: asset.requestedSize || "",
      createdAt: asset.createdAt || "",
      createdAtMs: Number(asset.createdAtMs) || 0
    }));

  return {
    version: 7,
    savedAt: Date.now(),
    generatedCount: state.generatedCount,
    activeImage: canPersistImageSource(state.activeImage) ? sanitizeImageSource(state.activeImage) : "",
    reference: getPersistableReferenceDraft(),
    queue: getPersistableQueueDraft(),
    batches: getPersistableBatchDraft(),
    assets,
    active: {
      mode: state.mode,
      board: getActiveBoard(),
      ratio: getActiveRatio(),
      quality: state.quality,
      template: getActiveDatasetValue("[data-template].active", "template"),
      play: getActiveDatasetValue("[data-play].active", "play"),
      tool: getActiveDatasetValue("[data-tool].active", "tool"),
      sceneTemplate: getActiveDatasetValue("[data-scene-template].active", "sceneTemplate")
    },
    fields: {
      model: getImageModel(),
      platform: platformSelect.value,
      clarity: claritySelect.value,
      width: widthInput.value,
      height: heightInput.value,
      productName: productName.value,
      productSellingPoints: productSellingPoints.value,
      scenePose: scenePose.value,
      copyDirection: copyDirection.value,
      style: styleSelect.value,
      customStyle: customStyleInput?.value || "",
      format: $("#format").value,
      background: $("#background").value,
      creativity: $("#creativity").value,
      detail: $("#detail").value,
      batchTotal: batchTotal.value,
      prompt: promptInput.value,
      referenceUrl: referenceUrlInput.value,
      consistency: $$("[data-consistency]").map((input) => ({
        value: input.value,
        checked: input.checked
      }))
    }
  };
}

function getPersistableQueueDraft() {
  return Array.from(queueList.children)
    .slice(0, maxSavedQueueItems)
    .map((item) => ({
      jobId: item.dataset.jobId || "",
      batchId: item.dataset.batchId || "",
      batchItemId: item.dataset.batchItemId || "",
      requestId: item.dataset.requestId || "",
      title: item.dataset.title || item.querySelector("strong")?.textContent || "生成任务",
      status: item.dataset.status || item.querySelector(".queue-status")?.textContent || "请求中",
      note: item.dataset.note || "",
      mode: item.dataset.mode || "text",
      targetWidth: Number(item.dataset.targetWidth) || 0,
      targetHeight: Number(item.dataset.targetHeight) || 0,
      targetLabel: item.dataset.targetLabel || "",
      requestPrompt: item.dataset.requestPrompt || "",
      requestQuality: item.dataset.requestQuality || "",
      failed: item.classList.contains("failed"),
      done: item.classList.contains("done"),
      progress: Number(item.querySelector("progress")?.value) || 0,
      createdAt: Number(item.dataset.createdAt) || Date.now()
    }));
}

function getPersistableBatchDraft() {
  return state.batches
    .slice(0, maxSavedBatches)
    .map((batch) => ({
      id: batch.id || "",
      createdAt: Number(batch.createdAt) || Date.now(),
      prompt: String(batch.prompt || "").slice(0, 1200),
      mode: batch.mode === "image" ? "image" : "text",
      quality: String(batch.quality || ""),
      note: String(batch.note || "").slice(0, 120),
      status: String(batch.status || "等待中"),
      total: Number(batch.total) || 0,
      success: Number(batch.success) || 0,
      failed: Number(batch.failed) || 0,
      running: Number(batch.running) || 0,
      items: (batch.items || []).slice(0, 10).map((item) => ({
        id: item.id || "",
        requestId: item.requestId || "",
        label: item.label || "",
        status: item.status || "",
        state: item.state || "queued",
        image: sanitizeImageSource(item.image) || "",
        title: String(item.title || "").slice(0, 120),
        resolution: String(item.resolution || "").slice(0, 40),
        targetWidth: Number(item.targetWidth) || 0,
        targetHeight: Number(item.targetHeight) || 0,
        targetSize: String(item.targetSize || "").slice(0, 40)
      }))
    }));
}

function restoreWorkspaceDraft() {
  const raw = localStorage.getItem(storageKeys.draft);
  if (!raw) {
    return false;
  }

  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    localStorage.removeItem(storageKeys.draft);
    return false;
  }

  const fields = draft.fields || {};
  const active = draft.active || {};
  const draftVersion = Number(draft.version || 0);
  const isLegacyTrendingDraft = (active.board || "") === "trending" && Number(draft.version || 0) < 3;
  if (isLegacyTrendingDraft) {
    fields.productName = "";
    fields.productSellingPoints = "";
    fields.scenePose = "";
    fields.copyDirection = "";
    fields.prompt = "";
  }
  const isLegacyForcedDefaultSize = draftVersion < 7
    && (!active.ratio || active.ratio === "1:1")
    && (!fields.width || String(fields.width) === "1024")
    && (!fields.height || String(fields.height) === "1024");
  if (isLegacyForcedDefaultSize) {
    active.ratio = "不指定";
    fields.width = "";
    fields.height = "";
  }
  state.mode = active.mode === "image" ? "image" : "text";
  state.quality = active.quality || state.quality;
  state.generatedCount = Number(draft.generatedCount) || 0;

  activateByDataset("[data-mode]", "mode", state.mode);
  activateByDataset("[data-board]", "board", active.board || "commerce");
  updateBoardUi(active.board || "commerce");
  activateByText(".quality-row button", state.quality);
  activateByText(".ratio-grid button", active.ratio || "不指定");
  activateOptionalByDataset("[data-template]", "template", active.template);
  activateOptionalByDataset("[data-play]", "play", active.play);
  const canRestoreOptionalEnhancements = Number(draft.version) >= 5;
  activateOptionalByDataset("[data-tool]", "tool", canRestoreOptionalEnhancements ? active.tool : "");
  activateOptionalByDataset("[data-scene-template]", "sceneTemplate", canRestoreOptionalEnhancements ? active.sceneTemplate : "");

  setValue(modelSelect, fixedImageModel);
  setValue(platformSelect, fields.platform);
  setValue(claritySelect, fields.clarity);
  setValue(widthInput, fields.width);
  setValue(heightInput, fields.height);
  setValue(productName, fields.productName);
  setValue(productSellingPoints, fields.productSellingPoints);
  setValue(scenePose, fields.scenePose);
  setValue(copyDirection, fields.copyDirection);
  setValue(styleSelect, fields.style);
  setValue(customStyleInput, fields.customStyle);
  updateCustomStyleUi();
  setValue("#format", fields.format);
  setValue("#background", fields.background);
  setValue("#creativity", fields.creativity);
  setValue("#detail", fields.detail);
  setValue(batchTotal, fields.batchTotal);
  setValue(promptInput, fields.prompt);
  setValue(referenceUrlInput, fields.referenceUrl);

  $("#creativity-value").textContent = $("#creativity").value;
  $("#detail-value").textContent = $("#detail").value;

  if (canRestoreOptionalEnhancements && Array.isArray(fields.consistency)) {
    fields.consistency.forEach((saved) => {
      const input = $$("[data-consistency]").find((item) => item.value === saved.value);
      if (input) {
        input.checked = Boolean(saved.checked);
      }
    });
  } else {
    $$("[data-consistency]").forEach((input) => {
      input.checked = false;
    });
  }

  restoreReferenceDraft(draft.reference);
  restoreQueue(draft.queue || []);
  state.batches = Array.isArray(draft.batches)
    ? draft.batches.slice(0, maxSavedBatches).map(normalizeBatchDraft)
    : [];
  renderBatchHistory();
  const canRestoreSavedAssets = draftVersion >= 4;
  restoreAssets(canRestoreSavedAssets ? draft.assets || [] : [], canRestoreSavedAssets ? draft.activeImage : "");
  updateModeUi();
  updatePlatformPreset();
  renderWorkflowFeedback();
  return true;
}

function restoreQueue(queue = []) {
  queueList.replaceChildren();
  queue
    .filter((item) => item?.title)
    .slice(0, maxSavedQueueItems)
    .forEach((item) => {
      const done = Boolean(item.done);
      const failed = Boolean(item.failed);
      const status = done || failed ? item.status : "刷新前仍在处理";
      queueList.append(createQueueItem({
        ...item,
        status,
        done,
        failed,
        progress: done || failed ? 100 : Number(item.progress) || 35
      }));
    });
}

function getPersistableReferenceDraft() {
  if (!state.referenceDraft) {
    return null;
  }

  const preview = sanitizeImageSource(state.referenceDraft.preview);
  if (!preview || !canPersistImageSource(preview)) {
    return null;
  }

  return {
    kind: state.referenceDraft.kind,
    url: state.referenceDraft.url || "",
    preview,
    name: state.referenceDraft.name || "reference.png",
    type: state.referenceDraft.type || "image/png"
  };
}

function restoreReferenceDraft(reference) {
  revokeEditReferencePreviewUrl();
  state.referenceDraft = null;
  state.referenceImage = null;
  if (!reference?.preview) {
    updateReferencePreview("");
    return;
  }

  const preview = sanitizeImageSource(reference.preview);
  if (!preview) {
    updateReferencePreview("");
    return;
  }

  state.referenceDraft = {
    kind: reference.kind || "url",
    url: reference.url || preview,
    preview,
    name: reference.name || "reference.png",
    type: reference.type || "image/png"
  };
  updateReferencePreview(preview);

  if (state.referenceDraft.kind === "data") {
    restoreReferenceFileFromData(state.referenceDraft);
  } else if (state.mode === "image") {
    restoreReferenceFileFromUrl(state.referenceDraft).catch(() => {});
  }
}

function hydrateAssetTraceFromBatches(record = {}) {
  const asset = normalizeAssetRecord(record);
  if (!asset || getAssetTraceKey(asset)) {
    return asset;
  }

  for (const batch of state.batches) {
    const match = (batch.items || []).find((item) => sameAssetImage(item.image, asset.image));
    if (match) {
      return {
        ...asset,
        clientBatchId: batch.id || "",
        clientItemId: match.id || "",
        clientRequestId: match.requestId || "",
        targetWidth: Number(match.targetWidth) || Number(asset.targetWidth) || 0,
        targetHeight: Number(match.targetHeight) || Number(asset.targetHeight) || 0
      };
    }
  }
  return asset;
}

function restoreAssets(assets = [], activeImage = "") {
  const assetList = $("#asset-list");
  assetList.replaceChildren();
  if (variantStrip) {
    variantStrip.replaceChildren();
  }
  state.assets = dedupeAssetRecords(assets.map(hydrateAssetTraceFromBatches))
    .filter((asset) => sanitizeImageSource(asset.image))
    .slice(0, maxSavedAssets);

  state.assets.forEach((asset) => {
    renderAssetItem(asset, "append");
  });

  const selected = findAssetByImage(activeImage) || state.assets[0];
  if (selected) {
    selectImageFromData(selected);
  }
}

async function ensureReferenceImageReady() {
  if (state.referenceImage) {
    return true;
  }

  if (!state.referenceDraft) {
    return false;
  }

  if (state.referenceDraft.kind === "data") {
    return restoreReferenceFileFromData(state.referenceDraft);
  }

  return await restoreReferenceFileFromUrl(state.referenceDraft);
}

function restoreReferenceFileFromData(reference) {
  try {
    const file = dataUrlToFile(reference.preview, reference.name, reference.type);
    state.referenceImage = { file, name: file.name };
    return true;
  } catch {
    state.referenceImage = null;
    return false;
  }
}

async function restoreReferenceFileFromUrl(reference) {
  try {
    const response = await fetch(reference.url || reference.preview);
    if (!response.ok) {
      throw new Error(`图片请求失败：${response.status}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      throw new Error("这个 URL 返回的不是图片");
    }
    const extension = blob.type.split("/")[1] || "png";
    const name = reference.name || `reference.${extension}`;
    state.referenceImage = {
      file: new File([blob], name, { type: blob.type }),
      name
    };
    state.referenceDraft = {
      ...reference,
      type: blob.type,
      name
    };
    updateModeUi();
    return true;
  } catch {
    state.referenceImage = null;
    return false;
  }
}

function dataUrlToFile(dataUrl, name = "reference.png", fallbackType = "image/png") {
  const [meta = "", payload = ""] = String(dataUrl).split(",");
  const type = meta.match(/^data:([^;]+)/)?.[1] || fallbackType;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type });
}

function getActiveDatasetValue(selector, key) {
  return $(selector)?.dataset[key] || "";
}

function activateByDataset(selector, key, value) {
  const buttons = $$(selector);
  const target = buttons.find((button) => button.dataset[key] === value) || buttons[0] || null;
  setActive(buttons, target);
}

function activateOptionalByDataset(selector, key, value) {
  const buttons = $$(selector);
  const target = value ? buttons.find((button) => button.dataset[key] === value) : null;
  setActive(buttons, target || null);
}

function activateByText(selector, value) {
  const buttons = $$(selector);
  const target = buttons.find((button) => button.textContent.trim() === value) || buttons[0] || null;
  setActive(buttons, target);
}

function setValue(target, value) {
  const element = typeof target === "string" ? $(target) : target;
  if (element && value !== undefined && value !== null) {
    element.value = value;
  }
}

function getActiveRatio() {
  const active = $(".ratio-grid button.active");
  if (active?.dataset.sizeAuto === "true") {
    return "不指定";
  }
  if (active) {
    return active.textContent.trim();
  }
  return hasSizeOverride() ? "自定义" : "不指定";
}

function getSizeOverride() {
  const width = Math.round(Number(widthInput.value) || 0);
  const height = Math.round(Number(heightInput.value) || 0);
  return width > 0 && height > 0 ? { width, height } : null;
}

function hasSizeOverride() {
  return Boolean(getSizeOverride());
}

function getTargetResolutionLabel() {
  const size = getSizeOverride();
  return size ? formatResolution(size.width, size.height) : "接口默认";
}

function applyRatioSize(ratio = getActiveRatio()) {
  const active = $(".ratio-grid button.active");
  if (active?.dataset.sizeAuto === "true" || ratio === "不指定") {
    widthInput.value = "";
    heightInput.value = "";
    updateStatus();
    updatePreviewAspectRatio();
    return;
  }

  const preset = sizePresets[claritySelect.value]?.[ratio] || sizePresets["1k"]["1:1"];
  widthInput.value = preset[0];
  heightInput.value = preset[1];
  updateStatus();
}

function getBatchTotal() {
  return Math.max(1, Math.min(10, Number(batchTotal.value) || 1));
}

function getGenerationTargets() {
  const count = getBatchTotal();
  const size = getSizeOverride();
  const labelBase = size
    ? `${claritySelect.value.toUpperCase()} · ${getActiveRatio()}`
    : "接口默认";
  return Array.from({ length: count }, (_, index) => ({
    width: size?.width || 0,
    height: size?.height || 0,
    label: count > 1
      ? `${labelBase} · ${index + 1}/${count}`
      : labelBase
  }));
}

function updatePlatformPreset() {
  const preset = platformPresets[platformSelect.value] || platformPresets.amazon;
  $("#platform-card strong").textContent = preset.title;
  $("#platform-card span").textContent = preset.summary;
  updateStatus();
}

function applyTemplate(name) {
  const preset = templatePresets[name] || templatePresets.main;
  scenePose.value = preset.scene;
  copyDirection.value = preset.copy;
  setSelectByText($("#style"), preset.style);
  promptInput.value = composePrompt(preset.prompt);
}

function applyBoard(name, { resetPrompt = true } = {}) {
  const preset = boardPresets[name] || boardPresets.commerce;
  const defaults = workflowDefaults[name]?.[state.mode] || workflowDefaults.commerce.text;
  updateBoardUi(name);

  if (name === "trending") {
    platformSelect.value = defaults.platform || "unrestricted";
    setActive($$("[data-template]"), null);
    setActive($$("[data-play]"), null);
    setToolActive("");
    productName.value = "";
    productSellingPoints.value = "";
    scenePose.value = "";
    copyDirection.value = "";
    if (resetPrompt) {
      promptInput.value = "";
    }
    promptScore.textContent = "--";
    updatePlatformPreset();
    renderWorkflowFeedback("纯提示词模式：只使用你手写的提示词，不自动套模板。");
    return;
  }

  if (defaults.platform) {
    platformSelect.value = defaults.platform;
  }

  if (defaults.template) {
    const templateButton = $$("[data-template]").find((button) => button.dataset.template === preset.template);
    const defaultTemplateButton = $$("[data-template]").find((button) => button.dataset.template === defaults.template);
    const targetTemplate = defaultTemplateButton || templateButton;
    if (targetTemplate) {
      setActive($$("[data-template]"), targetTemplate);
      applyTemplate(targetTemplate.dataset.template);
    }
  } else {
    setActive($$("[data-template]"), null);
  }

  if (defaults.play) {
    const playButton = $$("[data-play]").find((button) => button.dataset.play === defaults.play);
    if (playButton) {
      setActive($$("[data-play]"), playButton);
      applyPlay(defaults.play);
    }
  } else {
    setActive($$("[data-play]"), null);
  }

  if (preset.style) {
    setSelectByText($("#style"), preset.style);
  }

  if (name === "commerce") {
    if (/头像|写真|贴纸|壁纸|参考图一致性|真实随拍/.test(productSellingPoints.value)) {
      productSellingPoints.value = "";
    }
  } else if (name === "personal") {
    productName.value = "";
    productSellingPoints.value = "头像、写真、贴纸、壁纸、合照、社交分享";
  } else if (name === "trending") {
    productName.value = "";
    productSellingPoints.value = state.mode === "image"
      ? "参考图一致性、真实随拍、微缩场景、漫画分镜、可分享视觉"
      : "真实随拍、微缩场景、漫画分镜、可分享视觉";
  }

  setToolActive("");
  const seed = defaults.play
    ? playPresets[defaults.play]?.prompt
    : defaults.template
      ? templatePresets[defaults.template]?.prompt
      : preset.prompt;
  if (resetPrompt) {
    promptInput.value = composePrompt(seed || preset.prompt);
  }
  updatePlatformPreset();
  renderWorkflowFeedback();
}

function applyPlay(name) {
  const preset = playPresets[name];
  if (!preset) {
    return;
  }
  setSelectByText($("#style"), preset.style);
  scenePose.value = preset.scene;
  copyDirection.value = preset.copy;
  promptInput.value = composePrompt(preset.prompt);
}

function applySceneTemplate(name) {
  scenePose.value = scenePresets[name] || scenePresets.white;
}

function composePrompt(seed = "") {
  const platform = platformPresets[platformSelect.value] || platformPresets.amazon;
  const activeTool = $("[data-tool].active")?.dataset.tool || "图片";
  const consistency = getConsistencyInstruction();
  const accuracyRule = getAccuracyRule();
  const base = seed || `生成一张${activeTool}，突出商品本体与核心卖点。`;
  const subjectLabel = getFieldLabel(productNameLabel, "主体");
  const sellingLabel = getFieldLabel(productSellingPointsLabel, "方向");
  const sceneLabel = getFieldLabel(scenePoseLabel, "场景");
  const copyLabel = getFieldLabel(copyDirectionLabel, "用途");
  const parts = [
    base,
    productName.value.trim() ? `${subjectLabel}: ${productName.value.trim()}` : "",
    productSellingPoints.value.trim() ? `${sellingLabel}: ${productSellingPoints.value.trim()}` : "",
    consistency,
    `${getFieldLabel(platformLabel, "平台")}: ${platform.title}`,
    `视觉风格: ${getStyleDirection()}`,
    hasSizeOverride() ? `目标尺寸: ${getTargetResolutionLabel()}` : "",
    scenePose.value.trim() ? `${sceneLabel}: ${scenePose.value.trim()}` : "",
    copyDirection.value.trim() ? `${copyLabel}: ${copyDirection.value.trim()}` : "",
    `平台规则: ${platform.rules}`,
    accuracyRule
  ].filter(Boolean);
  return parts.join("\n");
}

function setSelectByText(select, text) {
  const option = Array.from(select.options).find((item) => item.textContent.trim() === text);
  if (option) {
    select.value = option.value;
    if (select.id === "style") {
      updateCustomStyleUi();
    }
  }
}

async function importReferenceUrl() {
  const url = referenceUrlInput.value.trim();
  if (!url) {
    showToast("请先粘贴图片 URL", "error");
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`图片请求失败：${response.status}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      throw new Error("这个 URL 返回的不是图片");
    }
    const extension = blob.type.split("/")[1] || "png";
    state.referenceImage = {
      file: new File([blob], `reference.${extension}`, { type: blob.type }),
      name: `reference.${extension}`
    };
    revokeEditReferencePreviewUrl();
    state.referenceDraft = {
      kind: "url",
      url,
      preview: url,
      name: `reference.${extension}`,
      type: blob.type
    };
    updateReferencePreview(url);
    scheduleWorkspaceDraftSave();
    showToast("参考图已导入");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

$$("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    setActive($$("[data-mode]"), button);
    updateModeUi();
    applyBoard(getActiveBoard(), { resetPrompt: false });
    announceWorkflow(`已切换到${modePresets[state.mode].label}`);
  });
});

$$(".ratio-grid button").forEach((button) => {
  button.addEventListener("click", () => {
    setActive($$(".ratio-grid button"), button);
    applyRatioSize(button.textContent.trim());
  });
});

$$(".quality-row button").forEach((button) => {
  button.addEventListener("click", () => {
    setActive($$(".quality-row button"), button);
    state.quality = button.textContent.trim();
    updateStatus();
  });
});

["input", "change"].forEach((eventName) => {
  const handleDimensionInput = () => {
    const activeAuto = $(".ratio-grid button.active")?.dataset.sizeAuto === "true";
    if (hasSizeOverride()) {
      setActive($$(".ratio-grid button"), null);
    } else if (!activeAuto) {
      setActive($$(".ratio-grid button"), $("[data-size-auto]"));
    }
    updateStatus();
  };
  widthInput.addEventListener(eventName, handleDimensionInput);
  heightInput.addEventListener(eventName, handleDimensionInput);
});

modelSelect.value = fixedImageModel;
modelSelect.addEventListener("change", () => {
  modelSelect.value = fixedImageModel;
  updateStatus();
});
styleSelect.addEventListener("change", () => {
  updateCustomStyleUi();
  updateStatus();
  if (styleSelect.value === "custom") {
    window.setTimeout(() => customStyleInput?.focus(), 0);
  }
});
customStyleInput.addEventListener("input", updateStatus);
platformSelect.addEventListener("change", () => {
  updatePlatformPreset();
});
claritySelect.addEventListener("change", () => {
  applyRatioSize();
});
$("#compose-prompt").addEventListener("click", () => {
  if (isFreePromptBoard()) {
    showToast("纯提示词模式不会自动生成提示词");
    return;
  }
  promptInput.value = composePrompt();
  showToast("提示词已生成");
});
$("#generate").addEventListener("click", generateImage);
$("#top-generate").addEventListener("click", generateImage);
removeFailedQueue.addEventListener("click", removeFailedQueueItems);
removeDoneQueue.addEventListener("click", removeDoneQueueItems);
clearQueue.addEventListener("click", clearQueueItems);
if (retryFailedQueue) {
  retryFailedQueue.addEventListener("click", retryFailedQueueItems);
}
if (queueToggle) {
  queueToggle.addEventListener("click", () => {
    queueExpanded = !queueExpanded;
    updateStatus();
  });
}
queueList.addEventListener("click", (event) => {
  const action = event.target.closest("[data-queue-action]");
  if (!action) {
    return;
  }
  const item = action.closest(".queue-item");
  if (action.dataset.queueAction === "note") {
    editQueueItemNote(item);
  } else if (action.dataset.queueAction === "retry") {
    retryQueueItem(item);
  }
});
if (apiBaseInput) {
  apiBaseInput.addEventListener("change", checkApi);
}
apiKeyInput.addEventListener("input", () => {
  apiKeyEdited = true;
  rememberApiKey();
});
apiKeyInput.addEventListener("change", checkApi);
$("#import-reference").addEventListener("click", importReferenceUrl);

$$("[data-template]").forEach((button) => {
  button.addEventListener("click", () => {
    if (toggleOptionalActive($$("[data-template]"), button)) {
      applyTemplate(button.dataset.template);
      renderWorkflowFeedback(`已应用模板：${button.querySelector("strong")?.textContent || button.textContent.trim()}`);
      showToast(`已应用模板：${button.querySelector("strong")?.textContent || button.textContent.trim()}`);
    } else {
      renderWorkflowFeedback("已取消快捷模板");
      showToast("已取消快捷模板");
    }
  });
});

$$("[data-board]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.classList.contains("active")) {
      return;
    }
    setActive($$("[data-board]"), button);
    applyBoard(button.dataset.board);
    const board = boardPresets[button.dataset.board] || boardPresets.commerce;
    announceWorkflow(`已切换到${board.label}：${board.summary}`);
  });
});

$$("[data-play]").forEach((button) => {
  button.addEventListener("click", () => {
    if (toggleOptionalActive($$("[data-play]"), button)) {
      applyPlay(button.dataset.play);
      renderWorkflowFeedback(`已应用玩法：${button.textContent.trim()}`);
      showToast(`已应用玩法：${button.textContent.trim()}`);
    } else {
      renderWorkflowFeedback("已取消玩法灵感");
      showToast("已取消玩法灵感");
    }
  });
});

$$("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    const enabled = toggleOptionalActive($$("[data-tool]"), button);
    updateStatus();
    renderWorkflowFeedback(enabled ? `已选择功能：${button.textContent.trim()}` : "已取消功能选择");
    showToast(enabled ? `已选择功能：${button.textContent.trim()}` : "已取消功能选择");
  });
});

$$("[data-scene-template]").forEach((button) => {
  button.addEventListener("click", () => {
    if (toggleOptionalActive($$("[data-scene-template]"), button)) {
      applySceneTemplate(button.dataset.sceneTemplate);
      renderWorkflowFeedback(`已应用场景：${button.querySelector("strong")?.textContent || button.textContent.trim()}`);
      showToast(`已应用场景：${button.querySelector("strong")?.textContent || button.textContent.trim()}`);
    } else {
      renderWorkflowFeedback("已取消场景模板");
      showToast("已取消场景模板");
    }
  });
});

[
  productName,
  productSellingPoints,
  scenePose,
  copyDirection,
  styleSelect,
  customStyleInput,
  $("#format"),
  $("#background"),
  batchTotal,
  ...$$("[data-consistency]")
].forEach((control) => {
  control.addEventListener("change", () => {
    updateStatus();
  });
});

$("#copy-prompt").addEventListener("click", async () => {
  const value = promptInput.value;
  try {
    await navigator.clipboard.writeText(value);
    showToast("提示词已复制");
  } catch {
    showToast("当前浏览器不支持自动复制", "error");
  }
});

clearPromptButton.addEventListener("click", () => {
  promptInput.value = "";
  promptScore.textContent = "--";
  scheduleWorkspaceDraftSave();
  promptInput.focus();
  showToast("提示词已清空");
});

$("#reset-settings").addEventListener("click", () => {
  state.mode = "text";
  widthInput.value = "";
  heightInput.value = "";
  claritySelect.value = "1k";
  platformSelect.value = "amazon";
  productName.value = "";
  productSellingPoints.value = "";
  scenePose.value = "";
  copyDirection.value = "";
  referenceUrlInput.value = "";
  modelSelect.value = fixedImageModel;
  styleSelect.value = "干净白底";
  customStyleInput.value = "";
  updateCustomStyleUi();
  state.referenceImage = null;
  state.referenceDraft = null;
  revokeEditReferencePreviewUrl();
  referenceUpload.value = "";
  updateReferencePreview("");
  $("#creativity").value = 64;
  $("#detail").value = 78;
  batchTotal.value = "1";
  $("#creativity-value").textContent = "64";
  $("#detail-value").textContent = "78";
  resultStateLabel.textContent = "等待生成";
  state.batches = [];
  renderBatchHistory();
  state.quality = "精细";
  setActive($$("[data-mode]"), $$("[data-mode]")[0]);
  setActive($$(".quality-row button"), $$(".quality-row button")[2]);
  setActive($$(".ratio-grid button"), $("[data-size-auto]"));
  setActive($$("[data-board]"), $$("[data-board]")[0]);
  setActive($$("[data-template]"), $$("[data-template]")[0]);
  setActive($$("[data-tool]"), null);
  setActive($$("[data-scene-template]"), null);
  $$("[data-play]").forEach((button) => button.classList.remove("active"));
  $$("[data-consistency]").forEach((input) => {
    input.checked = false;
  });
  updateBoardUi("commerce");
  applyTemplate("main");
  updateModeUi();
  updatePlatformPreset();
  updateStatus();
  showToast("设置已重置");
});

["creativity", "detail"].forEach((id) => {
  const input = $(`#${id}`);
  const value = $(`#${id}-value`);
  input.addEventListener("input", () => {
    value.textContent = input.value;
  });
});

referenceUpload.addEventListener("change", () => {
  const file = referenceUpload.files[0];
  if (!file) {
    return;
  }

  state.referenceImage = {
    file,
    name: file.name || "reference.png"
  };
  revokeEditReferencePreviewUrl();

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const preview = String(reader.result || "");
    state.referenceDraft = preview.length <= maxSavedReferenceLength
      ? {
          kind: "data",
          preview,
          name: file.name || "reference.png",
          type: file.type || "image/png"
        }
      : null;
    updateReferencePreview(preview);
    scheduleWorkspaceDraftSave();
    showToast("参考图已载入");
  });
  reader.readAsDataURL(file);
});

mainPreview.addEventListener("load", () => {
  if (mainPreview.naturalWidth && mainPreview.naturalHeight) {
    captureImageResolution(state.activeImage || mainPreview.currentSrc || mainPreview.src, mainPreview);
  }
  updateEditorAvailability();
});

if (openEditorButton) {
  openEditorButton.addEventListener("click", openImageEditor);
}
if (editPreviewImage) {
  editPreviewImage.addEventListener("load", resizeEditCanvas);
}
if (editDrawCanvas) {
  editDrawCanvas.addEventListener("pointerdown", beginEditDraw);
  editDrawCanvas.addEventListener("pointermove", moveEditDraw);
  editDrawCanvas.addEventListener("pointerup", endEditDraw);
  editDrawCanvas.addEventListener("pointercancel", endEditDraw);
  editDrawCanvas.addEventListener("pointerleave", endEditDraw);
}
if (toggleBrushButton) {
  toggleBrushButton.addEventListener("click", () => {
    setEditBrushEnabled(!editBrushEnabled);
  });
}
if (clearBrushButton) {
  clearBrushButton.addEventListener("click", () => {
    clearEditMarks();
    showToast("标记已清除");
  });
}
if (useAsReferenceButton) {
  useAsReferenceButton.addEventListener("click", async () => {
    const ok = await useCurrentImageAsReference({ includeMarks: true });
    if (ok) {
      const nextPrompt = editPromptInput.value.trim();
      if (nextPrompt) {
        promptInput.value = editHasMarks
          ? `${nextPrompt}\n\n红色画笔标记的是需要重点修改的位置。最终成图不要保留红色标记、圈线或涂鸦。`
          : nextPrompt;
        scheduleWorkspaceDraftSave();
      }
      closeImageEditor();
    }
  });
}
if (generateEditButton) {
  generateEditButton.addEventListener("click", generateEditFromCurrentImage);
}
if (closeEditorButton) {
  closeEditorButton.addEventListener("click", closeImageEditor);
}
if (editModal) {
  editModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-edit-close]")) {
      closeImageEditor();
    }
  });
}
window.addEventListener("resize", () => {
  if (editModal && !editModal.hidden) {
    resizeEditCanvas();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && editModal && !editModal.hidden) {
    closeImageEditor();
  }
});

librarySearch.addEventListener("input", () => {
  const query = librarySearch.value.trim().toLowerCase();
  $$(".asset-item").forEach((item) => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(query) ? "grid" : "none";
  });
});

$("#download-current").addEventListener("click", () => {
  const asset = findAssetByImage(state.activeImage);
  if (!asset) {
    showToast("还没有可导出的图片", "error");
    return;
  }
  downloadImageAsset(asset).catch((error) => showToast(error.message, "error"));
});

blankCanvas.addEventListener("click", selectBlankCanvas);
if (previewPrev) {
  previewPrev.addEventListener("click", () => showPreviewGroupItem(-1));
}
if (previewNext) {
  previewNext.addEventListener("click", () => showPreviewGroupItem(1));
}
if (batchList) {
  batchList.addEventListener("click", async (event) => {
    const card = event.target.closest(".batch-card");
    if (!card) {
      return;
    }
    const batchId = card.dataset.batchId || "";
    const action = event.target.closest("[data-batch-action]");
    if (action) {
      if (action.dataset.batchAction === "toggle") {
        if (expandedBatchIds.has(batchId)) {
          expandedBatchIds.delete(batchId);
        } else {
          expandedBatchIds.add(batchId);
        }
        renderBatchHistory();
      } else if (action.dataset.batchAction === "note") {
        editBatchNote(batchId);
      } else if (action.dataset.batchAction === "delete") {
        deleteBatch(batchId);
      }
      return;
    }
    await setPreviewGroupFromBatch(batchId);
  });
  batchList.addEventListener("keydown", async (event) => {
    if (!["Enter", " "].includes(event.key)) {
      return;
    }
    const card = event.target.closest(".batch-card");
    if (!card || event.target.closest("[data-batch-action]")) {
      return;
    }
    event.preventDefault();
    await setPreviewGroupFromBatch(card.dataset.batchId || "");
  });
}
$("#download-all").addEventListener("click", downloadAllAssets);
selectAssetsButton.addEventListener("click", () => {
  if (!state.assets.length) {
    showToast("作品库还是空的", "error");
    return;
  }
  setLibrarySelectionMode(true);
});
finishAssetSelectButton.addEventListener("click", () => setLibrarySelectionMode(false));
deleteAssetsButton.addEventListener("click", () => {
  deleteSelectedAssets();
});
deleteAllAssetsButton.addEventListener("click", () => {
  deleteAllAssets();
});
toggleLibrary.addEventListener("click", () => {
  setLibraryCollapsed(!libraryPanel.classList.contains("is-collapsed"));
});

[
  promptInput,
  widthInput,
  heightInput,
  modelSelect,
  platformSelect,
  claritySelect,
  productName,
  productSellingPoints,
  scenePose,
  copyDirection,
  styleSelect,
  customStyleInput,
  $("#format"),
  $("#background"),
  $("#creativity"),
  $("#detail"),
  batchTotal,
  referenceUrlInput,
  ...$$("[data-consistency]")
].forEach((control) => {
  control.addEventListener("input", scheduleWorkspaceDraftSave);
  control.addEventListener("change", scheduleWorkspaceDraftSave);
});

document.addEventListener("click", scheduleWorkspaceDraftSave);
window.addEventListener("resize", () => {
  updatePreviewAspectRatio(mainResolution.textContent);
});
window.addEventListener("beforeunload", saveWorkspaceDraft);

syncPressedState($$(".segmented button, .template-grid button, .play-grid button, .chip-grid button, .quality-row button, .ratio-grid button"));
updateBoardUi("commerce");
updateModeUi();
updatePlatformPreset();
applyTemplate("main");
restoreWorkspaceDraft();
restoreLibraryCollapsed();
getImageModel();
updateCustomStyleUi();
draftReady = true;
renderWorkflowFeedback();
updateStatus();
checkApi();
clearUntrustedAutofill();
startHistorySync();
