/**
 * jobs/selftest.gs — самопроверка связки с Genosai.
 * Кнопка «Диагностика» в настройках прогоняет всю цепочку и говорит,
 * что именно отвалилось: ключ, сеть, баланс, текстовая модель, загрузка файла,
 * генерация картинки. Дешёвая проверка: около 1 кредита.
 */

function uiSelfTest() {
  var report = [];

  function step(name, fn) {
    var started = new Date().getTime();
    try {
      var info = fn();
      report.push({ name: name, ok: true, info: String(info), ms: new Date().getTime() - started });
    } catch (e) {
      report.push({ name: name, ok: false, info: (e && e.message) || String(e), ms: new Date().getTime() - started });
    }
    return report[report.length - 1].ok;
  }

  var hasKey = step('Ключ', function () {
    if (!genosaiHasKey()) throw new Error('не задан — вставь ключ выше');
    return genosaiKeyMasked();
  });
  if (!hasKey) return report;

  step('Баланс', function () {
    var b = genosaiBalance();
    return b.total + ' кр. (основной ' + b.main + ', бонус ' + b.bonus + ')';
  });

  step('Список моделей', function () {
    return genosaiPhotoModels().length + ' фото, ' + genosaiTextModels().length + ' текстовых';
  });

  step('Текстовая модель', function () {
    var out = genosaiChat('gemini-2.5-flash-lite',
      [{ role: 'user', content: 'Ответь одним словом: работает?' }], { max_tokens: 20 });
    return out.content.slice(0, 40) + ' (' + out.credits + ' кр.)';
  });

  step('Загрузка файла', function () {
    // однопиксельный PNG — проверяем, что multipart доходит и возвращает URL
    var png = Utilities.base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    var url = genosaiUpload_(Utilities.newBlob(png, 'image/png', 'selftest.png'));
    return url.slice(0, 60) + '…';
  });

  step('Генерация картинки (z-image, ~1 кр.)', function () {
    var taskId = genosaiCreateTask('z-image', {
      prompt: 'a small blue circle centered on a white background, flat, minimal',
      aspect_ratio: '1:1'
    });
    for (var i = 0; i < 40; i++) {         // до двух минут
      Utilities.sleep(3000);
      var info = genosaiTaskInfo(taskId);
      if (info.status === 'succeeded' && info.url) return 'готово за ~' + ((i + 1) * 3) + ' с';
      if (['failed', 'error', 'canceled'].indexOf(info.status) >= 0) {
        throw new Error('статус ' + info.status + (info.error ? ': ' + info.error : ''));
      }
    }
    throw new Error('не дождались за 2 минуты — задача повисла на стороне Genosai');
  });

  return report;
}
