/**
 * Code.gs — меню презентации, сайдбар и серверные функции для него.
 * Картинки и текст: genosai/service.gs. Раскладка по слайду: slides/insert.gs.
 * Стиль: style/store.gs. Сборка презентации: deck/plan.gs.
 */

var SIDEBAR_TITLE = '🤖 ИИ агент Гено-Сай';

function onOpen(e) {
  SlidesApp.getUi()
    .createMenu('🤖 Гено-Сай')
    .addItem('Картинка на слайд…', 'showImageSidebar')
    .addItem('Стиль презентации…', 'showStyleSidebar')
    .addItem('Собрать презентацию…', 'showDeckSidebar')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showGenosaiSidebar(tab) {
  var t = HtmlService.createTemplateFromFile('Sidebar');
  t.initialTab = tab || 'image';
  SlidesApp.getUi().showSidebar(t.evaluate().setTitle(SIDEBAR_TITLE));
}

function showImageSidebar() { showGenosaiSidebar('image'); }
function showStyleSidebar() { showGenosaiSidebar('style'); }
function showDeckSidebar() { showGenosaiSidebar('deck'); }

// ---------- настройки (шестерёнка) ----------

/** Есть ли ключ и как он выглядит в маске. */
function uiKeyInfo() {
  return { hasKey: genosaiHasKey(), masked: genosaiKeyMasked() };
}

/** Сохранить свой ключ Genosai. */
function uiSaveKey(key) {
  return genosaiSetKey(key);
}

/** Кнопка «Проверить кредиты» в настройках. */
function uiCheckBalance() {
  var b = genosaiBalance();
  return { total: b.total, main: b.main, bonus: b.bonus };
}

// ---------- состояние сайдбара ----------

function uiGetState() {
  if (!genosaiHasKey()) return { needsKey: true };

  var deck = slidesDeckInfo();
  var state = {
    needsKey: false,
    models: genosaiPhotoModels(),
    textModels: genosaiTextModels(),
    styles: styleList(),
    deck: { ratio: deck.ratio, width: deck.width, height: deck.height, slides: deck.slides },
    key: uiKeyInfo(),
    balance: null
  };
  try {
    state.balance = genosaiBalance().total;
  } catch (e) {
    state.balance = null;
  }
  return state;
}

function uiGetBalance() {
  return genosaiBalance().total;
}

// ---------- генерация картинки ----------

/**
 * params: {model, prompt, aspectRatio, resolution, styleId, useSelection, referenceUrls[]}
 * Стиль подмешивается здесь — одинаково для одиночной картинки и для сборки презентации.
 * → taskId
 */
function uiStartGeneration(params) {
  var prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('Опиши, что нарисовать.');

  var style = styleGet_(params.styleId);
  var input = { prompt: styleApplyPrompt_(prompt, style) };
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.resolution) input.resolution = params.resolution;

  var refs = [];
  if (params.useSelection) {
    var blob = slidesSelectedImageBlob_();
    if (!blob) throw new Error('На слайде не выделена картинка — сними галочку «выделенная картинка как референс».');
    refs.push(genosaiUpload_(blob));
  }
  styleRefUrls_(style).forEach(function (u) { refs.push(u); });
  (params.referenceUrls || []).forEach(function (u) { if (u) refs.push(u); });

  if (refs.length) {
    var max = Number(params.maxRefs) || refs.length;
    input.image_urls = refs.slice(0, max);
  }

  return genosaiCreateTask(params.model, input);
}

function uiPollTask(taskId) {
  return genosaiTaskInfo(taskId);
}

/**
 * Вставить готовую картинку на слайд.
 * opts: {slideId?, target:'current'|'new', placement, title?}
 */
function uiInsertImage(url, opts) {
  return slidesInsertImage(url, opts);
}

/** Загрузить референс с компьютера. → {name, url} */
function uiUploadReference(dataUrl, name) {
  var m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Не удалось прочитать файл.');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name || 'reference');
  return { name: name || 'reference', url: genosaiUpload_(blob) };
}

// ---------- стиль ----------

function uiStyleSave(style) { return styleSave(style); }
function uiStyleDelete(id) { return styleDelete(id); }
function uiStyleReset() { return styleReset(); }

// ---------- презентация целиком ----------

/** План презентации от текстовой модели. → {slides[], credits} */
function uiPlanDeck(params) {
  return deckPlan(params);
}

/** Создать слайд по плану. → slideId */
function uiCreateSlide(spec, position) {
  return slidesCreateSlide(spec, position);
}

/** Картинка не сгенерилась — поставить на слайд хотя бы заголовок. */
function uiSlideTitleOnly(slideId, title) {
  return slidesTitleOnly(slideId, title);
}

/** id слайдов, которые были до сборки (для режима «создать с нуля»). */
function uiSlideIds() {
  return slidesAllIds();
}

/** Убрать старые слайды после сборки новых. */
function uiRemoveSlides(ids) {
  return slidesRemove(ids);
}
