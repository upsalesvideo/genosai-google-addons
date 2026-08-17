/**
 * templates/store.gs — шаблоны документов (КП, посты, письма).
 *
 * Шаблон = системный промпт + промпт с подстановками {{...}} + настройки картинок.
 * Плейсхолдеры {{клиент}} автоматически превращаются в поля ввода в сайдбаре.
 * Хранится в Script Properties, ключ GENOSAI_TEMPLATES.
 */

var TPL_KEY = 'GENOSAI_TEMPLATES';

/** Инструкция про картинки, добавляется к системному промпту, если картинки включены. */
var TPL_IMAGE_RULE =
  'Иллюстрации — обязательная часть ответа. Ровно {{MAX_IMAGES}} раз(а) вставь ОТДЕЛЬНОЙ строкой маркер вида\n' +
  '[[IMG: подробное описание картинки на английском языке — объект, композиция, стиль, освещение]]\n' +
  'Первый маркер — сразу после главного заголовка. Остальные — в смысловых местах документа.\n' +
  'Описание внутри маркера всегда на английском. В самом тексте картинки словами не описывай.';

var TPL_FORMAT_RULE =
  'Формат ответа — чистый Markdown: # и ## для заголовков, - для списков, **жирный** для акцентов, ' +
  '| таблицы | для цен и сравнений. Без вступлений вроде «Конечно, вот ваш текст» — сразу документ.';

// ---------- CRUD ----------

function tplList() {
  var raw = PropertiesService.getScriptProperties().getProperty(TPL_KEY);
  if (!raw) {
    var seed = tplSeed_();
    tplWriteAll_(seed);
    return seed;
  }
  try {
    var list = JSON.parse(raw);
    return Array.isArray(list) && list.length ? list : tplSeed_();
  } catch (e) {
    return tplSeed_();
  }
}

function tplWriteAll_(list) {
  PropertiesService.getScriptProperties().setProperty(TPL_KEY, JSON.stringify(list));
}

function tplGet_(id) {
  var found = tplList().filter(function (t) { return t.id === id; })[0];
  if (!found) throw new Error('Шаблон не найден. Обнови список.');
  return found;
}

/** Создать или обновить шаблон. → полный список */
function tplSave(tpl) {
  if (!tpl || !String(tpl.name || '').trim()) throw new Error('У шаблона должно быть название.');
  var list = tplList();
  if (!tpl.id) {
    tpl.id = 'tpl_' + Utilities.getUuid().slice(0, 8);
    list.push(tpl);
  } else {
    var replaced = false;
    list = list.map(function (t) {
      if (t.id === tpl.id) { replaced = true; return tpl; }
      return t;
    });
    if (!replaced) list.push(tpl);
  }
  tplWriteAll_(list);
  return list;
}

function tplDelete(id) {
  var list = tplList().filter(function (t) { return t.id !== id; });
  if (!list.length) list = tplSeed_();
  tplWriteAll_(list);
  return list;
}

/** Сбросить шаблоны к заводским. */
function tplReset() {
  var seed = tplSeed_();
  tplWriteAll_(seed);
  return seed;
}

// ---------- запуск ----------

/** Плейсхолдеры {{...}} из обоих промптов, в порядке появления. */
function tplFields(tpl) {
  var src = String(tpl.systemPrompt || '') + '\n' + String(tpl.userPrompt || '');
  var re = /\{\{\s*([^}]+?)\s*\}\}/g;
  var seen = {};
  var out = [];
  var m;
  while ((m = re.exec(src)) !== null) {
    var key = m[1].trim();
    if (key === 'MAX_IMAGES' || seen[key]) continue;
    seen[key] = true;
    out.push(key);
  }
  return out;
}

function tplFill_(text, vars) {
  return String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (all, key) {
    var v = vars ? vars[key.trim()] : '';
    return (v === undefined || v === null) ? '' : String(v);
  });
}

/**
 * Прогнать шаблон через текстовую модель.
 * → {text, credits}
 */
function tplGenerate(id, vars) {
  var tpl = tplGet_(id);

  var system = tplFill_(tpl.systemPrompt, vars).trim();
  var user = tplFill_(tpl.userPrompt, vars).trim();
  if (!user) throw new Error('В шаблоне пустой основной промпт.');

  var rules = [TPL_FORMAT_RULE];
  if (tpl.images) {
    rules.push(TPL_IMAGE_RULE.replace('{{MAX_IMAGES}}', String(tpl.maxImages || 3)));
  }
  system = (system ? system + '\n\n' : '') + rules.join('\n\n');

  var out = genosaiChat(tpl.model || 'gpt-5.4', [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { max_tokens: tpl.maxTokens || 6000 });

  return { text: out.content, credits: out.credits };
}

// ---------- заводские шаблоны ----------

function tplSeed_() {
  return [
    {
      id: 'tpl_kp',
      name: 'Коммерческое предложение',
      model: 'gpt-5.4',
      images: true,
      maxImages: 3,
      imageModel: 'nano-banana',
      imageAspect: '16:9',
      widthPercent: 100,
      systemPrompt:
        'Ты — старший копирайтер агентства Антона Богатушина. Пишешь коммерческие предложения, ' +
        'после которых клиент отвечает «давайте работать».\n' +
        'Тон: спокойный, деловой, без канцелярита и восклицательных знаков. Пишешь по-русски, на «вы».\n' +
        'Никаких выдуманных цифр, кейсов и гарантий: используешь только то, что дано во вводных.\n' +
        'Структура: заголовок с выгодой → что мы поняли о задаче → что предлагаем → состав работ → ' +
        'сроки → цена таблицей → почему мы → следующий шаг.\n' +
        'В конце — подпись: Антон Богатушин, {{контакты}}.',
      userPrompt:
        'Сделай коммерческое предложение.\n\n' +
        'Клиент: {{клиент}}\n' +
        'Задача клиента: {{задача}}\n' +
        'Что предлагаем и по каким ценам: {{состав и цены}}\n' +
        'Сроки: {{сроки}}\n' +
        'Дополнительно учесть: {{дополнительно}}'
    },
    {
      id: 'tpl_post',
      name: 'Пост в соцсети',
      model: 'gpt-5.4-mini',
      images: true,
      maxImages: 1,
      imageModel: 'nano-banana',
      imageAspect: '4:5',
      widthPercent: 75,
      systemPrompt:
        'Ты пишешь посты для соцсетей: живой человеческий язык, короткие абзацы, ' +
        'первая строка цепляет, в конце — один призыв к действию. Без эмодзи-мусора и хайпа.',
      userPrompt:
        'Тема поста: {{тема}}\n' +
        'Аудитория: {{аудитория}}\n' +
        'Что должно остаться в голове у читателя: {{главная мысль}}'
    }
  ];
}
