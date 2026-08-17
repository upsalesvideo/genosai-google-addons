/**
 * jobs/store.gs — очередь задач и история генераций.
 *
 * Зачем: опрос статуса живёт в браузере. Закрыл сайдбар, перезагрузил вкладку —
 * задача в Genosai продолжается, кредиты списаны, а вставлять картинку некому.
 * Поэтому активные задачи и последние результаты храним в свойствах пользователя:
 * при следующем открытии сайдбар подхватывает незаконченное и доводит до конца.
 *
 * Всё пишется под LockService — иначе две вкладки затирают друг другу список.
 */

var JOBS_PROP = 'GENOSAI_JOBS';
var HISTORY_PROP = 'GENOSAI_HISTORY';
var HISTORY_MAX = 20;
var JOBS_MAX = 30;
var JOB_TTL_MS = 2 * 60 * 60 * 1000;   // задачи старше двух часов считаем протухшими

function jobsRead_(prop) {
  var raw = PropertiesService.getUserProperties().getProperty(prop);
  if (!raw) return [];
  try {
    var list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

/** Изменение списка под замком: read-modify-write из двух вкладок теряет данные. */
function jobsUpdate_(prop, mutator) {
  var lock = LockService.getUserLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    // не смогли взять замок — работаем без него, лучше так, чем потерять задачу
  }
  try {
    var list = jobsRead_(prop);
    var next = mutator(list) || list;
    PropertiesService.getUserProperties().setProperty(prop, JSON.stringify(next));
    return next;
  } finally {
    try { lock.releaseLock(); } catch (e) { /* замка могло и не быть */ }
  }
}

// ---------- активные задачи ----------

/** Незаконченные задачи, протухшие отсеиваем. */
function jobsList() {
  var now = new Date().getTime();
  return jobsUpdate_(JOBS_PROP, function (list) {
    return list.filter(function (j) { return now - (j.created || 0) < JOB_TTL_MS; });
  });
}

/** job: {id, taskId, prompt, cfg, dest, created} */
function jobsAdd(job) {
  return jobsUpdate_(JOBS_PROP, function (list) {
    var next = list.filter(function (j) { return j.id !== job.id; });
    next.push(job);
    return next.slice(-JOBS_MAX);
  });
}

function jobsPatch(id, fields) {
  return jobsUpdate_(JOBS_PROP, function (list) {
    return list.map(function (j) {
      if (j.id !== id) return j;
      Object.keys(fields || {}).forEach(function (k) { j[k] = fields[k]; });
      return j;
    });
  });
}

function jobsRemove(id) {
  return jobsUpdate_(JOBS_PROP, function (list) {
    return list.filter(function (j) { return j.id !== id; });
  });
}

function jobsClear() {
  PropertiesService.getUserProperties().deleteProperty(JOBS_PROP);
  return [];
}

// ---------- история ----------

/** entry: {prompt, url, model, at} */
function historyAdd(entry) {
  return jobsUpdate_(HISTORY_PROP, function (list) {
    var next = list.filter(function (h) { return h.url !== entry.url; });
    next.unshift(entry);
    return next.slice(0, HISTORY_MAX);
  });
}

function historyList() {
  return jobsRead_(HISTORY_PROP);
}

function historyClear() {
  PropertiesService.getUserProperties().deleteProperty(HISTORY_PROP);
  return [];
}
