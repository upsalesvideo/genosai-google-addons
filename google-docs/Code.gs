/**
 * Code.gs — меню документа, сайдбар и вставка картинки в Google Документ.
 * Обращение к API вынесено в файл genosai/service.gs.
 */

var SIDEBAR_TITLE = '🤖 AI Agent GenosAI';

function onOpen(e) {
  DocumentApp.getUi()
    .createMenu('🤖 AI Agent GenosAI')
    .addItem('Запустить агента', 'showGenosaiSidebar')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showGenosaiSidebar(tab) {
  var t = HtmlService.createTemplateFromFile('Sidebar');
  t.initialTab = tab || 'image';
  DocumentApp.getUi().showSidebar(t.evaluate().setTitle(SIDEBAR_TITLE));
}

function showImageSidebar() { showGenosaiSidebar('image'); }
function showTextSidebar() { showGenosaiSidebar('text'); }
function showTemplatesSidebar() { showGenosaiSidebar('tpl'); }

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

// ---------- функции, которые дёргает сайдбар через google.script.run ----------

function uiGetState() {
  if (!genosaiHasKey()) return { needsKey: true };

  var state = {
    needsKey: false,
    models: genosaiPhotoModels(),
    textModels: genosaiTextModels(),
    templates: uiTemplates(),
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

// ---------- вкладка «Текст» ----------

/**
 * params: {model, prompt, useSelection, webSearch, maxTokens}
 * → {text, credits}
 */
function uiChat(params) {
  var prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('Напиши, что нужно сделать.');

  var messages = [{
    role: 'system',
    content: 'Ты пишешь текст, который сразу вставляется в документ. ' +
             'Отвечай на языке запроса, чистым Markdown (# заголовки, - списки, **жирный**, | таблицы |). ' +
             'Без вступлений и без «вот ваш текст» — сразу содержимое.'
  }];

  if (params.useSelection) {
    var context = docSelectedText_();
    if (!context) throw new Error('В документе ничего не выделено — сними галочку «учитывать выделенный текст».');
    messages.push({ role: 'user', content: 'Текст из документа:\n"""\n' + context + '\n"""' });
  }
  messages.push({ role: 'user', content: prompt });

  var out = genosaiChat(params.model, messages, {
    max_tokens: params.maxTokens || 4096,
    web_search: !!params.webSearch
  });
  return { text: out.content, credits: out.credits };
}

/** Вставить Markdown в документ. → маркеры картинок [{token, prompt}] */
function uiInsertMarkdown(text) {
  return docInsertMarkdown(text);
}

// ---------- вкладка «Шаблоны» ----------

/** Список шаблонов + вычисленные поля ввода. */
function uiTemplates() {
  return tplList().map(function (t) {
    var copy = JSON.parse(JSON.stringify(t));
    copy.fields = tplFields(t);
    return copy;
  });
}

function uiTemplateSave(tpl) {
  tplSave(tpl);
  return uiTemplates();
}

function uiTemplateDelete(id) {
  tplDelete(id);
  return uiTemplates();
}

function uiTemplateReset() {
  tplReset();
  return uiTemplates();
}

/** Прогнать шаблон через модель. → {text, credits} */
function uiTemplateRun(id, vars) {
  return tplGenerate(id, vars);
}

/** Заменить маркер ⟦GENOSAI-IMG-N⟧ на готовую картинку. */
function uiReplaceMarker(token, url, widthPercent) {
  return docReplaceMarker(token, url, widthPercent);
}

/** Убрать маркеры, для которых картинка не получилась. */
function uiCleanupMarkers(tokens) {
  docCleanupMarkers(tokens);
  return true;
}

function uiGetBalance() {
  return genosaiBalance().total;
}

/**
 * Старт генерации.
 * params: {model, prompt, aspectRatio, resolution, useSelection, referenceUrls[]}
 * → taskId
 */
function uiStartGeneration(params) {
  var prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('Опиши, что нарисовать.');

  var input = { prompt: prompt };
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.resolution) input.resolution = params.resolution;

  // сначала то, что пользователь загрузил руками: если лимит модели маленький,
  // отрезаться должно не оно
  var refs = [];
  (params.referenceUrls || []).forEach(function (u) {
    if (u) refs.push(u);
  });
  if (params.useSelection) {
    var blob = getSelectedImageBlob_();
    if (!blob) throw new Error('В документе не выделена картинка — сними галочку «референс из документа».');
    refs.push(genosaiUpload_(blob));
  }
  if (refs.length) {
    var max = Number(params.maxRefs) || refs.length;
    input.image_urls = refs.slice(0, max);
  }

  return genosaiCreateTask(params.model, input);
}

// ---------- очередь и история ----------

/** Место вставки закрепляется в момент запуска: пока рисуется, курсор уедет. */
function uiPrepareTarget() {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var index = mdCursorIndex_(doc, body);
  // ставим абзац-якорь: он и будет местом картинки, куда бы ни ушёл курсор
  var token = '⟦GENOSAI-SPOT-' + Utilities.getUuid().slice(0, 6) + '⟧';
  var holder = body.insertParagraph(index, token);
  holder.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  return token;
}

/** Убрать якорь, если генерация не удалась. */
function uiCancelTarget(token) {
  docCleanupMarkers([token]);
  return true;
}

function uiJobSave(job) {
  job.created = new Date().getTime();
  jobsAdd(job);
  return job;
}

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

/**
 * Развернуть короткую мысль в подробный промпт на английском.
 * Идёт на дешёвой модели — доли кредита.
 */
function uiEnhancePrompt(text, model) {
  var idea = String(text || '').trim();
  if (!idea) throw new Error('Сначала напиши, что нарисовать, хотя бы парой слов.');

  var system =
    'Ты помогаешь составлять промпты для генератора изображений. ' +
    'Из короткой мысли пользователя делаешь один подробный промпт НА АНГЛИЙСКОМ: ' +
    'что в кадре, композиция, план, освещение, настроение, детали. ' +
    'Без текста и логотипов на картинке, без брендов. ' +
    'Отвечай ТОЛЬКО промптом — без кавычек и пояснений. Максимум 60 слов.';

  var out = genosaiChat(model || 'gemini-2.5-flash-lite', [
    { role: 'system', content: system },
    { role: 'user', content: idea }
  ], { max_tokens: 300 });

  return { prompt: out.content.trim().replace(/^["'`]+|["'`]+$/g, ''), credits: out.credits };
}

/**
 * Загрузить референс с компьютера. dataUrl — из FileReader.readAsDataURL().
 * → {name, url}
 */
function uiUploadReference(dataUrl, name) {
  var m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Не удалось прочитать файл.');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name || 'reference');
  return { name: name || 'reference', url: genosaiUpload_(blob) };
}

/** Статус задачи для опроса из сайдбара. */
function uiPollTask(taskId) {
  return genosaiTaskInfo(taskId);
}

/**
 * Скачать готовую картинку и вставить в документ.
 * opts: {widthPercent (0 = оригинал), caption}
 */
function uiInsertImage(url, opts) {
  opts = opts || {};

  // якорь, поставленный в момент запуска: картинка ляжет туда, откуда её запустили,
  // даже если курсор давно уехал
  if (opts.token) {
    docReplaceMarker(opts.token, url, opts.widthPercent, opts.caption);
    return 'Картинка вставлена в документ.';
  }

  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Не удалось скачать картинку (HTTP ' + res.getResponseCode() + ').');
  }
  var blob = normalizeImageBlob_(res.getBlob(), url);

  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();

  var image = null;
  var cursor = doc.getCursor();
  if (cursor) {
    try {
      image = cursor.insertInlineImage(blob);
    } catch (e) {
      image = null;
    }
  }
  if (!image) {
    image = body.appendParagraph('').appendInlineImage(blob);
  }

  fitImageToPage_(image, body, opts.widthPercent);

  if (opts.caption) {
    addCaption_(image, body, opts.caption);
  }
  return 'Картинка вставлена в документ.';
}

// ---------- вспомогательное ----------

/** Вписать картинку в ширину страницы (widthPercent: 100/75/50, 0 = не трогать). */
function fitImageToPage_(image, body, widthPercent) {
  var pct = Number(widthPercent || 0);
  if (!pct) return;

  var maxWidth;
  try {
    maxWidth = body.getPageWidth() - body.getMarginLeft() - body.getMarginRight();
  } catch (e) {
    maxWidth = 468; // A4/Letter с полями по умолчанию
  }
  var target = maxWidth * pct / 100;
  var w = image.getWidth();
  var h = image.getHeight();
  if (!w || !h) return;
  if (pct === 100 && w <= target) return; // мелкую картинку не растягиваем

  var ratio = target / w;
  image.setWidth(Math.round(w * ratio));
  image.setHeight(Math.round(h * ratio));
}

/** CDN может отдать octet-stream — тогда тип берём из расширения. */
function normalizeImageBlob_(blob, url) {
  var type = blob.getContentType() || '';
  if (type.indexOf('image/') !== 0) {
    var ext = String(url).split('?')[0].split('.').pop().toLowerCase();
    var map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    blob.setContentType(map[ext] || 'image/png');
  }
  return blob.setName('genosai.' + ((blob.getContentType() || 'image/png').split('/')[1] || 'png'));
}

/** Подпись отдельным абзацем под картинкой. Не должна ронять вставку. */
function addCaption_(image, body, text) {
  try {
    var par = image.getParent();
    var caption = body.insertParagraph(body.getChildIndex(par) + 1, text);
    caption.setFontSize(9).setItalic(true).setForegroundColor('#666666');
  } catch (e) {
    // картинка в таблице/списке — подпись не ставим, вставка уже прошла
  }
}

/**
 * Блоб выделенной в документе картинки (для image-to-image), либо null.
 *
 * Ищем в выделении, потом внутри абзацев выделения, и наконец — если выделение
 * слетело при клике в сайдбар — берём последнюю картинку документа.
 * Имя с расширением обязательно: без него загрузка уходит файлом без типа
 * и референс молча теряется.
 */
function getSelectedImageBlob_() {
  var image = findSelectedImage_();
  if (!image) return null;

  var blob = image.getBlob();
  var type = blob.getContentType() || '';
  if (type.indexOf('image/') !== 0) {
    blob.setContentType('image/png');
    type = 'image/png';
  }
  var ext = type.split('/')[1] === 'jpeg' ? 'jpg' : (type.split('/')[1] || 'png');
  return blob.setName('doc-reference.' + ext);
}

function findSelectedImage_() {
  var doc = DocumentApp.getActiveDocument();
  var sel = doc.getSelection();

  if (sel) {
    var elements = sel.getRangeElements();
    for (var i = 0; i < elements.length; i++) {
      var found = imageInsideElement_(elements[i].getElement());
      if (found) return found;
    }
  }
  // выделение могло слететь — берём последнюю картинку в теле документа
  return lastImageInBody_(doc.getBody());
}

function imageInsideElement_(el) {
  if (el.getType() === DocumentApp.ElementType.INLINE_IMAGE) return el.asInlineImage();
  if (typeof el.getNumChildren !== 'function') return null;
  for (var i = 0; i < el.getNumChildren(); i++) {
    var found = imageInsideElement_(el.getChild(i));
    if (found) return found;
  }
  return null;
}

function lastImageInBody_(container) {
  var last = null;
  for (var i = 0; i < container.getNumChildren(); i++) {
    var child = container.getChild(i);
    if (child.getType() === DocumentApp.ElementType.INLINE_IMAGE) {
      last = child.asInlineImage();
    } else if (typeof child.getNumChildren === 'function') {
      var inner = lastImageInBody_(child);
      if (inner) last = inner;
    }
  }
  return last;
}
