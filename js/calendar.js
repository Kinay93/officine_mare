import { requireAuth, logout } from "./auth.service.js";
import supabase from "./supabase-client.js";

await requireAuth();

const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const calendarGrid = document.getElementById("calendarGrid");
const calendarTitle = document.getElementById("calendarTitle");

let currentDate = new Date();

function openDrawer() {
  drawer.classList.add("open");
  drawerOverlay.classList.add("open");
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawerOverlay.classList.remove("open");
}

async function doLogout() {
  await logout();
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

function defaultMaxCoversForMonth(monthIndex) {
  // estate: maggio-settembre = 60
  return [4, 5, 6, 7, 8].includes(monthIndex) ? 60 : 40;
}

async function getReservationsForMonth(year, monthIndex) {
  const start = `${year}-${pad(monthIndex + 1)}-01`;
  const endDate = new Date(year, monthIndex + 1, 0);
  const end = `${year}-${pad(monthIndex + 1)}-${pad(endDate.getDate())}`;

  const { data, error } = await supabase
    .from("reservations")
    .select("reservation_date, people, status")
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

function buildCoverMap(reservations) {
  const map = new Map();

  reservations
    .filter(r => r.status !== "cancelled")
    .forEach(r => {
      const key = r.reservation_date;
      const current = map.get(key) || 0;
      map.set(key, current + Number(r.people || 0));
    });

  return map;
}

function buildOverrideMap(overrides) {
  const map = new Map();
  overrides.forEach(o => map.set(o.day, o));
  return map;
}

async function upsertDay(day, patch) {
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
    const dateObj = new Date(day + "T00:00:00");
    const max_covers = patch.max_covers ?? defaultMaxCoversForMonth(dateObj.getMonth());

    const { error } = await supabase
      .from("booking_calendar")
      .insert([{ day, max_covers, ...patch }]);

    if (error) throw error;
  }
}

async function toggleDayClosed(day, currentlyClosed) {
  await upsertDay(day, { is_closed: !currentlyClosed });
  await renderCalendar();
}

async function changeMaxCovers(day, currentMax) {
  const value = prompt("Nuova capienza massima per questo giorno:", String(currentMax));
  if (!value) return;

  const num = Number(value);
  if (!Number.isFinite(num) || num < 1 || num > 500) {
    alert("Valore non valido.");
    return;
  }

  await upsertDay(day, { max_covers: num });
  await renderCalendar();
}

function getDayClass(covers, maxCovers, isClosed) {
  if (isClosed) return "gray";
  if (covers >= maxCovers) return "red";
  if (covers >= Math.floor(maxCovers * 0.75)) return "yellow";
  return "green";
}

async function renderCalendar() {
  const year = currentDate.getFullYear();
  const monthIndex = currentDate.getMonth();

  calendarTitle.textContent = getMonthName(currentDate);

  const reservations = await getReservationsForMonth(year, monthIndex);
  const overrides = await getCalendarOverridesForMonth(year, monthIndex);

  const coverMap = buildCoverMap(reservations);
  const overrideMap = buildOverrideMap(overrides);

  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);

  let firstWeekday = firstDay.getDay();
  // converti domenica=0 in 7, poi lunedì start
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

    const covers = coverMap.get(dayISO) || 0;
    const override = overrideMap.get(dayISO);

    const maxCovers = override?.max_covers ?? defaultMaxCoversForMonth(monthIndex);
    const isClosed = override?.is_closed ?? false;
    const bookingsCount = reservations.filter(r => r.reservation_date === dayISO && r.status !== "cancelled").length;

    const cssClass = getDayClass(covers, maxCovers, isClosed);

    bodyHtml += `
      <div class="calendar-day ${cssClass}">
        <div class="calendar-day-top">
          <div class="calendar-day-num">${dayNum}</div>
          <span class="badge ${isClosed ? "badge-cancelled" : "badge-confirmed"}">
            ${isClosed ? "Bloccato" : "Aperto"}
          </span>
        </div>

        <div class="calendar-day-meta">
          <div>📅 Prenotazioni: <strong>${bookingsCount}</strong></div>
          <div>👥 Coperti: <strong>${covers}/${maxCovers}</strong></div>
          ${override?.note ? `<div>📝 ${override.note}</div>` : ""}
        </div>

        <div class="calendar-day-actions">
          <button class="btn btn-soft" data-action="toggle-day" data-day="${dayISO}" data-closed="${isClosed}">
            ${isClosed ? "Riapri giorno" : "Blocca giorno"}
          </button>

          <button class="btn btn-soft" data-action="edit-covers" data-day="${dayISO}" data-max="${maxCovers}">
            Modifica capienza
          </button>
        </div>
      </div>
    `;
  }

  calendarGrid.innerHTML = headerHtml + bodyHtml;

  calendarGrid.querySelectorAll("[data-action='toggle-day']").forEach(btn => {
    btn.addEventListener("click", async () => {
      await toggleDayClosed(btn.dataset.day, btn.dataset.closed === "true");
    });
  });

  calendarGrid.querySelectorAll("[data-action='edit-covers']").forEach(btn => {
    btn.addEventListener("click", async () => {
      await changeMaxCovers(btn.dataset.day, Number(btn.dataset.max));
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

renderCalendar();
