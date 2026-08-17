/**
 * doc/markdown.gs — вставка Markdown-ответа модели в Google Документ
 * (заголовки, списки, таблицы, жирный текст) + маркеры под картинки.
 *
 * Маркер картинки в тексте модели: [[IMG: описание картинки]]
 * Он превращается в абзац-заглушку ⟦GENOSAI-IMG-N⟧, который потом
 * заменяется на сгенерированную картинку функцией docReplaceMarker().
 */

var MD_TOKEN_OPEN = '\u27E6GENOSAI-IMG-';
var MD_TOKEN_CLOSE = '\u27E7';

/**
 * Вставить Markdown в документ (в место курсора или в конец).
 * opts: {}
 * → [{token, prompt}] — маркеры картинок в порядке появления
 */
function docInsertMarkdown(markdown, opts) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var index = mdCursorIndex_(doc, body);
  return mdRender_(body, index, markdown);
}

/** Заменить абзац-маркер на картинку по URL. caption — необязательная подпись. */
function docReplaceMarker(token, url, widthPercent, caption) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var found = body.findText(token);
  if (!found) throw new Error('Не нашёл место для картинки (' + token + ').');

  var par = found.getElement().getParent();
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Не удалось скачать картинку (HTTP ' + res.getResponseCode() + ').');
  }
  var blob = normalizeImageBlob_(res.getBlob(), url);

  var paragraph = par.asParagraph();
  paragraph.clear();
  var image = paragraph.appendInlineImage(blob);
  fitImageToPage_(image, body, widthPercent);
  if (caption) addCaption_(image, body, caption);
  return true;
}

/** Убрать оставшиеся маркеры (если картинка не сгенерилась). */
function docCleanupMarkers(tokens) {
  var body = DocumentApp.getActiveDocument().getBody();
  (tokens || []).forEach(function (token) {
    var found = body.findText(token);
    if (!found) return;
    try {
      var par = found.getElement().getParent();
      par.asParagraph().removeFromParent();
    } catch (e) {
      found.getElement().asText().setText('');
    }
  });
}

// ---------- внутреннее ----------

/** Индекс в body, куда вставлять: после абзаца с курсором либо в конец. */
function mdCursorIndex_(doc, body) {
  var cursor = doc.getCursor();
  if (!cursor) return body.getNumChildren();
  var el = cursor.getElement();
  while (el && el.getParent() && el.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) {
    el = el.getParent();
  }
  try {
    return body.getChildIndex(el) + 1;
  } catch (e) {
    return body.getNumChildren();
  }
}

var MD_HEADINGS = [
  DocumentApp.ParagraphHeading.HEADING1,
  DocumentApp.ParagraphHeading.HEADING2,
  DocumentApp.ParagraphHeading.HEADING3,
  DocumentApp.ParagraphHeading.HEADING4
];

function mdRender_(body, index, markdown) {
  var source = String(markdown || '')
    .replace(/\r\n/g, '\n')
    // маркер картинки всегда должен стоять отдельной строкой
    .replace(/(\[\[\s*IMG\s*:[^\]]*\]\])/gi, '\n$1\n');
  var lines = source.split('\n');
  var markers = [];
  var imgCount = 0;
  var prevList = null;      // предыдущий ListItem — чтобы нумерация не сбрасывалась
  var prevListGlyph = null;
  var i = 0;

  while (i < lines.length) {
    var line = String(lines[i]);
    var t = line.trim();

    if (!t) { i++; prevList = null; continue; }

    // ---- обёртка ```markdown … ``` — пропускаем сами ограждения ----
    if (t.indexOf('```') === 0) { i++; continue; }

    // ---- маркер картинки ----
    var img = t.match(/^\[\[\s*IMG\s*:\s*([\s\S]+?)\s*\]\]$/i);
    if (img) {
      imgCount++;
      var token = MD_TOKEN_OPEN + imgCount + MD_TOKEN_CLOSE;
      var holder = body.insertParagraph(index++, token);
      holder.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      markers.push({ token: token, prompt: img[1].trim() });
      prevList = null;
      i++;
      continue;
    }

    // ---- таблица ----
    if (t.charAt(0) === '|' && i + 1 < lines.length && /^\|[\s:\-|]+\|$/.test(lines[i + 1].trim())) {
      var rows = [mdRow_(t)];
      i += 2;
      while (i < lines.length && lines[i].trim().charAt(0) === '|') {
        rows.push(mdRow_(lines[i].trim()));
        i++;
      }
      mdInsertTable_(body, index++, rows);
      prevList = null;
      continue;
    }

    // ---- горизонтальная линия ----
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(t)) {
      body.insertHorizontalRule(index++);
      prevList = null;
      i++;
      continue;
    }

    // ---- заголовок ----
    var h = t.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      var hp = body.insertParagraph(index++, '');
      mdText_(hp.editAsText(), h[2]);
      hp.setHeading(MD_HEADINGS[h[1].length - 1]);
      prevList = null;
      i++;
      continue;
    }

    // ---- списки ----
    var bullet = t.match(/^[-*\u2022]\s+(.+)$/);
    var numbered = t.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      var glyph = bullet ? DocumentApp.GlyphType.BULLET : DocumentApp.GlyphType.NUMBER;
      var indent = line.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
      var li = body.insertListItem(index++, '');
      mdText_(li.editAsText(), (bullet || numbered)[1]);
      li.setGlyphType(glyph);
      if (indent >= 2) {
        try { li.setNestingLevel(Math.min(3, Math.floor(indent / 2))); } catch (e) { /* не критично */ }
      }
      if (prevList && prevListGlyph === glyph) {
        try { li.setListId(prevList); } catch (e) { /* не критично */ }
      }
      prevList = li;
      prevListGlyph = glyph;
      i++;
      continue;
    }

    // ---- обычный абзац ----
    var p = body.insertParagraph(index++, '');
    mdText_(p.editAsText(), t);
    prevList = null;
    i++;
  }

  return markers;
}

function mdRow_(line) {
  var cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.map(function (c) { return mdPlain_(c.trim()) || ' '; });
}

function mdInsertTable_(body, index, rows) {
  var table = body.insertTable(index, rows);
  try {
    var head = table.getRow(0);
    for (var c = 0; c < head.getNumCells(); c++) {
      head.getCell(c).editAsText().setBold(true);
    }
    table.setBorderColor('#d9d9e3');
  } catch (e) { /* оформление не критично */ }
  return table;
}

/** Markdown без разметки — для ячеек таблицы. */
function mdPlain_(md) {
  return String(md)
    .replace(/`/g, '')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

/** Текст в абзац с поддержкой **жирного**. */
function mdText_(textEl, md) {
  var src = String(md)
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1 ($2)');

  var plain = '';
  var bolds = [];
  var re = /\*\*([\s\S]+?)\*\*/g;
  var last = 0;
  var m;
  while ((m = re.exec(src)) !== null) {
    plain += src.slice(last, m.index);
    var start = plain.length;
    plain += m[1];
    bolds.push([start, plain.length - 1]);
    last = m.index + m[0].length;
  }
  plain += src.slice(last);

  textEl.setText(plain);
  bolds.forEach(function (b) {
    if (b[1] >= b[0]) {
      try { textEl.setBold(b[0], b[1], true); } catch (e) { /* игнор */ }
    }
  });
}

/** Выделенный в документе текст — как контекст для модели. */
function docSelectedText_() {
  var sel = DocumentApp.getActiveDocument().getSelection();
  if (!sel) return '';
  var parts = [];
  sel.getRangeElements().forEach(function (re) {
    var el = re.getElement();
    if (!el.editAsText) return;
    var text = el.asText().getText();
    if (re.isPartial()) {
      text = text.substring(re.getStartOffset(), re.getEndOffsetInclusive() + 1);
    }
    if (text.trim()) parts.push(text);
  });
  return parts.join('\n');
}
