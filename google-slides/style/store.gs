/**
 * style/store.gs — сквозной стиль презентации.
 *
 * Стиль = описание словами + картинки-референсы + модель и формат по умолчанию.
 * Он подмешивается в КАЖДУЮ генерацию: и в одиночную картинку, и в сборку презентации,
 * поэтому слайды получаются в одной визуальной логике.
 * Хранится в Script Properties, ключ GENOSAI_STYLES.
 */

var STYLE_KEY = 'GENOSAI_STYLES';

function styleList() {
  var raw = PropertiesService.getScriptProperties().getProperty(STYLE_KEY);
  if (!raw) {
    var seed = styleSeed_();
    styleWriteAll_(seed);
    return seed;
  }
  try {
    var list = JSON.parse(raw);
    return Array.isArray(list) && list.length ? list : styleSeed_();
  } catch (e) {
    return styleSeed_();
  }
}

function styleWriteAll_(list) {
  PropertiesService.getScriptProperties().setProperty(STYLE_KEY, JSON.stringify(list));
}

function styleGet_(id) {
  if (!id || id === 'none') return null;
  return styleList().filter(function (s) { return s.id === id; })[0] || null;
}

function styleSave(style) {
  if (!style || !String(style.name || '').trim()) throw new Error('У стиля должно быть название.');
  var list = styleList();
  if (!style.id) {
    style.id = 'st_' + Utilities.getUuid().slice(0, 8);
    list.push(style);
  } else {
    var replaced = false;
    list = list.map(function (s) {
      if (s.id === style.id) { replaced = true; return style; }
      return s;
    });
    if (!replaced) list.push(style);
  }
  styleWriteAll_(list);
  return list;
}

function styleDelete(id) {
  var list = styleList().filter(function (s) { return s.id !== id; });
  if (!list.length) list = styleSeed_();
  styleWriteAll_(list);
  return list;
}

function styleReset() {
  var seed = styleSeed_();
  styleWriteAll_(seed);
  return seed;
}

/** Промпт с добавленным описанием стиля. */
function styleApplyPrompt_(prompt, style) {
  if (!style || !String(style.description || '').trim()) return prompt;
  return prompt + '\n\nВизуальный стиль (соблюдать строго, одинаково на всех кадрах): ' + style.description;
}

/** URL-референсы стиля. */
function styleRefUrls_(style) {
  if (!style || !style.refs) return [];
  return style.refs.map(function (r) { return r.url; }).filter(Boolean);
}

/**
 * Заводские стили. id совпадают с ключами превью в Sidebar.html (STYLE_PREVIEWS) —
 * картинки-образцы сгенерированы ровно этими описаниями, поэтому карточка честно
 * показывает, что получится.
 */
function styleSeed_() {
  return [
    {
      id: 'st_none',
      name: 'Без стиля',
      description: '',
      model: 'chatgpt-image-2',
      placement: 'full',
      refs: []
    },
    {
      id: 'st_flat',
      name: 'Флэт-иллюстрация',
      description: 'flat vector illustration, clean geometric shapes, no photographic texture, ' +
        'limited palette of deep violet, magenta and off-white, generous negative space, ' +
        'crisp edges, no text and no logos',
      model: 'chatgpt-image-2',
      placement: 'right',
      refs: []
    },
    {
      id: 'st_photo',
      name: 'Фотореализм, мягкий свет',
      description: 'photorealistic editorial photography, soft natural window light, shallow depth of field, ' +
        'muted warm palette, calm minimal composition, no text and no logos',
      model: 'chatgpt-image-2',
      placement: 'full',
      refs: []
    },
    {
      id: 'st_clay',
      name: '3D-пластилин',
      description: 'soft 3D clay render, rounded matte shapes, pastel violet and peach palette, ' +
        'gentle studio shadows, toy-like isometric feel, no text and no logos',
      model: 'chatgpt-image-2',
      placement: 'right',
      refs: []
    },
    {
      id: 'st_line',
      name: 'Линейная схема',
      description: 'minimal line art diagram, thin monochrome strokes on a light background, ' +
        'technical blueprint feeling, lots of white space, single violet accent, no text and no logos',
      model: 'chatgpt-image-2',
      placement: 'center',
      refs: []
    }
  ];
}
