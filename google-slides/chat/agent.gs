/**
 * chat/agent.gs — вкладка «Чат»: команды к презентации обычными словами.
 *
 * Модель получает список инструментов и сама решает, какие вызвать:
 * «на каждый слайд в правый верхний угол поставь адрес сайта» →
 * list_slides → add_text_box(slides='all', corner='top-right').
 * Инструменты только про текст и разметку: картинки живут на своих вкладках,
 * чтобы разговор не упирался в шестиминутный лимит выполнения.
 */

var CHAT_MAX_STEPS = 6;

function chatTools_() {
  return [
    {
      type: 'function',
      function: {
        name: 'list_slides',
        description: 'Список слайдов: номер, текст, есть ли картинка. Вызывай первым, если нужно понять ' +
                     'структуру презентации или найти слайд по смыслу.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_title',
        description: 'Заменить заголовок слайда.',
        parameters: {
          type: 'object',
          properties: {
            slide: { type: 'integer', description: 'Номер слайда, начиная с 1' },
            text: { type: 'string', description: 'Новый заголовок' }
          },
          required: ['slide', 'text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_body',
        description: 'Заменить основной текст слайда. Пункты списка разделяй переводом строки.',
        parameters: {
          type: 'object',
          properties: {
            slide: { type: 'integer' },
            text: { type: 'string' }
          },
          required: ['slide', 'text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_text_box',
        description: 'Поставить надпись в угол или центр слайда: адрес сайта, телефон, подпись автора. ' +
                     'Можно сразу на все слайды.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            slides: { type: 'string', description: '"all" для всех слайдов либо номера через запятую: "1,4,7"' },
            corner: {
              type: 'string',
              enum: ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center'],
              description: 'Куда поставить надпись'
            },
            fontSize: { type: 'integer', description: 'Размер шрифта, по умолчанию 10' },
            color: { type: 'string', description: 'Цвет в формате #RRGGBB, по умолчанию серый' }
          },
          required: ['text', 'slides', 'corner']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_slide',
        description: 'Добавить новый слайд с заголовком и пунктами в конец презентации.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } }
          },
          required: ['title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'remove_text_boxes',
        description: 'Убрать надписи с указанным текстом со всех слайдов. Нужно, если надпись поставили неудачно.',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Текст надписи, которую надо убрать' } },
          required: ['text']
        }
      }
    }
  ];
}

/** Выполнение инструмента. Возвращает строку — её увидит модель. */
function chatRunTool_(name, args) {
  args = args || {};

  if (name === 'list_slides') {
    return JSON.stringify(slidesOverview().map(function (s) {
      return { slide: s.num, text: s.text.slice(0, 300), hasImage: s.hasImage };
    }));
  }
  if (name === 'set_title') {
    return slidesSetPlaceholder(args.slide, 'title', String(args.text || ''));
  }
  if (name === 'set_body') {
    return slidesSetPlaceholder(args.slide, 'body', String(args.text || ''));
  }
  if (name === 'add_text_box') {
    return slidesAddCornerText(args.text, args.slides, args.corner, args.fontSize, args.color);
  }
  if (name === 'add_slide') {
    slidesCreateSlide({ layout: 'text', title: String(args.title || ''), bullets: args.bullets || [] }, 'end');
    return 'Слайд добавлен в конец.';
  }
  if (name === 'remove_text_boxes') {
    return 'Убрано надписей: ' + slidesRemoveTextBoxes(String(args.text || ''));
  }
  return 'Неизвестный инструмент: ' + name;
}

/**
 * Один ход чата: гоняем модель по кругу, пока она вызывает инструменты.
 * history: [{role, content}] — предыдущая переписка.
 * → {reply, actions[], credits}
 */
function chatAgent(model, history) {
  var deck = slidesDeckInfo();
  var messages = [{
    role: 'system',
    content:
      'Ты — ассистент внутри Google Презентаций. У тебя есть инструменты, которыми ты меняешь саму ' +
      'презентацию: читаешь список слайдов, правишь заголовки и текст, ставишь надписи в углы, ' +
      'добавляешь слайды. Пользователь говорит обычными словами, часто надиктовывает голосом — ' +
      'понимай смысл, а не буквальную формулировку.\n' +
      'Сейчас в презентации ' + deck.slides + ' слайд(ов), кадр ' +
      Math.round(deck.width) + ' на ' + Math.round(deck.height) + ' пунктов.\n' +
      'Правила: если команда касается конкретных слайдов или «всех слайдов» — сперва вызови list_slides. ' +
      'Нумерация у пользователя начинается с единицы. Не выдумывай адреса, телефоны и факты: ' +
      'если данных не хватает, задай один короткий вопрос вместо вызова инструмента. ' +
      'Картинки ты не рисуешь — для них есть вкладки «Картинка» и «Презентация», так и скажи. ' +
      'В конце ответь по-русски одной-двумя фразами: что именно сделал.'
  }];

  (history || []).forEach(function (m) {
    if (m && m.role && m.content) messages.push({ role: m.role, content: String(m.content) });
  });

  var actions = [];
  var credits = 0;
  var tools = chatTools_();

  for (var step = 0; step < CHAT_MAX_STEPS; step++) {
    var resp = genosaiRequest_('post', '/v1/chat/completions', {
      model: model || 'gpt-5.4',
      messages: messages,
      tools: tools,
      stream: false,
      max_tokens: 1200
    });
    credits += (resp.usage && resp.usage.cost_credits) || 0;

    var msg = ((resp.choices || [])[0] || {}).message || {};
    var calls = msg.tool_calls || [];

    if (!calls.length) {
      return { reply: msg.content || 'Готово.', actions: actions, credits: credits };
    }

    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });

    for (var i = 0; i < calls.length; i++) {
      var call = calls[i];
      var fn = call.function || {};
      var args = {};
      try {
        args = fn.arguments ? JSON.parse(fn.arguments) : {};
      } catch (e) {
        args = {};
      }
      var result;
      try {
        result = chatRunTool_(fn.name, args);
      } catch (err) {
        result = 'Ошибка: ' + ((err && err.message) || err);
      }
      if (fn.name !== 'list_slides') actions.push(result);
      messages.push({ role: 'tool', tool_call_id: call.id, content: String(result) });
    }
  }

  return {
    reply: 'Слишком много шагов подряд — остановился. Посмотри, что получилось, и уточни команду.',
    actions: actions,
    credits: credits
  };
}
