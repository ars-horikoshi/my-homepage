// src/utils.js
const holidayCache = {};

export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isToday(d) {
  const t = new Date();
  return d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate();
}

export function getMonday(d) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

export function computeDayLayout(events) {
  const result = new Map();
  if (events.length === 0) return result;
  const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const sorted = [...events].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));

  const colEnds = [];
  const info = new Map();
  for (const ev of sorted) {
    const startMin = toMin(ev.startTime);
    const endMin = toMin(ev.endTime);
    let col = 0;
    while (col < colEnds.length && colEnds[col] > startMin) col++;
    if (col === colEnds.length) colEnds.push(0);
    colEnds[col] = endMin;
    info.set(ev, { col, startMin, endMin });
  }

  for (const ev of sorted) {
    const { col, startMin, endMin } = info.get(ev);
    let maxCol = col;
    for (const other of sorted) {
      if (other === ev) continue;
      const o = info.get(other);
      if (o.startMin < endMin && o.endMin > startMin) maxCol = Math.max(maxCol, o.col);
    }
    result.set(ev, { col, totalCols: maxCol + 1 });
  }
  return result;
}

export function calculateHolidaysForYear(year) {
  if (holidayCache[year]) return holidayCache[year];

  const map = new Map();

  function nthMonday(month, n) {
    const firstDay = new Date(year, month - 1, 1);
    const offset = (1 - firstDay.getDay() + 7) % 7;
    return 1 + offset + (n - 1) * 7;
  }

  function addH(month, day, name) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, name);
  }

  addH(1, 1, "元旦");
  addH(2, 11, "建国記念の日");
  addH(2, 23, "天皇誕生日");
  addH(4, 29, "昭和の日");
  addH(5, 3, "憲法記念日");
  addH(5, 4, "みどりの日");
  addH(5, 5, "こどもの日");
  addH(8, 11, "山の日");
  addH(11, 3, "文化の日");
  addH(11, 23, "勤労感謝の日");

  addH(1, nthMonday(1, 2), "成人の日");
  addH(7, nthMonday(7, 3), "海の日");
  addH(9, nthMonday(9, 3), "敬老の日");
  addH(10, nthMonday(10, 2), "スポーツの日");

  const dy = year - 1980;
  const vernalDay = Math.floor(20.8431 + 0.242194 * dy - Math.floor(dy / 4));
  const autumnalDay = Math.floor(23.2488 + 0.242194 * dy - Math.floor(dy / 4));
  addH(3, vernalDay, "春分の日");
  addH(9, autumnalDay, "秋分の日");

  const sorted = [...map.keys()].sort();
  for (let i = 0; i < sorted.length - 1; i++) {
    const d1 = new Date(sorted[i]);
    const d2 = new Date(sorted[i + 1]);
    if ((d2 - d1) / 86400000 === 2) {
      const between = new Date(d1);
      between.setDate(between.getDate() + 1);
      if (between.getDay() !== 0) {
        addH(between.getMonth() + 1, between.getDate(), "国民の休日");
      }
    }
  }

  for (const [key] of [...map]) {
    const d = new Date(key);
    if (d.getDay() === 0) {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      while (map.has(toDateStr(next))) {
        next.setDate(next.getDate() + 1);
      }
      map.set(toDateStr(next), "振替休日");
    }
  }

  holidayCache[year] = map;
  return map;
}

export function getJapaneseHoliday(dateStr) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  return calculateHolidaysForYear(year).get(dateStr) || null;
}
