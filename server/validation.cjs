class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new HttpError(400, 'Проверьте поле «' + name + '»');
  return value.trim();
}
function positive(value, name = 'Идентификатор') {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)
    throw new HttpError(400, 'Некорректное поле «' + name + '»');
  return value;
}
function temperature(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)
    throw new HttpError(400, 'Температура должна быть числом с точностью до двух знаков');
  return value;
}
function normalize(kind, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Некорректные данные');
  if (kind === 'mixtures') {
    if (typeof body.archived !== 'boolean') throw new HttpError(400, 'Некорректное состояние смеси');
    return { name: text(body.name, 'Название смеси', 100), archived: body.archived };
  }
  if (kind === 'users') {
    const login = text(body.login, 'Логин', 64);
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(login)) throw new HttpError(400, 'Логин: 3–64 латинских символа, цифры, точка, дефис или подчёркивание');
    if (!['ADMIN', 'KEYUSER', 'QUALITY', 'EMPLOYER'].includes(body.role)) throw new HttpError(400, 'Некорректная роль');
    return { name: text(body.name, 'Имя', 120), login, role: body.role };
  }
  if (kind === 'records') {
    const date = text(body.date, 'Дата', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1753-01-01' || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)
      throw new HttpError(400, 'Укажите корректную дату');
    if (!['MB', 'FMF'].includes(body.line)) throw new HttpError(400, 'Некорректная линия');
    return {
      date, sup: text(body.sup, 'SUP', 40), mixtureId: positive(body.mixtureId, 'Смесь'),
      line: body.line, actual: temperature(body.actual), equipment: temperature(body.equipment),
      author: text(body.author, 'Сотрудник', 120)
    };
  }
  throw new HttpError(404, 'Раздел не найден');
}
module.exports = { HttpError, normalize, positive };
