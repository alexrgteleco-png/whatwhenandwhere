'use strict';

// Todas las fechas se guardan en UTC (timestamptz) y se muestran en hora de España.
const TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';

const longFormat = new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const shortFormat = new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dayFormat = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: 'numeric' });
const monthFormat = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, month: 'short' });

function formatLong(date) {
  const text = longFormat.format(new Date(date));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Texto del fin del evento: solo la hora si termina el mismo día.
function formatEnd(start, end) {
  const s = toInputValue(start);
  const e = toInputValue(end);
  if (s.slice(0, 10) === e.slice(0, 10)) return `hasta las ${e.slice(11)}`;
  return `hasta el ${longFormat.format(new Date(end))}`;
}

function formatShort(date) {
  return shortFormat.format(new Date(date));
}

function dayAndMonth(date) {
  const d = new Date(date);
  return { day: dayFormat.format(d), month: monthFormat.format(d).replace('.', '') };
}

// Valor para <input type="datetime-local"> en hora de España.
function toInputValue(date) {
  if (!date) return '';
  const parts = Object.fromEntries(partsFormat.formatToParts(new Date(date)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function timeAgo(date) {
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'ahora mismo';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return formatShort(date);
}

module.exports = { TZ, formatLong, formatEnd, formatShort, dayAndMonth, toInputValue, timeAgo };
