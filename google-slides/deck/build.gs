/**
 * deck/build.gs — сборка колоды: пустые слайды пачкой, комментарии со сценарием,
 * история слайдов для ручной правки.
 *
 * Почему пачкой: раньше слайд создавался, ждал свою картинку, и только потом
 * создавался следующий — колода из десяти слайдов собиралась минут пятнадцать.
 * Теперь холсты появляются сразу, промпты уходят в Genosai с шагом в секунду,
 * а каждая готовая картинка тут же садится на свой слайд.
 */

var DECK_HISTORY_PROP = 'GENOSAI_DECK_HISTORY';

/**
 * Создать сразу N пустых слайдов под будущие картинки.
 * specs: [{speak}] — речь докладчика уходит в комментарий к слайду.
 * → [{num, slideId, comment}]
 */
function deckCreateCanvases(specs) {
  var pres = SlidesApp.getActivePresentation();
  var out = [];
  (specs || []).forEach(function (spec, i) {
    var slide = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    out.push({ num: i + 1, slideId: slide.getObjectId(), comment: '' });
  });
  return out;
}

/**
 * Комментарий к презентации со сценарием слайда.
 * Комментарии живут в Drive, а не в SlidesApp, поэтому идём в Drive API
 * токеном самого скрипта. Не получилось — честно возвращаем причину,
 * и сайдбар положит текст в заметки докладчика.
 */
function deckAddComment(slideNumber, title, speak) {
  var text = 'Слайд ' + slideNumber + (title ? ' — ' + title : '') + '\n\n' + String(speak || '');
  var fileId = SlidesApp.getActivePresentation().getId();

  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '/comments?fields=id',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ content: text }),
      muteHttpExceptions: true
    });

  var code = res.getResponseCode();
  if (code >= 200 && code < 300) return { ok: true };
  return { ok: false, error: 'Drive API ' + code + ': ' + res.getContentText().slice(0, 160) };
}

/** Запасной путь: сценарий в заметки докладчика. */
function deckAddNotes(slideId, speak) {
  var slide = slidesById_(slideId);
  slidesSetNotes_(slide, String(speak || ''));
  return true;
}

/** Поставить готовую картинку на слайд, убрав предыдущую (для перерисовки). */
function deckPlaceImage(slideId, url) {
  var slide = slidesById_(slideId);
  slidesCollectImages_(slide.getPageElements()).forEach(function (img) {
    try { img.remove(); } catch (e) { /* уже нет */ }
  });
  return slidesInsertImage(url, { slideId: slideId, placement: 'full' });
}

// ---------- история слайдов ----------

/** list: [{num, slideId, title, bullets, visual, speak, prompt, url}] */
function deckHistorySave(list) {
  PropertiesService.getUserProperties()
    .setProperty(DECK_HISTORY_PROP, JSON.stringify((list || []).slice(0, 60)));
  return true;
}

function deckHistory() {
  var raw = PropertiesService.getUserProperties().getProperty(DECK_HISTORY_PROP);
  if (!raw) return [];
  try {
    var list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

/** Обновить одну запись истории после ручной перерисовки. */
function deckHistoryPatch(slideId, fields) {
  var list = deckHistory().map(function (item) {
    if (item.slideId !== slideId) return item;
    Object.keys(fields || {}).forEach(function (k) { item[k] = fields[k]; });
    return item;
  });
  deckHistorySave(list);
  return list;
}

function deckHistoryClear() {
  PropertiesService.getUserProperties().deleteProperty(DECK_HISTORY_PROP);
  return [];
}
