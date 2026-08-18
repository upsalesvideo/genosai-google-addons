/**
 * deck/plan.gs — сборка презентации целиком.
 *
 * Подход взят у агента «Презентатор Genosai»: слайд — это ОДНА картинка 16:9,
 * внутри которой уже нарисованы заголовок, тезисы и иллюстрация в едином стиле.
 * Никакого наложения текстовых рамок поверх — chatgpt-image-2 сам рисует
 * читаемую кириллицу. «Что рассказывать» уходит в комментарий к презентации.
 */

/**
 * params: {topic, slidesCount, model, styleId}
 * → {slides: [{title, bullets[], visual, speak}], credits}
 */
function deckPlan(params) {
  var topic = String(params.topic || '').trim();
  if (!topic) throw new Error('Опиши, о чём презентация.');

  var count = Math.min(30, Math.max(1, Number(params.slidesCount) || 8));
  var style = styleGet_(params.styleId);

  var system =
    'Ты — методист презентаций. Раскладываешь тему на слайды по логической арке: ' +
    'боль → сдвиг → разбор → итог и призыв. Первый слайд — титульный, последний — вывод или призыв.\n' +
    'Каждый слайд будет нарисован ЦЕЛИКОМ как одна картинка: заголовок, тезисы и иллюстрация ' +
    'в единой композиции. Поэтому для каждого слайда дай:\n' +
    '- title: заголовок до 55 знаков, по-русски, без точки в конце;\n' +
    '- bullets: 1–3 КОРОТКИЕ фразы на слайд, каждая до 60 знаков (для титульного — один подзаголовок);\n' +
    '- visual: идея иллюстрации по-русски, 1–2 предложения: объект, композиция, настроение;\n' +
    '- speak: что говорить вслух на этом слайде, 4–6 живых предложений: с чего начать мысль, ' +
    'чем её подкрепить, какой пример или цифру привести из вводных, каким выводом закончить ' +
    'и как перейти к следующему слайду. Это живая речь докладчика, а не конспект.\n' +
    'Не выдумывай факты и цифры, которых нет во вводных. Тезисы — суть, не вода.\n' +
    (style && style.description
      ? 'Иллюстрации будут в стиле: ' + style.description + ' — идеи визуала не должны с ним спорить.\n'
      : '') +
    'Ответ — ТОЛЬКО JSON-массив без пояснений и без markdown-ограждений:\n' +
    '[{"title":"...","bullets":["..."],"visual":"...","speak":"..."}]';

  var user = 'Сделай план презентации из ' + count + ' слайдов.\n\nТема и вводные:\n' + topic;

  var out = genosaiChat(params.model || 'gpt-5.4', [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { max_tokens: 6000 });

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
    return {
      title: String((s && s.title) || '').trim(),
      bullets: Array.isArray(s && s.bullets)
        ? s.bullets.map(function (b) { return String(b).trim(); }).filter(Boolean).slice(0, 4)
        : [],
      visual: String((s && s.visual) || '').trim(),
      speak: String((s && s.speak) || '').trim()
    };
  }).filter(function (s) { return s.title || s.bullets.length; });
}
