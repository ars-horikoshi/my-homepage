import { describe, it, expect, beforeEach } from "vitest";
import {
  toDateStr,
  isToday,
  getMonday,
  computeDayLayout,
  calculateHolidaysForYear,
  getJapaneseHoliday,
} from "../../src/utils.js";

describe("toDateStr", () => {
  it("formats 2024-01-05 correctly", () => {
    expect(toDateStr(new Date(2024, 0, 5))).toBe("2024-01-05");
  });

  it("formats 2024-12-31 correctly", () => {
    expect(toDateStr(new Date(2024, 11, 31))).toBe("2024-12-31");
  });

  it("pads single-digit month and day", () => {
    expect(toDateStr(new Date(2023, 2, 9))).toBe("2023-03-09");
  });
});

describe("isToday", () => {
  it("returns true for today's date", () => {
    expect(isToday(new Date())).toBe(true);
  });

  it("returns false for yesterday", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isToday(yesterday)).toBe(false);
  });

  it("returns false for tomorrow", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isToday(tomorrow)).toBe(false);
  });
});

describe("getMonday", () => {
  it("returns same day for Monday input", () => {
    // 2024-01-08 is a Monday
    const monday = new Date(2024, 0, 8);
    const result = getMonday(monday);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(8);
  });

  it("returns previous Monday for Sunday input", () => {
    // 2024-01-07 is a Sunday -> Monday should be 2024-01-01
    const sunday = new Date(2024, 0, 7);
    const result = getMonday(sunday);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
  });

  it("returns previous Monday for Wednesday input", () => {
    // 2024-01-10 is a Wednesday -> Monday should be 2024-01-08
    const wednesday = new Date(2024, 0, 10);
    const result = getMonday(wednesday);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(8);
  });

  it("returns previous Monday for Saturday input", () => {
    // 2024-01-13 is a Saturday -> Monday should be 2024-01-08
    const saturday = new Date(2024, 0, 13);
    const result = getMonday(saturday);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(8);
  });
});

describe("computeDayLayout", () => {
  it("returns empty Map for empty array", () => {
    const result = computeDayLayout([]);
    expect(result.size).toBe(0);
  });

  it("single event gets col:0, totalCols:1", () => {
    const ev = { startTime: "09:00", endTime: "10:00" };
    const result = computeDayLayout([ev]);
    expect(result.get(ev)).toEqual({ col: 0, totalCols: 1 });
  });

  it("two non-overlapping events both get col:0, totalCols:1", () => {
    const ev1 = { startTime: "09:00", endTime: "10:00" };
    const ev2 = { startTime: "11:00", endTime: "12:00" };
    const result = computeDayLayout([ev1, ev2]);
    expect(result.get(ev1)).toEqual({ col: 0, totalCols: 1 });
    expect(result.get(ev2)).toEqual({ col: 0, totalCols: 1 });
  });

  it("two overlapping events get col 0 and col 1, totalCols:2", () => {
    const ev1 = { startTime: "09:00", endTime: "11:00" };
    const ev2 = { startTime: "10:00", endTime: "12:00" };
    const result = computeDayLayout([ev1, ev2]);
    expect(result.get(ev1)).toEqual({ col: 0, totalCols: 2 });
    expect(result.get(ev2)).toEqual({ col: 1, totalCols: 2 });
  });

  it("three events: first two overlap, third overlaps both -> totalCols:2 for all", () => {
    const ev1 = { startTime: "09:00", endTime: "12:00" };
    const ev2 = { startTime: "09:30", endTime: "11:00" };
    const ev3 = { startTime: "10:00", endTime: "11:30" };
    const result = computeDayLayout([ev1, ev2, ev3]);
    // ev1 gets col 0, ev2 gets col 1, ev3 might go to col 0 or 2 depending on ends
    // ev1 ends at 720, ev2 ends at 660
    // ev3 starts at 600: col0 ends at 720 > 600, col1 ends at 660 > 600, so col=2
    // All three overlap each other -> maxCol=2, totalCols=3
    expect(result.get(ev1).totalCols).toBe(3);
    expect(result.get(ev2).totalCols).toBe(3);
    expect(result.get(ev3).totalCols).toBe(3);
  });

  it("events with same start time overlap and are detected", () => {
    const ev1 = { startTime: "09:00", endTime: "10:00" };
    const ev2 = { startTime: "09:00", endTime: "10:30" };
    const result = computeDayLayout([ev1, ev2]);
    expect(result.get(ev1).totalCols).toBe(2);
    expect(result.get(ev2).totalCols).toBe(2);
    // They should be in different columns
    expect(result.get(ev1).col).not.toBe(result.get(ev2).col);
  });
});

describe("calculateHolidaysForYear", () => {
  it("2024: 元旦 is 2024-01-01", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-01-01")).toBe("元旦");
  });

  it("2024: 成人の日 is 2nd Monday of Jan = 2024-01-08", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-01-08")).toBe("成人の日");
  });

  it("2024: 春分の日 is 2024-03-20", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-03-20")).toBe("春分の日");
  });

  it("2024: 秋分の日 is 2024-09-22", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-09-22")).toBe("秋分の日");
  });

  it("returns the same Map object when called twice (cache)", () => {
    const map1 = calculateHolidaysForYear(2023);
    const map2 = calculateHolidaysForYear(2023);
    expect(map1).toBe(map2);
  });

  it("振替休日: 2024-11-03 (文化の日) is Sunday -> 2024-11-04 is 振替休日", () => {
    // 2024-11-03 is indeed Sunday
    const d = new Date(2024, 10, 3); // November 3, 2024
    expect(d.getDay()).toBe(0); // Sunday
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-11-03")).toBe("文化の日");
    expect(map.get("2024-11-04")).toBe("振替休日");
  });

  it("国民の休日: 2009 has 敬老の日(9/21), 国民の休日(9/22), 秋分の日(9/23)", () => {
    const map = calculateHolidaysForYear(2009);
    expect(map.get("2009-09-21")).toBe("敬老の日");
    expect(map.get("2009-09-22")).toBe("国民の休日");
    expect(map.get("2009-09-23")).toBe("秋分の日");
  });

  it("includes 建国記念の日 on Feb 11", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-02-11")).toBe("建国記念の日");
  });

  it("includes 天皇誕生日 on Feb 23", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-02-23")).toBe("天皇誕生日");
  });

  it("includes 昭和の日 on Apr 29", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-04-29")).toBe("昭和の日");
  });

  it("includes こどもの日 on May 5", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-05-05")).toBe("こどもの日");
  });

  it("includes 山の日 on Aug 11", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-08-11")).toBe("山の日");
  });

  it("includes 勤労感謝の日 on Nov 23", () => {
    const map = calculateHolidaysForYear(2024);
    expect(map.get("2024-11-23")).toBe("勤労感謝の日");
  });

  it("includes 海の日 (3rd Monday of July)", () => {
    const map = calculateHolidaysForYear(2024);
    // 3rd Monday of July 2024: July 1 is Mon, so 3rd Mon = July 15
    expect(map.get("2024-07-15")).toBe("海の日");
  });

  it("includes 敬老の日 (3rd Monday of September)", () => {
    const map = calculateHolidaysForYear(2024);
    // 3rd Monday of Sept 2024: Sept 1 is Sun, offset = (1-0+7)%7 = 1, first Mon = Sept 2
    // 3rd Mon = 2 + 14 = 16
    expect(map.get("2024-09-16")).toBe("敬老の日");
  });

  it("includes スポーツの日 (2nd Monday of October)", () => {
    const map = calculateHolidaysForYear(2024);
    // Oct 1 2024 is Tuesday (getDay=2), offset=(1-2+7)%7=6, first Mon=7, 2nd Mon=14
    expect(map.get("2024-10-14")).toBe("スポーツの日");
  });
});

describe("getJapaneseHoliday", () => {
  it("returns 元旦 for 2024-01-01", () => {
    expect(getJapaneseHoliday("2024-01-01")).toBe("元旦");
  });

  it("returns null for a non-holiday date", () => {
    expect(getJapaneseHoliday("2024-06-15")).toBeNull();
  });

  it("returns 振替休日 for 2024-11-04", () => {
    expect(getJapaneseHoliday("2024-11-04")).toBe("振替休日");
  });
});
