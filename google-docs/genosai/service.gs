/**
 * genosai/service.gs — слой доступа к Genosai Public API.
 * Документация: https://api.genosai.io
 *
 * Ключ в коде НЕ хранится. Каждый пользователь вводит свой ключ через
 * шестерёнку в сайдбаре; он ложится в UserProperties (виден только ему).
 * Если в Script Properties задан общий ключ команды — используется он как запасной.
 */

var GENOSAI_BASE_URL = 'https://api.genosai.io';
var GENOSAI_KEY_PROP = 'GENOSAI_API_KEY';

/** Ключ пользователя, иначе общий ключ скрипта. */
function genosaiKeyOrNull_() {
  var mine = PropertiesService.getUserProperties().getProperty(GENOSAI_KEY_PROP);
  if (mine && mine.trim()) return mine.trim();
  var shared = PropertiesService.getScriptProperties().getProperty(GENOSAI_KEY_PROP);
  if (shared && shared.trim()) return shared.trim();
  return null;
}

function genosaiKey_() {
  var key = genosaiKeyOrNull_();
  if (!key) throw new Error('Не задан API-ключ Genosai. Открой шестерёнку в сайдбаре и вставь ключ sdk_live_…');
  return key;
}

function genosaiHasKey() {
  return !!genosaiKeyOrNull_();
}

/** Сохранить свой ключ. Пустая строка — удалить. */
function genosaiSetKey(key) {
  var props = PropertiesService.getUserProperties();
  var value = String(key || '').trim();
  if (!value) {
    props.deleteProperty(GENOSAI_KEY_PROP);
    return { hasKey: genosaiHasKey(), masked: genosaiKeyMasked() };
  }
  if (value.indexOf('sdk_') !== 0) {
    throw new Error('Ключ должен начинаться с sdk_live_ или sdk_dev_.');
  }
  props.setProperty(GENOSAI_KEY_PROP, value);
  return { hasKey: true, masked: genosaiKeyMasked() };
}

/** Ключ для показа в интерфейсе: sdk_live_abcd…7f21 */
function genosaiKeyMasked() {
  var k = genosaiKeyOrNull_();
  if (!k) return '';
  return k.length > 18 ? k.slice(0, 13) + '…' + k.slice(-4) : k;
}

// ---------- низкий уровень ----------

/**
 * Запрос с повторами: сеть отваливается, сервер отдаёт 5xx, чат упирается
 * в лимит 15 запросов в минуту (429 с Retry-After). Без повторов всё это
 * прилетало пользователю ошибкой.
 */
function genosaiFetch_(url, options, attempt) {
  attempt = attempt || 1;
  var MAX = 4;
  var res;
  try {
    res = UrlFetchApp.fetch(url, options);
  } catch (e) {
    if (attempt >= MAX) throw new Error('Сеть не отвечает: ' + (e.message || e));
    Utilities.sleep(genosaiBackoff_(attempt));
    return genosaiFetch_(url, options, attempt + 1);
  }

  var code = res.getResponseCode();
  var retriable = code === 429 || (code >= 500 && code < 600);
  if (retriable && attempt < MAX) {
    var wait = genosaiBackoff_(attempt);
    if (code === 429) {
      var after = Number(res.getHeaders()['Retry-After'] || res.getHeaders()['retry-after'] || 0);
      if (after > 0) wait = Math.min(after * 1000, 30000);
    }
    Utilities.sleep(wait);
    return genosaiFetch_(url, options, attempt + 1);
  }
  return res;
}

function genosaiBackoff_(attempt) {
  return [1000, 3000, 7000][attempt - 1] || 7000;
}

function genosaiRequest_(method, path, body) {
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + genosaiKey_() },
    muteHttpExceptions: true
  };
  if (body) {
    options.contentType = 'application/json; charset=utf-8';
    options.payload = JSON.stringify(body);
  }

  var res = genosaiFetch_(GENOSAI_BASE_URL + path, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Genosai вернул не-JSON (HTTP ' + code + '): ' + text.slice(0, 200));
  }
  if (code < 200 || code >= 300) {
    // обычные ручки отдают {error, message}, /v1/chat/completions — {error:{message,type,code}}
    var msg = data.message ||
              (data.error && (data.error.message || data.error)) ||
              text.slice(0, 200);
    throw new Error('Genosai API ' + code + ': ' + msg);
  }
  return data;
}

/** Загрузка файла (multipart) → URL на CDN. */
function genosaiUpload_(blob) {
  // без имени с расширением сервер не понимает, что это картинка
  var named = genosaiNameBlob_(blob);
  var res = genosaiFetch_(GENOSAI_BASE_URL + '/v1/uploads', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + genosaiKey_() },
    payload: { file: named },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var data;
  try {
    data = JSON.parse(res.getContentText());
  } catch (e) {
    throw new Error('Загрузка референса не удалась (HTTP ' + code + ').');
  }
  if (code < 200 || code >= 300) {
    throw new Error('Загрузка референса: ' + (data.message || data.error || code));
  }
  var url = genosaiPick_(data, ['url', 'media_url', 'fileUrl', 'image_url']) ||
            genosaiPick_(data.data || {}, ['url', 'media_url', 'fileUrl', 'image_url']);
  if (!url) throw new Error('Сервер не вернул URL загруженного файла.');
  return url;
}

/** Гарантируем картиночный content-type и имя с расширением. */
function genosaiNameBlob_(blob) {
  var type = blob.getContentType() || '';
  if (type.indexOf('image/') !== 0) {
    blob.setContentType('image/png');
    type = 'image/png';
  }
  var ext = type.split('/')[1] || 'png';
  if (ext === 'jpeg') ext = 'jpg';
  var name = blob.getName();
  if (!name || name.indexOf('.') < 0) blob.setName('genosai-reference.' + ext);
  return blob;
}

function genosaiPick_(obj, keys) {
  if (!obj) return null;
  for (var i = 0; i < keys.length; i++) {
    if (obj[keys[i]]) return obj[keys[i]];
  }
  return null;
}

// ---------- команды API ----------

/** {total, main, bonus} */
function genosaiBalance() {
  return genosaiRequest_('get', '/v1/balance');
}

/** Список фото-моделей в удобном для сайдбара виде. */
function genosaiPhotoModels() {
  var data = genosaiRequest_('get', '/v1/models');
  var list = data.photo || data.models || [];
  return list.map(function (m) {
    var opts = m.input_options || {};
    var refs = m.references || null;
    return {
      id: m.id,
      name: m.name || m.id,
      cost: m.cost_credits_default,
      maxRefs: refs ? (refs.max_files || 1) : 0,
      accept: (refs && refs.accept) || 'image/*',
      aspectRatios: (opts.aspect_ratio && opts.aspect_ratio.options) || [],
      aspectDefault: (opts.aspect_ratio && opts.aspect_ratio.default) || '',
      resolutions: (opts.resolution && opts.resolution.options) || [],
      resolutionDefault: (opts.resolution && opts.resolution.default) || ''
    };
  });
}

/** Список текстовых моделей для сайдбара. */
function genosaiTextModels() {
  var data = genosaiRequest_('get', '/v1/models');
  var list = data.text || [];
  return list.map(function (m) {
    var s = m.supports || {};
    var p = m.pricing || {};
    return {
      id: m.id,
      name: m.name || m.id,
      webSearch: !!s.web_search,
      vision: !!s.vision,
      maxTokensDefault: m.max_tokens_default || 4096,
      pricePer1m: p.output_credits_per_1m || null
    };
  });
}

/**
 * Чат-запрос (OpenAI-совместимый).
 * messages: [{role, content}], opts: {max_tokens?, temperature?, web_search?}
 * → {content, credits}
 */
function genosaiChat(model, messages, opts) {
  opts = opts || {};
  var body = { model: model, messages: messages, stream: false };
  if (opts.max_tokens) body.max_tokens = opts.max_tokens;
  if (opts.temperature !== undefined && opts.temperature !== null && opts.temperature !== '') {
    body.temperature = Number(opts.temperature);
  }
  if (opts.web_search) body.web_search = true;

  var resp = genosaiRequest_('post', '/v1/chat/completions', body);
  var choice = (resp.choices || [])[0] || {};
  var content = (choice.message && choice.message.content) || '';
  if (!content) throw new Error('Модель вернула пустой ответ.');
  return { content: content, credits: (resp.usage && resp.usage.cost_credits) || 0 };
}

/**
 * Создать задачу генерации.
 * input: {prompt, aspect_ratio?, resolution?, image_urls?}
 * → taskId
 */
function genosaiCreateTask(model, input) {
  var resp = genosaiRequest_('post', '/v1/createTask', { model: model, input: input });
  var taskId = (resp.data && resp.data.taskId) || resp.taskId;
  if (!taskId) throw new Error('Genosai не вернул taskId.');
  return taskId;
}

/** → {status, url, cost} */
function genosaiTaskInfo(taskId) {
  var resp = genosaiRequest_('get', '/v1/taskInfo?taskId=' + encodeURIComponent(taskId));
  var d = resp.data || resp;
  var result = d.result || {};
  var url = result.media_url || (result.media_urls && result.media_urls[0]) || null;
  return { status: d.status, url: url, cost: d.cost, error: d.error || d.failReason || null };
}
