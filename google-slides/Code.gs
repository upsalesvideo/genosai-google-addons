/**
 * Code.gs — меню презентации, сайдбар и серверные функции для него.
 * Картинки и текст: genosai/service.gs. Раскладка по слайду: slides/insert.gs.
 * Стиль: style/store.gs. Сборка презентации: deck/plan.gs.
 */

var SIDEBAR_TITLE = '🤖 AI Agent GenosAI';

function onOpen(e) {
  SlidesApp.getUi()
    .createMenu('🤖 AI Agent GenosAI')
    .addItem('Картинка на слайд…', 'showImageSidebar')
    .addItem('Стиль презентации…', 'showStyleSidebar')
    .addItem('Собрать презентацию…', 'showDeckSidebar')
    .addSeparator()
    .addItem('Убрать все картинки из презентации…', 'menuStripImages')
    .addToUi();
}

/** Снять все картинки с презентации — чтобы перерисовать её заново. */
function menuStripImages() {
  var ui = SlidesApp.getUi();
  var count = slidesCountImages();
  if (!count) {
    ui.alert('AI Agent GenosAI', 'Картинок в презентации не нашёл.', ui.ButtonSet.OK);
    return;
  }
  var answer = ui.alert('AI Agent GenosAI',
    'Убрать все картинки? Найдено: ' + count + '.\n\nТекст, плашки и разметка останутся на местах. ' +
    'Отменить это можно только откатом версии файла (Файл → История версий).',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  var removed = slidesStripImages();
  ui.alert('AI Agent GenosAI', 'Убрано картинок: ' + removed + '.', ui.ButtonSet.OK);
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
    jobs: jobsList(),          // незаконченные задачи — сайдбар их подхватит
    history: historyList(),
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

  // порядок важен: если у модели маленький лимит референсов, отрезаться должны
  // эталоны стиля, а не то, что пользователь только что загрузил руками
  var refs = [];
  (params.referenceUrls || []).forEach(function (u) { if (u) refs.push(u); });
  if (params.useSelection) {
    var blob = slidesSelectedImageBlob_();
    if (!blob) throw new Error('На слайде не выделена картинка — сними галочку «выделенная картинка как референс».');
    refs.push(genosaiUpload_(blob));
  }
  styleRefUrls_(style).forEach(function (u) { refs.push(u); });

  if (refs.length) {
    var max = Number(params.maxRefs) || refs.length;
    input.image_urls = refs.slice(0, max);
  }

  return genosaiCreateTask(params.model, input);
}

// ---------- очередь и история ----------

/** Запомнить задачу, чтобы её можно было доделать после закрытия сайдбара. */
function uiJobSave(job) {
  job.created = new Date().getTime();
  jobsAdd(job);
  return job;
}

/** Задача доведена до конца: убрать из очереди, записать в историю. */
function uiJobDone(id, entry) {
  jobsRemove(id);
  if (entry && entry.url) {
    entry.at = new Date().getTime();
    historyAdd(entry);
  }
  return true;
}

function uiJobDrop(id) {
  jobsRemove(id);
  return true;
}

function uiHistory() {
  return historyList();
}

function uiHistoryClear() {
  return historyClear();
}

/** Убрать вставленную картинку со слайда. */
function uiRemoveElement(slideId, elementId) {
  return slidesRemoveElement(slideId, elementId);
}

/** Генерация упала — убрать созданный под неё пустой слайд. */
function uiCancelTarget(slideId) {
  return slidesRemoveIfEmpty(slideId);
}

// ---------- помощь с промптом ----------

/**
 * Развернуть короткую мысль в подробный промпт на английском под выбранный стиль.
 * Идёт на дешёвой модели — доли кредита.
 */
function uiEnhancePrompt(text, styleId, model) {
  var idea = String(text || '').trim();
  if (!idea) throw new Error('Сначала напиши, что нарисовать, хотя бы парой слов.');

  var style = styleGet_(styleId);
  var system =
    'Ты помогаешь составлять промпты для генератора изображений. ' +
    'Из короткой мысли пользователя делаешь один подробный промпт НА АНГЛИЙСКОМ: ' +
    'что в кадре, композиция, план, освещение, настроение, детали. ' +
    'Без текста и логотипов на картинке, без людей-знаменитостей, без брендов. ' +
    'Отвечай ТОЛЬКО промптом — без кавычек, пояснений и вступлений. Максимум 60 слов.' +
    (style && style.description
      ? '\nПромпт должен ложиться в этот визуальный стиль: ' + style.description
      : '');

  var out = genosaiChat(model || 'gemini-2.5-flash-lite', [
    { role: 'system', content: system },
    { role: 'user', content: idea }
  ], { max_tokens: 300 });

  return { prompt: out.content.trim().replace(/^["'`]+|["'`]+$/g, ''), credits: out.credits };
}

/** Текст текущего слайда — основа для промпта «нарисуй к этому слайду». */
function uiSlideText() {
  return slidesCurrentText();
}

/** Опись слайдов: текст и есть ли картинка — для массовой дорисовки. */
function uiSlidesOverview() {
  return slidesOverview();
}

// ---------- перерисовать выделенную картинку ----------

/** Рамка выделенной картинки или null. */
function uiSelectedImageBox() {
  return slidesSelectedImageBox();
}

/** Поставить новую картинку в ту же рамку вместо старой. */
function uiReplaceImage(box, url) {
  return slidesReplaceImage(box, url);
}

function uiPollTask(taskId) {
  return genosaiTaskInfo(taskId);
}

/**
 * Закрепить слайд ДО генерации: пока картинка рисуется, можно уйти на другой слайд
 * или запустить ещё одну — каждая ляжет туда, откуда её запустили.
 * opts: {target: 'current'|'new', placement}
 * → slideId
 */
function uiPrepareTarget(opts) {
  opts = opts || {};
  if (opts.target === 'new') {
    var kind = (opts.placement === 'full' || opts.placement === 'center') ? 'blank' : 'titleBody';
    return slidesAppendSlide_(kind).getObjectId();
  }
  return slidesCurrent_().getObjectId();
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

// ---------- вкладка «Чат» ----------

/**
 * Ход разговора: модель сама вызывает инструменты и правит презентацию.
 * history: [{role:'user'|'assistant', content}] — предыдущие реплики.
 * → {reply, actions[], credits}
 */
function uiChatAgent(model, history) {
  return chatAgent(model, history);
}

/** Заметки докладчика текущего слайда — способ надиктовать команду голосом Google. */
function uiSlideNotes() {
  return slidesCurrentNotes();
}

/** id слайдов, которые были до сборки (для режима «создать с нуля»). */
function uiSlideIds() {
  return slidesAllIds();
}

/** Убрать старые слайды после сборки новых. */
function uiRemoveSlides(ids) {
  return slidesRemove(ids);
}
