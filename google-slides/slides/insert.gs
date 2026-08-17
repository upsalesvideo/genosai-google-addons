/**
 * slides/insert.gs — раскладка картинок и текста по слайду.
 *
 * Раскладки (placement):
 *   full   — картинка на весь слайд (обрезается по краям), уходит на задний план
 *   right  — картинка в правой половине, текст слева
 *   left   — картинка в левой половине, текст справа
 *   center — картинка вписана по центру с полями
 */

/** Размеры презентации и подходящее соотношение сторон. */
function slidesDeckInfo() {
  var p = SlidesApp.getActivePresentation();
  var w = p.getPageWidth();
  var h = p.getPageHeight();
  return { width: w, height: h, ratio: w / h, slides: p.getSlides().length };
}

/** Текущий слайд (или последний, если выделения нет). */
function slidesCurrent_() {
  var p = SlidesApp.getActivePresentation();
  var sel = p.getSelection();
  if (sel) {
    var page = sel.getCurrentPage();
    if (page && page.getPageType() === SlidesApp.PageType.SLIDE) return page.asSlide();
  }
  var all = p.getSlides();
  return all.length ? all[all.length - 1] : p.appendSlide(SlidesApp.PredefinedLayout.BLANK);
}

function slidesById_(id) {
  var all = SlidesApp.getActivePresentation().getSlides();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getObjectId() === id) return all[i];
  }
  throw new Error('Слайд не найден — возможно, его удалили.');
}

/** Индекс текущего слайда. */
function slidesCurrentIndex_() {
  var p = SlidesApp.getActivePresentation();
  var cur = slidesCurrent_().getObjectId();
  var all = p.getSlides();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getObjectId() === cur) return i;
  }
  return all.length - 1;
}

/**
 * Новый пустой слайд после текущего.
 * layoutKind: 'blank' | 'titleBody'
 */
function slidesAppendSlide_(layoutKind, position) {
  var p = SlidesApp.getActivePresentation();
  var layout = layoutKind === 'titleBody'
    ? SlidesApp.PredefinedLayout.TITLE_AND_BODY
    : SlidesApp.PredefinedLayout.BLANK;
  if (position === 'end') return p.appendSlide(layout);
  return p.insertSlide(slidesCurrentIndex_() + 1, layout);
}

// ---------- вставка картинки ----------

/**
 * Вставить картинку по URL на слайд.
 * opts: {slideId?, target: 'current'|'new', placement, title?}
 * → {slideId}
 */
function slidesInsertImage(url, opts) {
  opts = opts || {};
  var placement = opts.placement || 'full';

  var slide;
  if (opts.slideId) {
    slide = slidesById_(opts.slideId);
  } else if (opts.target === 'new') {
    slide = slidesAppendSlide_(placement === 'full' || placement === 'center' ? 'blank' : 'titleBody');
  } else {
    slide = slidesCurrent_();
  }

  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Не удалось скачать картинку (HTTP ' + res.getResponseCode() + ').');
  }
  var blob = slidesNormalizeBlob_(res.getBlob(), url);

  var image = slide.insertImage(blob);
  var info = slidesDeckInfo();
  slidesPlace_(slide, image, placement, info.width, info.height);

  if (opts.title && placement === 'full') {
    slidesTitleBand_(slide, opts.title, info.width, info.height);
  }
  // imageId нужен, чтобы можно было убрать вставленное одной кнопкой:
  // Ctrl+Z не откатывает то, что сделал скрипт
  return { slideId: slide.getObjectId(), imageId: image.getObjectId() };
}

/** Убрать вставленную картинку (кнопка «убрать со слайда»). */
function slidesRemoveElement(slideId, elementId) {
  var slide = slidesById_(slideId);
  var elements = slide.getPageElements();
  for (var i = 0; i < elements.length; i++) {
    if (elements[i].getObjectId() === elementId) {
      elements[i].remove();
      return true;
    }
  }
  return false;
}

/** Слайд создавался под картинку, а генерация упала — убираем пустышку. */
function slidesRemoveIfEmpty(slideId) {
  var pres = SlidesApp.getActivePresentation();
  if (pres.getSlides().length <= 1) return false;

  var slide;
  try {
    slide = slidesById_(slideId);
  } catch (e) {
    return false;
  }
  var elements = slide.getPageElements();
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    if (el.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return false;
    var text = el.asShape().getText().asString().trim();
    if (text) return false;   // на слайде уже есть текст — не трогаем
  }
  slide.remove();
  return true;
}

/** Рамка выделенной картинки — чтобы перерисовать её на том же месте. */
function slidesSelectedImageBox() {
  var image = slidesSelectedImage_();
  if (!image) return null;
  var page = image.getParentPage();
  return {
    slideId: page.getObjectId(),
    elementId: image.getObjectId(),
    left: image.getLeft(),
    top: image.getTop(),
    width: image.getWidth(),
    height: image.getHeight()
  };
}

/** Заменить картинку в той же рамке: новая встаёт ровно на место старой. */
function slidesReplaceImage(box, url) {
  var slide = slidesById_(box.slideId);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Не удалось скачать картинку (HTTP ' + res.getResponseCode() + ').');
  }
  var image = slide.insertImage(slidesNormalizeBlob_(res.getBlob(), url));
  image.setLeft(box.left).setTop(box.top).setWidth(box.width).setHeight(box.height);

  slidesRemoveElement(box.slideId, box.elementId);
  return { slideId: box.slideId, imageId: image.getObjectId() };
}

/** Сколько картинок в презентации (включая те, что внутри групп). */
function slidesCountImages() {
  var total = 0;
  SlidesApp.getActivePresentation().getSlides().forEach(function (slide) {
    total += slidesCollectImages_(slide.getPageElements()).length;
  });
  return total;
}

/**
 * Убрать все картинки из презентации: текст, плашки и разметка остаются.
 * Нужно, когда готовую презентацию хочется перерисовать заново.
 */
function slidesStripImages() {
  var removed = 0;
  SlidesApp.getActivePresentation().getSlides().forEach(function (slide) {
    slidesCollectImages_(slide.getPageElements()).forEach(function (img) {
      try { img.remove(); removed++; } catch (e) { /* уже удалена вместе с группой */ }
    });
  });
  return removed;
}

function slidesCollectImages_(elements) {
  var found = [];
  elements.forEach(function (el) {
    var type = el.getPageElementType();
    if (type === SlidesApp.PageElementType.IMAGE) {
      found.push(el.asImage());
    } else if (type === SlidesApp.PageElementType.GROUP) {
      found = found.concat(slidesCollectImages_(el.asGroup().getChildren()));
    }
  });
  return found;
}

/**
 * Опись презентации для массовой дорисовки: у каждого слайда — текст и есть ли уже картинка.
 * → [{slideId, num, text, hasImage}]
 */
function slidesOverview() {
  return SlidesApp.getActivePresentation().getSlides().map(function (slide, i) {
    var elements = slide.getPageElements();
    var texts = [];
    elements.forEach(function (el) {
      if (el.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return;
      var t = el.asShape().getText().asString().trim();
      if (t) texts.push(t);
    });
    return {
      slideId: slide.getObjectId(),
      num: i + 1,
      text: texts.join('\n'),
      hasImage: slidesCollectImages_(elements).length > 0
    };
  });
}

/** Весь текст текущего слайда — исходник для промпта «нарисуй к этому слайду». */
function slidesCurrentText() {
  var slide = slidesCurrent_();
  var parts = [];
  slide.getPageElements().forEach(function (el) {
    if (el.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return;
    var text = el.asShape().getText().asString().trim();
    if (text) parts.push(text);
  });
  return parts.join('\n');
}

/** Геометрия: cover для full, contain для остальных. */
function slidesPlace_(slide, image, placement, W, H) {
  var box;
  if (placement === 'right') {
    box = { x: W * 0.52, y: H * 0.10, w: W * 0.42, h: H * 0.80, mode: 'contain' };
  } else if (placement === 'left') {
    box = { x: W * 0.06, y: H * 0.10, w: W * 0.42, h: H * 0.80, mode: 'contain' };
  } else if (placement === 'center') {
    box = { x: W * 0.10, y: H * 0.12, w: W * 0.80, h: H * 0.76, mode: 'contain' };
  } else {
    box = { x: 0, y: 0, w: W, h: H, mode: 'cover' };
  }

  var iw = image.getWidth();
  var ih = image.getHeight();
  if (!iw || !ih) return;

  var scale = box.mode === 'cover'
    ? Math.max(box.w / iw, box.h / ih)
    : Math.min(box.w / iw, box.h / ih);

  var nw = iw * scale;
  var nh = ih * scale;
  image.setWidth(nw).setHeight(nh);
  image.setLeft(box.x + (box.w - nw) / 2).setTop(box.y + (box.h - nh) / 2);

  if (box.mode === 'cover') image.sendToBack();
}

/** Плашка с заголовком поверх полноэкранной картинки. */
function slidesTitleBand_(slide, title, W, H) {
  var bandH = H * 0.22;
  var band = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, H - bandH, W, bandH);
  band.getFill().setSolidFill('#101014', 0.55);
  band.getBorder().setTransparent();

  var box = slide.insertTextBox(title, W * 0.06, H - bandH + bandH * 0.18, W * 0.88, bandH * 0.64);
  var style = box.getText().getTextStyle();
  style.setForegroundColor('#FFFFFF');
  style.setBold(true);
  style.setFontSize(Math.max(14, Math.round(H * 0.055)));
  try {
    box.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  } catch (e) { /* не критично */ }
}

// ---------- текст на слайде ----------

/**
 * Создать слайд с текстом.
 * spec: {layout: 'full'|'split'|'text', title, bullets[]}
 * → slideId
 */
function slidesCreateSlide(spec, position) {
  var layout = spec.layout || 'text';
  var info = slidesDeckInfo();

  if (layout === 'full') {
    // текст ляжет плашкой поверх картинки — слайд оставляем пустым
    var blank = slidesAppendSlide_('blank', position);
    return blank.getObjectId();
  }

  var slide = slidesAppendSlide_('titleBody', position);
  var title = slidesPlaceholder_(slide, [SlidesApp.PlaceholderType.TITLE, SlidesApp.PlaceholderType.CENTERED_TITLE]);
  var body = slidesPlaceholder_(slide, [SlidesApp.PlaceholderType.BODY]);

  if (title) {
    title.getText().setText(spec.title || '');
    if (layout === 'split') {
      title.setLeft(info.width * 0.06).setWidth(info.width * 0.42);
    }
  }
  if (body) {
    body.getText().setText((spec.bullets || []).join('\n'));
    if (layout === 'split') {
      body.setLeft(info.width * 0.06).setWidth(info.width * 0.42);
    }
  }
  if (!title && spec.title) {
    slide.insertTextBox(spec.title, info.width * 0.06, info.height * 0.10, info.width * 0.42, info.height * 0.18);
  }
  if (!body && (spec.bullets || []).length) {
    slide.insertTextBox((spec.bullets || []).join('\n'),
      info.width * 0.06, info.height * 0.32, info.width * 0.42, info.height * 0.55);
  }
  return slide.getObjectId();
}

/** Запасной вариант: картинка не получилась — оставляем на слайде хотя бы заголовок. */
function slidesTitleOnly(slideId, title) {
  var slide = slidesById_(slideId);
  var info = slidesDeckInfo();
  var box = slide.insertTextBox(String(title || ''),
    info.width * 0.08, info.height * 0.38, info.width * 0.84, info.height * 0.24);
  var style = box.getText().getTextStyle();
  style.setBold(true);
  style.setFontSize(Math.max(16, Math.round(info.height * 0.06)));
  try {
    box.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  } catch (e) { /* не критично */ }
  return true;
}

function slidesPlaceholder_(slide, types) {
  for (var i = 0; i < types.length; i++) {
    try {
      var ph = slide.getPlaceholder(types[i]);
      if (ph) return ph.asShape();
    } catch (e) { /* такого плейсхолдера нет */ }
  }
  return null;
}

/** CDN может отдать octet-stream — тип берём из расширения. */
function slidesNormalizeBlob_(blob, url) {
  var type = blob.getContentType() || '';
  if (type.indexOf('image/') !== 0) {
    var ext = String(url).split('?')[0].split('.').pop().toLowerCase();
    var map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
    blob.setContentType(map[ext] || 'image/png');
  }
  return blob.setName('genosai-slide');
}

/**
 * Картинка, выделенная на слайде, — как референс.
 *
 * Ищем в три захода: выделенные элементы → внутри групп → если пользователь
 * снял выделение (например, кликнув в сайдбар), берём верхнюю картинку текущего слайда.
 * Блобу обязательно проставляем имя с расширением: без него загрузка на сервер
 * уходит как файл без типа, и референс молча теряется.
 */
function slidesSelectedImageBlob_() {
  var image = slidesSelectedImage_();
  if (!image) return null;

  var blob = image.getBlob();
  var type = blob.getContentType() || '';
  if (type.indexOf('image/') !== 0) {
    blob.setContentType('image/png');
    type = 'image/png';
  }
  var ext = type.split('/')[1] === 'jpeg' ? 'jpg' : (type.split('/')[1] || 'png');
  return blob.setName('slide-reference.' + ext);
}

function slidesSelectedImage_() {
  var pres = SlidesApp.getActivePresentation();
  var sel = pres.getSelection();

  if (sel) {
    var range = sel.getPageElementRange();
    if (range) {
      var picked = slidesFindImage_(range.getPageElements(), false);
      if (picked) return picked;
    }
    var page = sel.getCurrentPage();
    if (page && page.getPageType() === SlidesApp.PageType.SLIDE) {
      // выделение могло слететь при клике в сайдбар — берём верхнюю картинку слайда
      var onPage = slidesFindImage_(page.asSlide().getPageElements(), true);
      if (onPage) return onPage;
    }
  }

  var slides = pres.getSlides();
  if (slides.length) {
    return slidesFindImage_(slides[slides.length - 1].getPageElements(), true);
  }
  return null;
}

/** takeLast: true — вернуть последнюю (верхнюю) картинку, false — первую найденную. */
function slidesFindImage_(elements, takeLast) {
  var hit = null;
  for (var i = 0; i < elements.length; i++) {
    var type = elements[i].getPageElementType();
    if (type === SlidesApp.PageElementType.IMAGE) {
      hit = elements[i].asImage();
      if (!takeLast) return hit;
    } else if (type === SlidesApp.PageElementType.GROUP) {
      var inner = slidesFindImage_(elements[i].asGroup().getChildren(), takeLast);
      if (inner) {
        hit = inner;
        if (!takeLast) return hit;
      }
    }
  }
  return hit;
}

/** id всех слайдов — чтобы «создать с нуля» могло убрать старые после сборки. */
function slidesAllIds() {
  return SlidesApp.getActivePresentation().getSlides().map(function (s) { return s.getObjectId(); });
}

/** Удалить слайды по id. Последний слайд презентации не трогаем — Slides не даёт остаться без слайдов. */
function slidesRemove(ids) {
  var pres = SlidesApp.getActivePresentation();
  var kill = {};
  (ids || []).forEach(function (id) { kill[id] = true; });

  var removed = 0;
  pres.getSlides().forEach(function (slide) {
    if (!kill[slide.getObjectId()]) return;
    if (pres.getSlides().length <= 1) return;
    slide.remove();
    removed++;
  });
  return removed;
}

