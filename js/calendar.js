import supabase from "./supabase-client.js";

const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const calendarGrid = document.getElementById("calendarGrid");
const calendarTitle = document.getElementById("calendarTitle");

let currentDate = new Date();

async function requireAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    location.href = "login.html";
    throw new Error("NON_AUTHENTICATED");
  }
}

function openDrawer() {
  drawer.classList.add("open");
  drawerOverlay.classList.add("open");
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawerOverlay.classList.remove("open");
}

async function doLogout() {
  await supabase.auth.signOut();
  location.href = "login.html";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getMonthName(date) {
  return date.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

function getSeasonDefault(monthIndex) {
  return [4, 5, 6, 7, 8].includes(monthIndex) ? 60 : 40;
}

async function getReservationsForMonth(year, monthIndex) {
  const start = `${year}-${pad(monthIndex + 1)}-01`;
  const endDate = new Date(year, monthIndex + 1, 0);
  const end = `${year}-${pad(monthIndex + 1)}-${pad(endDate.getDate())}`;

  const { data, error } = await supabase
    .from("reservations")
    .select("reservation_date, people, status, service, notes")
    .gte("reservation_date", start)
    .lte("reservation_date", end);

  if (error) throw error;
  return data || [];
}

async function getCalendarOverridesForMonth(year, monthIndex) {
  const start = `${year}-${pad(monthIndex + 1)}-01`;
  const endDate = new Date(year, monthIndex + 1, 0);
  const end = `${year}-${pad(monthIndex + 1)}-${pad(endDate.getDate())}`;

  const { data, error } = await supabase
    .from("booking_calendar")
    .select("*")
    .gte("day", start)
    .lte("day", end);

  if (error) throw error;
  return data || [];
}

async function getRulesUpToMonthEnd(year, monthIndex) {
  const endDate = new Date(year, monthIndex + 1, 0);
  const end = `${year}-${pad(monthIndex + 1)}-${pad(endDate.getDate())}`;

  const { data, error } = await supabase
    .from("booking_rules")
    .select("*")
    .lte("start_day", end)
    .order("start_day", { ascending: true });

  if (error) throw error;
  return data || [];
}

function detectService(r) {
  if (r.service === "lunch" || r.service === "dinner") return r.service;
  const notes = String(r.notes || "").toLowerCase();
  if (notes.includes("turno: pranzo")) return "lunch";
  if (notes.includes("turno: cena")) return "dinner";
  return "lunch";
}

function buildServiceMaps(reservations) {
  const lunchCovers = new Map();
  const dinnerCovers = new Map();
  const lunchCount = new Map();
  const dinnerCount = new Map();

  reservations
    .filter(r => r.status !== "cancelled")
    .forEach(r => {
      const day = r.reservation_date;
      const service = detectService(r);
      const people = Number(r.people || 0);

      if (service === "dinner") {
        dinnerCovers.set(day, (dinnerCovers.get(day) || 0) + people);
        dinnerCount.set(day, (dinnerCount.get(day) || 0) + 1);
      } else {
        lunchCovers.set(day, (lunchCovers.get(day) || 0) + people);
        lunchCount.set(day, (lunchCount.get(day) || 0) + 1);
      }
    });

  return { lunchCovers, dinnerCovers, lunchCount, dinnerCount };
}

function buildOverrideMap(overrides) {
  const map = new Map();
  overrides.forEach(o => map.set(o.day, o));
  return map;
}

function buildRulesArray(rules) {
  return [...rules].sort((a, b) => a.start_day.localeCompare(b.start_day));
}

function getRuleForDay(dayISO, rulesArray, monthIndex) {
  let selected = null;
  for (const rule of rulesArray) {
    if (rule.start_day <= dayISO) selected = rule;
    else break;
  }

  if (selected) {
    return {
      lunchMax: selected.lunch_max_covers,
      dinnerMax: selected.dinner_max_covers
    };
  }

  const d = getSeasonDefault(monthIndex);
  return { lunchMax: d, dinnerMax: d };
}

function getDayServiceState(dayISO, rulesArray, overrideMap, monthIndex) {
  const base = getRuleForDay(dayISO, rulesArray, monthIndex);
  const override = overrideMap.get(dayISO);

  return {
    lunchMax: override?.lunch_max_covers ?? base.lunchMax,
    dinnerMax: override?.dinner_max_covers ?? base.dinnerMax,
    lunchClosed: override?.lunch_closed ?? false,
    dinnerClosed: override?.dinner_closed ?? false,
    note: override?.note ?? null
  };
}

async function upsertCalendarDay(day, patch, monthIndex) {
  const { data: existing, error: readError } = await supabase
    .from("booking_calendar")
    .select("day")
    .eq("day", day)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    const { error } = await supabase
      .from("booking_calendar")
      .update(patch)
      .eq("day", day);

    if (error) throw error;
  } else {
    const defaultCap = getSeasonDefault(monthIndex);
    const payload = {
      day,
      lunch_max_covers: defaultCap,
      dinner_max_covers: defaultCap,
      lunch_closed: false,
      dinner_closed: false,
      ...patch
    };

    const { error } = await supabase
      .from("booking_calendar")
      .insert([payload]);

    if (error) throw error;
  }
}

async function toggleServiceClosed(day, service, currentValue, monthIndex) {
  const patch = service === "lunch"
    ? { lunch_closed: !currentValue }
    : { dinner_closed: !currentValue };

  await upsertCalendarDay(day, patch, monthIndex);
  await renderCalendar();
}

async function changeCapacityFromDay(day, service, currentValue) {
  const value = prompt(
    `Nuova capienza ${service === "lunch" ? "pranzo" : "cena"} da ${day} in avanti:`,
    String(currentValue)
  );

  if (!value) return;

  const num = Number(value);
  if (!Number.isFinite(num) || num < 1 || num > 500) {
    alert("Valore non valido.");
    return;
  }

  const payload = service === "lunch"
    ? { start_day: day, lunch_max_covers: num, dinner_max_covers: currentValue }
    : { start_day: day, lunch_max_covers: currentValue, dinner_max_covers: num };

  const { error } = await supabase
    .from("booking_rules")
    .insert([payload]);

  if (error) {
    alert("Errore salvataggio regola: " + error.message);
    return;
  }

  await renderCalendar();
}

function getServiceClass(covers, max, closed) {
  if (closed) return "gray";
  if (covers >= max) return "red";
  if (covers >= Math.floor(max * 0.75)) return "yellow";
  return "green";
}

function mergeClasses(a, b) {
  if (a === "gray" || b === "gray") return "gray";
  if (a === "red" || b === "red") return "red";
  if (a === "yellow" || b === "yellow") return "yellow";
  return "green";
}

async function renderCalendar() {
  const year = currentDate.getFullYear();
  const monthIndex = currentDate.getMonth();

  calendarTitle.textContent = getMonthName(currentDate);

  const [reservations, overrides, rules] = await Promise.all([
    getReservationsForMonth(year, monthIndex),
    getCalendarOverridesForMonth(year, monthIndex),
    getRulesUpToMonthEnd(year, monthIndex)
  ]);

  const { lunchCovers, dinnerCovers, lunchCount, dinnerCount } = buildServiceMaps(reservations);
  const overrideMap = buildOverrideMap(overrides);
  const rulesArray = buildRulesArray(rules);

  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);

  let firstWeekday = firstDay.getDay();
  firstWeekday = firstWeekday === 0 ? 7 : firstWeekday;

  const blanks = firstWeekday - 1;
  const daysInMonth = lastDay.getDate();

  const headerHtml = `
    <div class="calendar-head">Lunedì</div>
    <div class="calendar-head">Martedì</div>
    <div class="calendar-head">Mercoledì</div>
    <div class="calendar-head">Giovedì</div>
    <div class="calendar-head">Venerdì</div>
    <div class="calendar-head">Sabato</div>
    <div class="calendar-head">Domenica</div>
  `;

  let bodyHtml = "";

  for (let i = 0; i < blanks; i++) {
    bodyHtml += `<div class="calendar-day empty"></div>`;
  }

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dayDate = new Date(year, monthIndex, dayNum);
    const dayISO = toISO(dayDate);

    const state = getDayServiceState(dayISO, rulesArray, overrideMap, monthIndex);

    const lCovers = lunchCovers.get(dayISO) || 0;
    const dCovers = dinnerCovers.get(dayISO) || 0;
    const lCount = lunchCount.get(dayISO) || 0;
    const dCount = dinnerCount.get(dayISO) || 0;

    const lClass = getServiceClass(lCovers, state.lunchMax, state.lunchClosed);
    const dClass = getServiceClass(dCovers, state.dinnerMax, state.dinnerClosed);
    const dayClass = mergeClasses(lClass, dClass);

    bodyHtml += `
      <div class="calendar-day ${dayClass}">
        <div class="calendar-day-top">
          <div class="calendar-day-num">${dayNum}</div>
          <span class="badge badge-confirmed">${dayISO}</span>
        </div>

        <div class="service-box">
          <div class="service-title">Pranzo</div>
          <div class="service-meta">
            <div>📅 Prenotazioni: <strong>${lCount}</strong></div>
            <div>👥 Coperti: <strong>${lCovers}/${state.lunchMax}</strong></div>
            <div>🔒 Stato: <strong>${state.lunchClosed ? "Bloccato" : "Aperto"}</strong></div>
          </div>
          <div class="service-actions">
            <button class="btn btn-soft" data-action="toggle-service" data-day="${dayISO}" data-service="lunch" data-current="${state.lunchClosed}" data-month="${monthIndex}">
              ${state.lunchClosed ? "Riapri pranzo" : "Blocca pranzo"}
            </button>
            <button class="btn btn-soft" data-action="capacity-service" data-day="${dayISO}" data-service="lunch" data-current="${state.lunchMax}">
              Capienza pranzo da qui in avanti
            </button>
          </div>
        </div>

        <div class="service-box">
          <div class="service-title">Cena</div>
          <div class="service-meta">
            <div>📅 Prenotazioni: <strong>${dCount}</strong></div>
            <div>👥 Coperti: <strong>${dCovers}/${state.dinnerMax}</strong></div>
            <div>🔒 Stato: <strong>${state.dinnerClosed ? "Bloccato" : "Aperto"}</strong></div>
          </div>
          <div class="service-actions">
            <button class="btn btn-soft" data-action="toggle-service" data-day="${dayISO}" data-service="dinner" data-current="${state.dinnerClosed}" data-month="${monthIndex}">
              ${state.dinnerClosed ? "Riapri cena" : "Blocca cena"}
            </button>
            <button class="btn btn-soft" data-action="capacity-service" data-day="${dayISO}" data-service="dinner" data-current="${state.dinnerMax}">
              Capienza cena da qui in avanti
            </button>
          </div>
        </div>
      </div>
    `;
  }

  calendarGrid.innerHTML = headerHtml + bodyHtml;

  calendarGrid.querySelectorAll("[data-action='toggle-service']").forEach(btn => {
    btn.addEventListener("click", async () => {
      await toggleServiceClosed(
        btn.dataset.day,
        btn.dataset.service,
        btn.dataset.current === "true",
        Number(btn.dataset.month)
      );
    });
  });

  calendarGrid.querySelectorAll("[data-action='capacity-service']").forEach(btn => {
    btn.addEventListener("click", async () => {
      await changeCapacityFromDay(
        btn.dataset.day,
        btn.dataset.service,
        Number(btn.dataset.current)
      );
    });
  });
}

document.getElementById("openDrawerBtn").addEventListener("click", openDrawer);
document.getElementById("closeDrawerBtn").addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);
document.getElementById("logoutBtn").addEventListener("click", doLogout);

document.getElementById("prevMonthBtn").addEventListener("click", async () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  await renderCalendar();
});

document.getElementById("nextMonthBtn").addEventListener("click", async () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  await renderCalendar();
});

document.getElementById("todayBtn").addEventListener("click", async () => {
  currentDate = new Date();
  await renderCalendar();
});

await requireAuth();
await renderCalendar();
