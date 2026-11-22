class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const recordRules=require('../dist/record-rules.js');
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
    if (!['ADMIN', 'KEYUSER', 'QUALITY', 'EMPLOYER', 'ENGINEER'].includes(body.role)) throw new HttpError(400, 'Некорректная роль');
    return { name: text(body.name, 'Имя', 120), login, role: body.role };
  }
  if (kind === 'records') {
    const result=recordRules.validate(body);
    if(!result.valid){const error=new HttpError(400,Object.values(result.errors)[0]);error.fields=result.errors;throw error;}
    return {...result.value,recordFormatVersion:2};
  }
  throw new HttpError(404, 'Раздел не найден');
}
module.exports = { HttpError, normalize, positive };
