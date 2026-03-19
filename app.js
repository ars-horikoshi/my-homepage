import { toDateStr, isToday, getMonday, computeDayLayout, calculateHolidaysForYear, getJapaneseHoliday } from './src/utils.js';

(() => {
  "use strict";

  // ---- State ----
  let scheduleData = { events: [], categories: {} };
  let gcalEvents = [];
  let gcalAuthRequired = false;
  let gcalError = null;
  let currentView = "weekly"; // "weekly" | "monthly"
  let currentDate = new Date(); // reference date for navigation
  let currentDetailEvent = null; // event shown in detail modal

  // ---- DOM refs ----
  const btnWeekly = document.getElementById("btn-weekly");
  const btnMonthly = document.getElementById("btn-monthly");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const btnToday = document.getElementById("btn-today");
  const btnAdd = document.getElementById("btn-add");
  const btnGcalReload = document.getElementById("btn-gcal-reload");
  const btnJumpDate = document.getElementById("btn-jump-date");
  const inputJumpDate = document.getElementById("input-jump-date");
  const btnMail = document.getElementById("btn-mail");
  const mailCountBadge = document.getElementById("mail-count-badge");
  const mailOverlay = document.getElementById("mail-overlay");
  const mailClose = document.getElementById("mail-close");
  const mailModalTitle = document.getElementById("mail-modal-title");
  const mailList = document.getElementById("mail-list");
  const navLabel = document.getElementById("nav-label");
  const weeklyView = document.getElementById("weekly-view");
  const monthlyView = document.getElementById("monthly-view");
  const legendEl = document.getElementById("legend");
  const modalOverlay = document.getElementById("modal-overlay");
  const modalClose = document.getElementById("modal-close");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  const modalActions = document.getElementById("modal-actions");
  const btnEdit = document.getElementById("btn-edit");
  const btnDelete = document.getElementById("btn-delete");
  const editModalOverlay = document.getElementById("edit-modal-overlay");
  const editModalClose = document.getElementById("edit-modal-close");
  const editModalTitle = document.getElementById("edit-modal-title");
  const editForm = document.getElementById("edit-form");
  const editId = document.getElementById("edit-id");
  const editTitle = document.getElementById("edit-title");
  const editDate = document.getElementById("edit-date");
  const editStart = document.getElementById("edit-start");
  const editEnd = document.getElementById("edit-end");
  const editCategory = document.getElementById("edit-category");
  const editNote = document.getElementById("edit-note");
  const editCancel = document.getElementById("edit-cancel");

  // ---- Helpers ----
  const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];
  const START_HOUR = 0;
  const END_HOUR = 24;

  function eventsForDate(dateStr) {
    const local = scheduleData.events.filter(e => e.date === dateStr);
    const gcal  = gcalEvents.filter(e => e.date === dateStr);
    const holidayName = getJapaneseHoliday(dateStr);
    const holidays = holidayName ? [{
      id: `holiday-${dateStr}`,
      title: holidayName,
      date: dateStr,
      startTime: "00:00",
      endTime: "23:59",
      category: "__holiday__",
      source: "holiday",
    }] : [];
    return [...holidays, ...local, ...gcal];
  }

  function categoryColor(cat) {
    if (cat === "__holiday__") return "#e74c3c";
    return (scheduleData.categories[cat] && scheduleData.categories[cat].color) || "#999";
  }

  function categoryLabel(cat) {
    return (scheduleData.categories[cat] && scheduleData.categories[cat].label) || cat;
  }

  function nextId() {
    const numericIds = scheduleData.events.map(e => e.id).filter(id => typeof id === "number");
    if (numericIds.length === 0) return 1;
    return Math.max(...numericIds) + 1;
  }

  // ---- API ----
  async function loadSchedule() {
    try {
      const res = await fetch("/api/schedule");
      scheduleData = await res.json();
    } catch {
      try {
        const res = await fetch("schedule.json");
        scheduleData = await res.json();
      } catch (err) {
        console.error("schedule.json の読み込みに失敗しました:", err);
      }
    }
    await loadGcalEvents();
    renderLegend();
    render();
  }

  async function loadGcalEvents() {
    try {
      const res = await fetch("/api/gcal");
      if (res.status === 401) {
        gcalAuthRequired = true;
        gcalEvents = [];
        gcalError = null;
      } else if (res.ok) {
        const data = await res.json();
        gcalAuthRequired = false;
        gcalEvents = data.events || [];
        gcalError = null;
      } else {
        const errData = await res.json().catch(() => ({}));
        gcalError = errData.error || `GCalエラー (${res.status})`;
        gcalEvents = [];
      }
    } catch (e) {
      gcalError = "GCal接続エラー: " + e.message;
      gcalEvents = [];
    }
    updateGcalUI();
  }

  async function saveSchedule() {
    try {
      const res = await fetch("/api/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduleData, null, 2),
      });
      if (!res.ok) throw new Error("保存に失敗しました");
    } catch (err) {
      alert("保存に失敗しました: " + err.message);
    }
  }

  // ---- Legend ----
  function renderLegend() {
    legendEl.innerHTML = "";
    for (const [key, val] of Object.entries(scheduleData.categories)) {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `<span class="legend-color" style="background:${val.color}"></span>${val.label}`;
      legendEl.appendChild(item);
    }
  }

  // ---- Detail Modal ----
  function showEventDetail(ev) {
    currentDetailEvent = ev;
    modalTitle.textContent = ev.title;
    const color = categoryColor(ev.category);
    const readonlyBadge = ev.source === "gcal"
      ? `<div><span class="gcal-readonly-badge">Google カレンダー (読み取り専用)</span></div>`
      : ev.source === "holiday"
      ? `<div><span class="gcal-readonly-badge holiday-readonly-badge">日本の祝日</span></div>`
      : "";
    const timeRow = ev.source === "holiday"
      ? `<div><span class="label">種別:</span> 終日</div>`
      : `<div><span class="label">時間:</span> ${ev.startTime} 〜 ${ev.endTime}</div>`;
    modalBody.innerHTML = `
      <div class="modal-detail">
        <div><span class="label">日付:</span> ${ev.date}</div>
        ${timeRow}
        ${ev.source !== "holiday" ? `<div><span class="label">カテゴリ:</span> <span class="category-badge" style="background:${color}">${categoryLabel(ev.category)}</span></div>` : ""}
        ${ev.note ? `<div><span class="label">メモ:</span> ${ev.note}</div>` : ""}
        ${readonlyBadge}
      </div>
    `;
    if (ev.source === "gcal" || ev.source === "holiday") {
      modalActions.classList.add("hidden");
    } else {
      modalActions.classList.remove("hidden");
    }
    modalOverlay.classList.remove("hidden");
  }

  function updateGcalUI() {
    const navRight = document.querySelector(".nav-right");
    const existing = navRight.querySelector(".gcal-ui");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "gcal-ui";

    if (gcalAuthRequired) {
      const btn = document.createElement("a");
      btn.className = "btn-gcal-auth";
      btn.href = "/api/gcal/auth";
      btn.textContent = "Google カレンダー連携";
      wrapper.appendChild(btn);
    } else if (gcalError) {
      const msg = document.createElement("span");
      msg.className = "gcal-error-msg";
      msg.textContent = gcalError;
      wrapper.appendChild(msg);
    }

    navRight.appendChild(wrapper);
  }

  function closeModal() {
    modalOverlay.classList.add("hidden");
    modalActions.classList.add("hidden");
    currentDetailEvent = null;
  }

  // ---- Edit Modal ----
  function populateCategorySelect() {
    editCategory.innerHTML = "";
    for (const [key, val] of Object.entries(scheduleData.categories)) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = val.label;
      editCategory.appendChild(opt);
    }
  }

  function openEditModal(ev) {
    populateCategorySelect();
    if (ev) {
      editModalTitle.textContent = "予定を編集";
      editId.value = ev.id;
      editTitle.value = ev.title;
      editDate.value = ev.date;
      editStart.value = ev.startTime;
      editEnd.value = ev.endTime;
      editCategory.value = ev.category;
      editNote.value = ev.note || "";
    } else {
      editModalTitle.textContent = "予定を追加";
      editId.value = "";
      editForm.reset();
      editDate.value = toDateStr(currentDate);
    }
    editModalOverlay.classList.remove("hidden");
  }

  function closeEditModal() {
    editModalOverlay.classList.add("hidden");
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const id = editId.value ? Number(editId.value) : nextId();
    const eventData = {
      id,
      title: editTitle.value.trim(),
      date: editDate.value,
      startTime: editStart.value,
      endTime: editEnd.value,
      category: editCategory.value,
      note: editNote.value.trim(),
    };

    if (editId.value) {
      const idx = scheduleData.events.findIndex(e => e.id === id);
      if (idx !== -1) scheduleData.events[idx] = eventData;
    } else {
      scheduleData.events.push(eventData);
    }

    await saveSchedule();
    closeEditModal();
    render();
  }

  async function deleteEvent(id) {
    if (!confirm("この予定を削除しますか？")) return;
    scheduleData.events = scheduleData.events.filter(e => e.id !== id);
    await saveSchedule();
    closeModal();
    render();
  }

  // ---- Weekly View ----
  function renderWeekly() {
    const monday = getMonday(currentDate);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }

    // nav label
    const first = days[0];
    const last = days[6];
    navLabel.textContent = `${first.getFullYear()}年${first.getMonth() + 1}月${first.getDate()}日 〜 ${last.getMonth() + 1}月${last.getDate()}日`;

    const grid = document.createElement("div");
    grid.className = "weekly-grid";

    // corner cell
    grid.innerHTML = '<div class="corner"></div>';

    // day headers
    for (let i = 0; i < 7; i++) {
      const d = days[i];
      const dayIdx = d.getDay();
      const dateStr = toDateStr(d);
      const holidayName = getJapaneseHoliday(dateStr);
      let cls = "day-header";
      if (isToday(d)) cls += " today";
      if (dayIdx === 0 || holidayName) cls += " sun";
      if (dayIdx === 6) cls += " sat";
      const header = document.createElement("div");
      header.className = cls;
      const label = holidayName
        ? `${d.getMonth() + 1}/${d.getDate()} (${DAY_NAMES[dayIdx]}) 🎌`
        : `${d.getMonth() + 1}/${d.getDate()} (${DAY_NAMES[dayIdx]})`;
      header.textContent = label;
      if (holidayName) header.title = holidayName;
      grid.appendChild(header);
    }

    // current time line
    const now = new Date();
    const todayInWeek = days.some(d => isToday(d));
    const currentHour = now.getHours();
    const currentMinutes = now.getMinutes();
    const timeLineTop = (currentMinutes / 60) * 48;

    // pre-compute overlap layouts for each day
    const dayLayouts = days.map(d => {
      const dateStr = toDateStr(d);
      const timed = eventsForDate(dateStr).filter(e => !(e.startTime === "00:00" && e.endTime === "23:59"));
      return computeDayLayout(timed);
    });

    // all-day row
    const allDayLabel = document.createElement("div");
    allDayLabel.className = "time-label allday-label";
    allDayLabel.textContent = "終日";
    grid.appendChild(allDayLabel);
    for (let i = 0; i < 7; i++) {
      const d = days[i];
      const cell = document.createElement("div");
      cell.className = "time-cell allday-cell";
      if (isToday(d)) cell.classList.add("today-col");
      const dateStr = toDateStr(d);
      const allDayEvents = eventsForDate(dateStr).filter(e => e.startTime === "00:00" && e.endTime === "23:59");
      for (const ev of allDayEvents) {
        const block = document.createElement("div");
        block.className = "event-block allday-block";
        if (ev.source === "gcal") block.classList.add("gcal-event");
        block.style.background = categoryColor(ev.category);
        block.textContent = ev.title;
        block.addEventListener("click", () => showEventDetail(ev));
        cell.appendChild(block);
      }
      grid.appendChild(cell);
    }

    // time rows
    for (let h = START_HOUR; h < END_HOUR; h++) {
      // time label
      const label = document.createElement("div");
      label.className = "time-label";
      label.textContent = `${String(h).padStart(2, "0")}:00`;
      grid.appendChild(label);

      // day cells
      for (let i = 0; i < 7; i++) {
        const d = days[i];
        const cell = document.createElement("div");
        cell.className = "time-cell";
        if (isToday(d)) cell.classList.add("today-col");

        // find events that overlap this hour
        const dateStr = toDateStr(d);
        const events = eventsForDate(dateStr).filter(e => !(e.startTime === "00:00" && e.endTime === "23:59"));
        for (const ev of events) {
          const [sh, sm] = ev.startTime.split(":").map(Number);
          const [eh, em] = ev.endTime.split(":").map(Number);
          const startMin = sh * 60 + sm;
          const endMin = eh * 60 + em;
          const cellStart = h * 60;
          const cellEnd = (h + 1) * 60;

          // only render event block in the cell where it starts
          if (startMin >= cellStart && startMin < cellEnd) {
            const block = document.createElement("div");
            block.className = "event-block";
            if (ev.source === "gcal") block.classList.add("gcal-event");
            const topPx = ((startMin - cellStart) / 60) * 48;
            const durationPx = ((endMin - startMin) / 60) * 48;
            block.style.top = topPx + "px";
            block.style.height = Math.max(durationPx - 2, 14) + "px";
            block.style.background = categoryColor(ev.category);
            block.textContent = `${ev.startTime}-${ev.endTime} ${ev.title}`;
            const { col, totalCols } = dayLayouts[i].get(ev) || { col: 0, totalCols: 1 };
            const pct = 100 / totalCols;
            block.style.left = `calc(${col * pct}% + 2px)`;
            block.style.width = `calc(${pct}% - 4px)`;
            block.style.right = "auto";
            block.addEventListener("click", () => showEventDetail(ev));
            cell.appendChild(block);
          }
        }

        // current time line
        if (todayInWeek && isToday(d) && h === currentHour) {
          const line = document.createElement("div");
          line.className = "current-time-line";
          line.style.top = timeLineTop + "px";
          cell.appendChild(line);
        }

        grid.appendChild(cell);
      }
    }

    weeklyView.innerHTML = "";
    weeklyView.appendChild(grid);
  }

  // ---- Monthly View ----
  function renderMonthly() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    navLabel.textContent = `${year}年${month + 1}月`;

    const grid = document.createElement("div");
    grid.className = "monthly-grid";

    // day-of-week headers (Mon first)
    const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
    for (const di of dayOrder) {
      const hdr = document.createElement("div");
      let cls = "month-day-header";
      if (di === 0) cls += " sun";
      if (di === 6) cls += " sat";
      hdr.className = cls;
      hdr.textContent = DAY_NAMES[di];
      grid.appendChild(hdr);
    }

    // first day of month
    const firstDay = new Date(year, month, 1);
    let startDow = firstDay.getDay(); // 0=Sun
    // convert to Mon-based offset (Mon=0 .. Sun=6)
    const offset = (startDow === 0) ? 6 : startDow - 1;

    // start date (may be in previous month)
    const startDate = new Date(firstDay);
    startDate.setDate(1 - offset);

    // generate 6 weeks (42 cells)
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);

      const cell = document.createElement("div");
      cell.className = "month-cell";
      if (d.getMonth() !== month) cell.classList.add("outside");
      if (isToday(d)) cell.classList.add("today");
      const cellDateStr = toDateStr(d);
      const cellHoliday = getJapaneseHoliday(cellDateStr);
      if (cellHoliday) cell.classList.add("holiday-day");

      const num = document.createElement("div");
      num.className = "day-number";
      if (d.getDay() === 0 || cellHoliday) num.classList.add("sun-num");
      if (d.getDay() === 6) num.classList.add("sat-num");
      num.textContent = d.getDate();
      if (cellHoliday) num.title = cellHoliday;
      cell.appendChild(num);

      // events
      const dateStr = toDateStr(d);
      const events = eventsForDate(dateStr).sort((a, b) => {
        if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
        if (a.endTime !== b.endTime) return a.endTime.localeCompare(b.endTime);
        return a.category.localeCompare(b.category);
      });
      for (const ev of events) {
        const pill = document.createElement("div");
        pill.className = "month-event";
        if (ev.source === "gcal") pill.classList.add("gcal-event");
        pill.style.background = categoryColor(ev.category);
        pill.textContent = `${ev.startTime}-${ev.endTime} ${ev.title}`;
        pill.addEventListener("click", () => showEventDetail(ev));
        cell.appendChild(pill);
      }

      grid.appendChild(cell);
    }

    monthlyView.innerHTML = "";
    monthlyView.appendChild(grid);
  }

  // ---- Render dispatcher ----
  function render() {
    if (currentView === "weekly") {
      weeklyView.classList.remove("hidden");
      monthlyView.classList.add("hidden");
      renderWeekly();
    } else {
      weeklyView.classList.add("hidden");
      monthlyView.classList.remove("hidden");
      renderMonthly();
    }
  }

  // ---- Mail ----

  async function updateMailCountBadge() {
    try {
      const res = await fetch("/api/gmail");
      if (!res.ok) return;
      const data = await res.json();
      const unread = (data.emails || []).filter(m => m.unread).length;
      if (unread > 0) {
        mailCountBadge.textContent = unread > 99 ? "99+" : String(unread);
        mailCountBadge.classList.remove("hidden");
      } else {
        mailCountBadge.classList.add("hidden");
      }
    } catch {
      // silently ignore network errors for background count fetch
    }
  }

  async function openMailPopup() {
    await updateMailCountBadge();
    const now = new Date();
    const dateLabel = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    mailModalTitle.textContent = `📧 本日のメール（${dateLabel}）`;
    mailList.innerHTML = '<div class="mail-loading">読み込み中...</div>';
    mailOverlay.classList.remove("hidden");
    fetchMails();
  }

  function closeMailPopup() {
    mailOverlay.classList.add("hidden");
  }

  async function fetchMails() {
    try {
      const res = await fetch("/api/gmail");
      if (res.status === 401) {
        mailList.innerHTML = `
          <div class="mail-auth-required">
            <p>Gmail との連携が必要です</p>
            <a href="/api/gmail/auth" class="btn-gmail-auth">📧 Gmail を認証する</a>
          </div>`;
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        renderMailError(err.error || "メールの取得に失敗しました");
        return;
      }
      const data = await res.json();
      renderMailList(data.emails || []);
    } catch (err) {
      renderMailError("ネットワークエラー: " + err.message);
    }
  }

  function renderMailError(msg) {
    mailList.innerHTML = `<div class="mail-error">${escapeHtml(msg)}</div>`;
  }

  function renderMailList(emails) {
    if (emails.length === 0) {
      mailList.innerHTML = '<div class="mail-empty">本日のメールはありません</div>';
      return;
    }
    mailList.innerHTML = "";
    for (const mail of emails) {
      const item = document.createElement("div");
      item.className = "mail-item" + (mail.unread ? " mail-unread" : "");

      const timeStr = formatMailTime(mail.date);
      const unreadBadge = mail.unread
        ? '<span class="mail-badge mail-badge-unread">未読</span>'
        : '<span class="mail-badge mail-badge-read">既読</span>';

      item.innerHTML = `
        <div class="mail-header">
          <div class="mail-meta">
            ${unreadBadge}
            <span class="mail-time">${escapeHtml(timeStr)}</span>
          </div>
          <div class="mail-from">${escapeHtml(mail.from || "(差出人不明)")}</div>
          <div class="mail-subject">${escapeHtml(mail.subject || "(件名なし)")}</div>
        </div>
        <div class="mail-body-preview" data-expanded="false">
          <div class="mail-body-text">${escapeHtml(mail.body || "(本文なし)")}</div>
          <button class="mail-toggle-btn">本文を表示 ▼</button>
        </div>
      `;

      const preview = item.querySelector(".mail-body-preview");
      const toggleBtn = item.querySelector(".mail-toggle-btn");
      toggleBtn.addEventListener("click", () => {
        const expanded = preview.dataset.expanded === "true";
        preview.dataset.expanded = String(!expanded);
        toggleBtn.textContent = expanded ? "本文を表示 ▼" : "本文を閉じる ▲";
      });

      mailList.appendChild(item);
    }
  }

  function formatMailTime(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch {
      return dateStr;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- Event listeners ----
  btnWeekly.addEventListener("click", () => {
    currentView = "weekly";
    btnWeekly.classList.add("active");
    btnMonthly.classList.remove("active");
    render();
  });

  btnMonthly.addEventListener("click", () => {
    currentView = "monthly";
    btnMonthly.classList.add("active");
    btnWeekly.classList.remove("active");
    render();
  });

  btnPrev.addEventListener("click", () => {
    if (currentView === "weekly") {
      currentDate.setDate(currentDate.getDate() - 7);
    } else {
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    }
    render();
  });

  btnNext.addEventListener("click", () => {
    if (currentView === "weekly") {
      currentDate.setDate(currentDate.getDate() + 7);
    } else {
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    }
    render();
  });

  btnToday.addEventListener("click", () => {
    currentDate = new Date();
    render();
  });

  btnJumpDate.addEventListener("click", () => {
    try { inputJumpDate.showPicker(); } catch { inputJumpDate.click(); }
  });

  inputJumpDate.addEventListener("change", () => {
    if (!inputJumpDate.value) return;
    currentDate = new Date(inputJumpDate.value + "T00:00:00");
    inputJumpDate.value = "";
    render();
  });

  btnMail.addEventListener("click", openMailPopup);
  mailClose.addEventListener("click", closeMailPopup);
  mailOverlay.addEventListener("click", (e) => {
    if (e.target === mailOverlay) closeMailPopup();
  });

  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  btnAdd.addEventListener("click", () => openEditModal(null));

  btnGcalReload.addEventListener("click", async () => {
    btnGcalReload.disabled = true;
    await loadGcalEvents();
    render();
    btnGcalReload.disabled = false;
  });

  btnEdit.addEventListener("click", () => {
    if (currentDetailEvent) {
      const ev = currentDetailEvent;
      closeModal();
      openEditModal(ev);
    }
  });

  btnDelete.addEventListener("click", () => {
    if (currentDetailEvent) {
      deleteEvent(currentDetailEvent.id);
    }
  });

  editModalClose.addEventListener("click", closeEditModal);
  editCancel.addEventListener("click", closeEditModal);
  editModalOverlay.addEventListener("click", (e) => {
    if (e.target === editModalOverlay) closeEditModal();
  });

  editForm.addEventListener("submit", handleFormSubmit);

  // ---- Logout ----
  const btnLogout = document.getElementById("btn-logout");
  btnLogout.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  });

  // ---- Dark Mode Toggle ----
  const btnTheme = document.getElementById("btn-theme");

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    btnTheme.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  const savedTheme = localStorage.getItem("theme") || "light";
  applyTheme(savedTheme);

  btnTheme.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("theme", next);
  });

  // ---- Current time line auto-update ----
  // Renders weekly view immediately when returning to current week, then every 5 minutes
  function updateTimeLineIfNeeded() {
    if (currentView !== "weekly") return;
    const monday = getMonday(currentDate);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
    if (days.some(d => isToday(d))) renderWeekly();
  }

  setInterval(updateTimeLineIfNeeded, 5 * 60 * 1000);

  // ---- Mail count badge (initial fetch + 5-min auto-refresh) ----
  updateMailCountBadge();
  setInterval(updateMailCountBadge, 5 * 60 * 1000);

  // ---- Init ----
  loadSchedule();
})();
