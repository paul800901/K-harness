import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {Cron} from 'croner';
import {atomicWrite} from './atomic-write.mjs';

export const MAX_SCHEDULE_TEXT_LENGTH = 4000;
export const MAX_SCHEDULE_TITLE_LENGTH = 80;
export const MAX_SCHEDULES_COUNT = 100;
export const MIN_CRON_INTERVAL_MS = 10 * 60 * 1000;
export const OVERDUE_THRESHOLD_MS = 2 * 60 * 1000;

export function formatScheduleTime(date, timezone) {
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
      .format(date)
      .replace(/\s/gu, ' '); // ICU puts a thin space between date and time.
  } catch {
    return date.toISOString();
  }
}

// croner only computes times; K's own tick fires. An ISO time without offset means local time in `timezone`.
const timing = (value, timezone) => {
  try {
    return new Cron(value, {timezone, paused: true});
  } catch {
    throw Error('排程時間格式無效。');
  }
};
const nextTime = (value, timezone, from) => timing(value, timezone).nextRun(from) ?? null;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u,
  CRON_FIELDS = /^\S+(\s+\S+){4,5}$/u;

// Catches obvious over-frequent rules early; the tick's spacing rule enforces the minimum for any rule.
const cronStart = (pattern, timezone, from) => {
  if (!CRON_FIELDS.test(pattern) || ISO_TIME.test(pattern))
    throw Error('cron 須為 5 或 6 欄的 cron 規則；單次時間請用 at。');
  const runs = timing(pattern, timezone).nextRuns(5, from);
  if (!runs.length) throw Error('Cron 排程在未來沒有可執行的時間。');
  for (let i = 1; i < runs.length; i++)
    if (runs[i] - runs[i - 1] < MIN_CRON_INTERVAL_MS) throw Error('Cron 排程連續兩次間隔不得少於 10 分鐘。');
  return runs[0];
};

const atStart = (at, timezone, from) => {
  if (!ISO_TIME.test(at)) throw Error('at 須為 ISO 日期時間，例如 2026-10-31T11:00；週期請用 cron。');
  const next = nextTime(at, timezone, from);
  if (!next) throw Error('at 時間必須在未來。');
  return next;
};

const validTimezone = tz => {
  try {
    new Intl.DateTimeFormat(undefined, {timeZone: tz});
    return tz;
  } catch {
    throw Error('時區無效。');
  }
};

const checkText = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`排程${label}須為 1–${max} 字元。`);
  return value.trim();
};

// One schedule file for the whole K. A due run is recorded as 'sending' with its next time before
// delivery, so a crash or restart never sends the same slot twice; 'sending' found on load is uncertain.
export function createRoomSchedules({
  root,
  deliver,
  listSessions,
  now = () => new Date(),
  tickMs = 30000,
  onChange = () => {}
}) {
  const file = path.join(root, '.runtime/room-schedules.json');
  let schedules = null,
    chain = Promise.resolve(),
    closing = false;
  const firing = new Set();
  const locked = task => {
    const next = chain.catch(() => {}).then(task);
    chain = next;
    return next;
  };
  const save = () => atomicWrite(file, JSON.stringify({schedules}));
  const read = async () => {
    if (schedules) return schedules;
    let list = [];
    try {
      list = JSON.parse(await readFile(file, 'utf8')).schedules ?? [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    schedules = list;
    const interrupted = list.filter(s => s.lastStatus === 'sending');
    for (const s of interrupted)
      Object.assign(s, {lastStatus: 'uncertain', lastError: '前次送出時 K 中斷，未確認是否送達；不重送。'});
    if (interrupted.length) await save();
    return schedules;
  };

  const run = async item => {
    let status, error;
    try {
      status = (await deliver(item))?.queued ? 'queued' : 'sent';
    } catch (e) {
      status = e.notSent === true ? 'failed' : 'uncertain';
      error = e.message;
    }
    await locked(async () => {
      firing.delete(item.id);
      const s = schedules.find(row => row.id === item.id);
      if (!s) return;
      Object.assign(s, {lastStatus: status, lastError: error ?? null});
      await save();
      onChange();
    });
  };

  const tick = async () => {
    if (closing) return;
    const at = now();
    const due = await locked(async () => {
      await read();
      const rows = schedules.filter(
        s => !s.paused && !s.done && s.nextRunAt && !firing.has(s.id) && new Date(s.nextRunAt) <= at
      );
      if (!rows.length) return [];
      const before = rows.map(s => ({...s}));
      const items = rows.map(s => {
        const planned = new Date(s.nextRunAt),
          late = at - planned > OVERDUE_THRESHOLD_MS,
          label = formatScheduleTime(planned, s.timezone);
        // Missed slots (K closed, sleep) collapse into this one late send; the next slot counts from now
        // and is never sooner than the minimum spacing after this one.
        const from = new Date(Math.max(at.getTime(), planned.getTime() + MIN_CRON_INTERVAL_MS - 1)),
          next = s.cron ? nextTime(s.cron, s.timezone, from) : null;
        Object.assign(s, {
          lastRunAt: s.nextRunAt,
          lastStatus: 'sending',
          lastError: null,
          nextRunAt: next?.toISOString() ?? null,
          done: !next
        });
        firing.add(s.id);
        return {
          id: s.id,
          threadId: s.threadId,
          title: s.title,
          scheduledLabel: label,
          text:
            `（K 定時排程「${s.title}」：本人先前設定的提醒，不是本人此刻輸入；原定 ${label}` +
            `${late ? '，K 當時未開或電腦休眠，現在補送一次' : ''}）\n\n${s.text}`
        };
      });
      try {
        await save();
      } catch (error) {
        // Nothing was sent: put these rows back so the next tick tries again.
        rows.forEach((s, i) => Object.assign(s, before[i]));
        for (const item of items) firing.delete(item.id);
        throw error;
      }
      onChange();
      return items;
    });
    await Promise.all(due.map(run));
  };

  const timer = setInterval(() => void tick().catch(() => {}), tickMs);
  timer.unref?.();

  const view = s => ({...s});
  return {
    tick,
    list: () =>
      locked(async () => {
        await read();
        const titles = new Map();
        try {
          for (const s of (await listSessions(root)).sessions) titles.set(s.threadId, s.title ?? '');
        } catch {
          /* Titles are a convenience; the schedules themselves are still listed. */
        }
        return {schedules: schedules.map(s => ({...view(s), targetTitle: titles.get(s.threadId) ?? ''}))};
      }),
    async add({title, text, cron, at, timezone, targetThreadId, createdByThreadId}) {
      title = checkText(title, MAX_SCHEDULE_TITLE_LENGTH, '標題');
      text = checkText(text, MAX_SCHEDULE_TEXT_LENGTH, '內容');
      if (!!cron?.trim() === !!at?.trim()) throw Error('排程須指定 cron 或 at 其中之一。');
      const tz = validTimezone(timezone || Intl.DateTimeFormat().resolvedOptions().timeZone),
        from = now(),
        next = cron?.trim() ? cronStart(cron.trim(), tz, from) : atStart(at.trim(), tz, from);
      return locked(async () => {
        await read();
        const {sessions} = await listSessions(root);
        if (!sessions.some(s => s.threadId === targetThreadId && !s.archived))
          throw Error('目標必須是本 K 現存、未封存的聊天室；請先用 room_list 確認 threadId。');
        let list = schedules;
        if (list.length >= MAX_SCHEDULES_COUNT) {
          const oldestDone = list.filter(s => s.done).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
          if (!oldestDone) throw Error(`已達排程上限 ${MAX_SCHEDULES_COUNT} 筆；請先刪除不用的排程。`);
          list = list.filter(s => s !== oldestDone);
        }
        const schedule = {
          id: randomUUID(),
          threadId: targetThreadId,
          title,
          text,
          cron: cron?.trim() || null,
          at: at?.trim() || null,
          timezone: tz,
          paused: false,
          createdAt: from.toISOString(),
          createdByThreadId,
          nextRunAt: next.toISOString(),
          lastRunAt: null,
          lastStatus: null,
          lastError: null,
          done: false
        };
        const previous = schedules;
        schedules = [...list, schedule];
        try {
          await save();
        } catch (error) {
          schedules = previous;
          throw error;
        }
        onChange();
        return {schedule: view(schedule)};
      });
    },
    update({id, title, text, cron, at, timezone, paused}) {
      return locked(async () => {
        await read();
        const current = schedules.find(s => s.id === id);
        if (!current) throw Error('找不到指定排程。');
        if (cron !== undefined && at !== undefined) throw Error('排程須指定 cron 或 at 其中之一。');
        // Validate on a copy so a rejected update leaves memory and disk unchanged.
        const original = {...current},
          s = {...current},
          from = now();
        if (title !== undefined) s.title = checkText(title, MAX_SCHEDULE_TITLE_LENGTH, '標題');
        if (text !== undefined) s.text = checkText(text, MAX_SCHEDULE_TEXT_LENGTH, '內容');
        if (timezone !== undefined) s.timezone = validTimezone(timezone);
        if (cron !== undefined) Object.assign(s, {cron: cron.trim(), at: null});
        if (at !== undefined) Object.assign(s, {at: at.trim(), cron: null});
        if (paused !== undefined) s.paused = paused === true;
        const retimed =
          cron !== undefined || at !== undefined || timezone !== undefined || (current.paused && !s.paused);
        if (retimed) {
          // Resuming or retiming counts from now; paused periods are not backfilled.
          const next = s.cron
            ? cronStart(s.cron, s.timezone, from)
            : at !== undefined
              ? atStart(s.at, s.timezone, from)
              : nextTime(s.at, s.timezone, from);
          Object.assign(s, {nextRunAt: next?.toISOString() ?? null, done: !next});
        }
        Object.assign(current, s);
        try {
          await save();
        } catch (error) {
          Object.assign(current, original);
          throw error;
        }
        onChange();
        return {schedule: view(current)};
      });
    },
    remove({id}) {
      return locked(async () => {
        await read();
        if (!schedules.some(s => s.id === id)) throw Error('找不到指定排程。');
        const previous = schedules;
        schedules = schedules.filter(s => s.id !== id);
        try {
          await save();
        } catch (error) {
          schedules = previous;
          throw error;
        }
        onChange();
        return {removed: true, id};
      });
    },
    async close() {
      closing = true;
      clearInterval(timer);
      await chain.catch(() => {});
    }
  };
}
