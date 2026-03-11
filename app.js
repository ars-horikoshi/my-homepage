(() => {
  "use strict";

  // ---- State ----
  let scheduleData = { events: [], categories: {} };
  let gcalEvents = [];
  let gcalAuthRequired = false;
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

  function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function isToday(d) {
    const t = new Date();
    return d.getFullYear() === t.getFullYear() &&
      d.getMonth() === t.getMonth() &&
      d.getDate() === t.getDate();
  }

  function getMonday(d) {
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    return monday;
  }

  function eventsForDate(dateStr) {
    const local = scheduleData.events.filter(e => e.date === dateStr);
    const gcal  = gcalEvents.filter(e => e.date === dateStr);
    return [...local, ...gcal];
  }

  function categoryColor(cat) {
    return (scheduleData.categories[cat] && scheduleData.categories[cat].color) || "#999";
  }

  function categoryLabel(cat) {
    return (scheduleData.categories[cat] && scheduleData.categories[cat].label) || cat;
  }

  // ---- Overlap Layout ----
  function computeDayLayout(events) {
    const result = new Map();
    if (events.length === 0) return result;
    const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const sorted = [...events].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));

    const colEnds = []; // end time of last event per column
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
      } else if (res.ok) {
        const data = await res.json();
        gcalAuthRequired = false;
        gcalEvents = data.events || [];
      } else {
        gcalEvents = [];
      }
    } catch {
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
      : "";
    modalBody.innerHTML = `
      <div class="modal-detail">
        <div><span class="label">日付:</span> ${ev.date}</div>
        <div><span class="label">時間:</span> ${ev.startTime} 〜 ${ev.endTime}</div>
        <div><span class="label">カテゴリ:</span> <span class="category-badge" style="background:${color}">${categoryLabel(ev.category)}</span></div>
        ${ev.note ? `<div><span class="label">メモ:</span> ${ev.note}</div>` : ""}
        ${readonlyBadge}
      </div>
    `;
    if (ev.source === "gcal") {
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
    } else if (gcalEvents.length > 0 || !gcalAuthRequired) {
      if (gcalEvents.length > 0) {
        const badge = document.createElement("span");
        badge.className = "gcal-badge";
        badge.textContent = `Google (${gcalEvents.length}件)`;
        wrapper.appendChild(badge);
      }
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
      let cls = "day-header";
      if (isToday(d)) cls += " today";
      if (dayIdx === 0) cls += " sun";
      if (dayIdx === 6) cls += " sat";
      const header = document.createElement("div");
      header.className = cls;
      header.textContent = `${d.getMonth() + 1}/${d.getDate()} (${DAY_NAMES[dayIdx]})`;
      grid.appendChild(header);
    }

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

      const num = document.createElement("div");
      num.className = "day-number";
      num.textContent = d.getDate();
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
      currentDate.setMonth(currentDate.getMonth() - 1);
    }
    render();
  });

  btnNext.addEventListener("click", () => {
    if (currentView === "weekly") {
      currentDate.setDate(currentDate.getDate() + 7);
    } else {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    render();
  });

  btnToday.addEventListener("click", () => {
    currentDate = new Date();
    render();
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
      closeModal();
      openEditModal(currentDetailEvent);
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

  // ---- Init ----
  loadSchedule();
})();
