/**
 * chat/actions.gs — то, что чат реально делает со слайдами.
 * Каждая функция возвращает человеческую строку: её видит и модель, и пользователь в списке действий.
 */

var CHAT_TAG = '​';   // невидимая метка: по ней находим свои надписи, чтобы уметь их убирать

/** Заголовок или основной текст слайда. kind: 'title' | 'body' */
function slidesSetPlaceholder(slideNumber, kind, text) {
  var slides = SlidesApp.getActivePresentation().getSlides();
  var idx = Number(slideNumber) - 1;
  if (!(idx >= 0 && idx < slides.length)) {
    return 'Слайда номер ' + slideNumber + ' нет: всего слайдов ' + slides.length + '.';
  }
  var slide = slides[idx];
  var types = kind === 'title'
    ? [SlidesApp.PlaceholderType.TITLE, SlidesApp.PlaceholderType.CENTERED_TITLE]
    : [SlidesApp.PlaceholderType.BODY, SlidesApp.PlaceholderType.SUBTITLE];

  var shape = slidesPlaceholder_(slide, types);
  if (shape) {
    shape.getText().setText(text);
    return (kind === 'title' ? 'Заголовок' : 'Текст') + ' слайда ' + slideNumber + ' заменён.';
  }

  // плейсхолдера нет (пустой макет) — ставим обычную надпись на его типичное место
  var info = slidesDeckInfo();
  var box = kind === 'title'
    ? slide.insertTextBox(text, info.width * 0.07, info.height * 0.10, info.width * 0.86, info.height * 0.18)
    : slide.insertTextBox(text, info.width * 0.07, info.height * 0.34, info.width * 0.86, info.height * 0.50);
  box.getText().getTextStyle().setFontSize(kind === 'title' ? Math.round(info.height * 0.06) : 14);
  if (kind === 'title') box.getText().getTextStyle().setBold(true);
  return (kind === 'title' ? 'Заголовок' : 'Текст') + ' слайда ' + slideNumber +
         ' добавлен надписью — в макете не было подходящего поля.';
}

/**
 * Надпись в угол: адрес сайта, телефон, подпись.
 * which: 'all' либо '1,4,7'. corner: top-right | top-left | bottom-right | bottom-left | center
 */
function slidesAddCornerText(text, which, corner, fontSize, color) {
  var body = String(text || '').trim();
  if (!body) return 'Пустой текст — ставить нечего.';

  var pres = SlidesApp.getActivePresentation();
  var all = pres.getSlides();
  var info = slidesDeckInfo();
  var targets = slidesPickSlides_(all, which);
  if (!targets.length) return 'Не понял, на какие слайды ставить.';

  var size = Number(fontSize) || 10;
  var w = info.width * 0.34;
  var h = size * 2.2;
  var m = info.width * 0.025;

  var pos = {
    'top-right':    { x: info.width - w - m, y: m },
    'top-left':     { x: m, y: m },
    'bottom-right': { x: info.width - w - m, y: info.height - h - m },
    'bottom-left':  { x: m, y: info.height - h - m },
    'center':       { x: (info.width - w) / 2, y: (info.height - h) / 2 }
  }[corner] || { x: info.width - w - m, y: m };

  var align = corner === 'top-left' || corner === 'bottom-left'
    ? SlidesApp.ParagraphAlignment.START
    : (corner === 'center' ? SlidesApp.ParagraphAlignment.CENTER : SlidesApp.ParagraphAlignment.END);

  targets.forEach(function (slide) {
    var box = slide.insertTextBox(body + CHAT_TAG, pos.x, pos.y, w, h);
    var style = box.getText().getTextStyle();
    style.setFontSize(size);
    style.setForegroundColor(color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#7a7a8c');
    try {
      box.getText().getParagraphs().forEach(function (p) {
        p.getRange().getParagraphStyle().setParagraphAlignment(align);
      });
    } catch (e) { /* выравнивание не критично */ }
  });

  return 'Надпись «' + body + '» поставлена на ' + targets.length + ' слайд(ов), угол: ' + (corner || 'top-right') + '.';
}

/** Убрать надписи, поставленные чатом, по их тексту. */
function slidesRemoveTextBoxes(text) {
  var needle = String(text || '').trim();
  if (!needle) return 0;
  var removed = 0;
  SlidesApp.getActivePresentation().getSlides().forEach(function (slide) {
    slide.getPageElements().forEach(function (el) {
      if (el.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return;
      var value = el.asShape().getText().asString().replace(CHAT_TAG, '').trim();
      if (value === needle) {
        try { el.remove(); removed++; } catch (e) { /* уже удалена */ }
      }
    });
  });
  return removed;
}

/** 'all' | '1,4,7' → массив слайдов */
function slidesPickSlides_(all, which) {
  var value = String(which || 'all').trim().toLowerCase();
  if (!value || value === 'all' || value === 'все' || value === '*') return all;
  var out = [];
  value.split(',').forEach(function (part) {
    var n = parseInt(String(part).trim(), 10);
    if (n >= 1 && n <= all.length) out.push(all[n - 1]);
  });
  return out;
}

/** Заметки докладчика текущего слайда — сюда удобно надиктовывать голосом самим Google. */
function slidesCurrentNotes() {
  try {
    var shape = slidesCurrent_().getNotesPage().getSpeakerNotesShape();
    return shape ? shape.getText().asString().trim() : '';
  } catch (e) {
    return '';
  }
}
