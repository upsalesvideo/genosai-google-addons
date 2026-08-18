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
 * Комментарий к слайду со сценарием выступления.
 *
 * Привязка — та же, что ставят сами Слайды, когда комментарий создаёт человек:
 *   {"type":"page","uid":<уникальное число>,"pages":["<id слайда>"]}
 * Без неё комментарий висит на файле, а не на слайде. Формат в документации
 * Google не описан — подсмотрен у комментария, созданного руками.
 *
 * Идём через встроенный сервис Drive: у скрипта свой облачный проект, где
 * Drive API не включён, и прямой REST отвечал «Drive API has not been used…».
 */
function deckAddComment(slideNumber, title, speak, slideId) {
  var head = slideNumber
    ? 'Слайд ' + slideNumber + (title ? ' — ' + title : '')
    : (title || 'Проверка связи');
  var text = head + '\n\n' + String(speak || '');
  var fileId = SlidesApp.getActivePresentation().getId();

  var comment = { content: text };
  if (slideId) {
    comment.anchor = JSON.stringify({
      type: 'page',
      uid: new Date().getTime(),
      pages: [slideId]
    });
  }

  try {
    Drive.Comments.create(comment, fileId, { fields: 'id' });
    return { ok: true };
  } catch (e) {
    var message = (e && e.message) || String(e);
    // запасной путь: прямой REST — вдруг встроенный сервис не подключён
    try {
      var res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '/comments?fields=id',
        {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
          payload: JSON.stringify(comment),
          muteHttpExceptions: true
        });
      var code = res.getResponseCode();
      if (code >= 200 && code < 300) return { ok: true };
      return { ok: false, error: 'Drive ' + code + ': ' + res.getContentText().slice(0, 200) };
    } catch (e2) {
      return { ok: false, error: message };
    }
  }
}

/**
 * Диагностика: пишем комментарий и СРАЗУ перечитываем список комментариев файла.
 * Так видно, где обрыв: на записи (ошибка API) или на показе (Слайды не рисуют
 * комментарии без привязки к объекту).
 */
function deckCommentSelfCheck() {
  var fileId = SlidesApp.getActivePresentation().getId();
  var report = { fileId: fileId, wrote: null, error: '', total: 0, ours: 0, samples: [] };

  var first = SlidesApp.getActivePresentation().getSlides()[0];
  var written = deckAddComment(0, 'Проверка связи',
    'Если вы это читаете — комментарии работают.', first ? first.getObjectId() : null);
  report.wrote = !!written.ok;
  report.error = written.ok ? '' : String(written.error || '');

  try {
    var list = Drive.Comments.list(fileId, { fields: 'comments(id,content,anchor,resolved)', pageSize: 50 });
    var comments = (list && list.comments) || [];
    report.total = comments.length;
    comments.forEach(function (c) {
      var anchored = c.anchor ? 'с привязкой' : 'без привязки';
      if (String(c.content || '').indexOf('Проверка связи') === 0) report.ours++;
      if (report.samples.length < 5) {
        report.samples.push(anchored + ': ' + String(c.content || '').slice(0, 40));
      }
    });
  } catch (e) {
    report.error += ' | чтение списка: ' + ((e && e.message) || e);
  }
  return report;
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
