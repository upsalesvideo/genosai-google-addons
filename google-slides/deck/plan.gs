/**
 * deck/plan.gs — сборка презентации целиком.
 * Текстовая модель раскладывает тему на слайды и пишет промпт картинки к каждому,
 * дальше сайдбар по одному создаёт слайды и генерирует иллюстрации в выбранном стиле.
 */

/**
 * params: {topic, slidesCount, model, withImages, styleId, language}
 * → {slides: [{layout, title, bullets[], image}], credits}
 */
function deckPlan(params) {
  var topic = String(params.topic || '').trim();
  if (!topic) throw new Error('Опиши, о чём презентация.');

  var count = Math.min(30, Math.max(1, Number(params.slidesCount) || 8));
  var style = styleGet_(params.styleId);
  var withImages = params.withImages !== false;

  var system =
    'Ты — методист и дизайнер презентаций. Раскладываешь тему на слайды так, ' +
    'чтобы каждый слайд нёс одну мысль, а не пересказывал всё сразу.\n' +
    'Правила текста: заголовок — до 60 знаков, по-русски; пунктов не больше четырёх, ' +
    'каждый до 90 знаков, без воды и канцелярита; не выдумывай факты и цифры, ' +
    'которых нет во вводных.\n' +
    'Раскладки: "full" — обложка или сильный визуальный слайд, текст только в заголовке; ' +
    '"split" — заголовок и пункты слева, картинка справа; "text" — только текст, без картинки.\n' +
    'Первый слайд всегда "full". Не делай больше двух "text" подряд.\n' +
    (withImages
      ? 'Поле image — промпт для генератора картинок НА АНГЛИЙСКОМ: объект, композиция, ' +
        'освещение, настроение. Без текста и логотипов на картинке. Для "text" ставь пустую строку.\n'
      : 'Поле image всегда пустая строка.\n') +
    (style && style.description
      ? 'Все картинки будут сгенерированы в одном стиле: ' + style.description +
        '. Промпты пиши так, чтобы они не спорили с этим стилем.\n'
      : '') +
    'Ответ — ТОЛЬКО JSON-массив, без пояснений и без markdown-ограждений:\n' +
    '[{"layout":"full","title":"...","bullets":["..."],"image":"..."}]';

  var user = 'Сделай план презентации из ' + count + ' слайдов.\n\nТема и вводные:\n' + topic;

  var out = genosaiChat(params.model || 'gpt-5.4', [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { max_tokens: 4000 });

  var slides = deckParseJson_(out.content);
  if (!slides.length) throw new Error('Модель вернула пустой план. Попробуй ещё раз или уточни тему.');

  return { slides: slides.slice(0, count), credits: out.credits };
}

/** Достаём JSON-массив из ответа модели. */
function deckParseJson_(text) {
  var t = String(text || '').trim();
  var start = t.indexOf('[');
  var end = t.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new Error('Не смог разобрать план от модели. Попробуй другую модель.');
  }
  var parsed;
  try {
    parsed = JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    throw new Error('План пришёл в неверном формате. Попробуй другую модель.');
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map(function (s) {
    var layout = String((s && s.layout) || 'text').toLowerCase();
    if (['full', 'split', 'text'].indexOf(layout) < 0) layout = 'text';
    return {
      layout: layout,
      title: String((s && s.title) || '').trim(),
      bullets: Array.isArray(s && s.bullets)
        ? s.bullets.map(function (b) { return String(b).trim(); }).filter(Boolean)
        : [],
      image: String((s && s.image) || '').trim()
    };
  }).filter(function (s) { return s.title || s.bullets.length || s.image; });
}
