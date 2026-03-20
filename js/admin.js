import supabase from "./supabase-client.js";

const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const reservationsList = document.getElementById("reservationsList");
const pendingCount = document.getElementById("pendingCount");
const confirmedCount = document.getElementById("confirmedCount");
const periodCount = document.getElementById("periodCount");
const periodLabel = document.getElementById("periodLabel");

const manualReservationModal = document.getElementById("manualReservationModal");
const manualReservationForm = document.getElementById("manualReservationForm");
const mrDate = document.getElementById("mrDate");
const mrTurno = document.getElementById("mrTurno");
const mrTime = document.getElementById("mrTime");

const tablesModal = document.getElementById("tablesModal");
const tablesModalGrid = document.getElementById("tablesModalGrid");

let currentStatusView = "all";
let currentPeriod = "all";
let currentSearch = "";
let modalReservation = null;

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

function openManualReservationModal() {
  manualReservationModal.classList.add("open");
}

function closeManualReservationModal() {
  manualReservationModal.classList.remove("open");
  manualReservationForm.reset();
  mrTime.innerHTML = `<option value="">Seleziona prima data e turno</option>`;
}

function openTablesModal() {
  tablesModal.classList.add("open");
}

function closeTablesModal() {
  tablesModal.classList.remove("open");
  modalReservation = null;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isToday(dateStr) {
  return dateStr === toISODate(new Date());
}

function isInWeek(dateStr) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const date = new Date(dateStr + "T00:00:00");
  return date >= start && date <= end;
}

function isInMonth(dateStr) {
  const now = new Date();
  const date = new Date(dateStr + "T00:00:00");
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function getPeriodLabel() {
  if (currentPeriod === "today") return "Oggi";
  if (currentPeriod === "week") return "Settimana";
  if (currentPeriod === "month") return "Mese";
  return "Tutte";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeText(value, maxLen = 120) {
  return normalizeSpaces(String(value || "").replace(/<[^>]*>/g, "")).slice(0, maxLen);
}

function defaultMaxCoversForMonth(monthIndex) {
  return [4, 5, 6, 7, 8].includes(monthIndex) ? 60 : 40;
}

function detectService(reservation) {
  if (reservation.service === "lunch" || reservation.service === "dinner") {
    return reservation.service;
  }
  const notes = String(reservation.notes || "").toLowerCase();
  if (notes.includes("turno: cena")) return "dinner";
  return "lunch";
}

function applyPeriodFilter(data) {
  if (currentPeriod === "today") return data.filter(x => isToday(x.reservation_date));
  if (currentPeriod === "week") return data.filter(x => isInWeek(x.reservation_date));
  if (currentPeriod === "month") return data.filter(x => isInMonth(x.reservation_date));
  return data;
}

function applyStatusView(data) {
  if (currentStatusView === "all") return data;
  return data.filter(x => x.status === currentStatusView);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${pad(h)}:${pad(m)}`;
}

function buildSlots(start, end, step) {
  const slots = [];
  for (let t = toMinutes(start); t <= toMinutes(end); t += step) {
    slots.push(fromMinutes(t));
  }
  return slots;
}

const lunchSlots = buildSlots("12:30", "15:00", 10);
const dinnerSlots = buildSlots("18:30", "23:00", 10);

function isMonday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00");
  return d.getDay() === 1;
}

function isSunday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00");
  return d.getDay() === 0;
}

function refreshManualReservationSlots() {
  const date = mrDate.value;
  const turno = mrTurno.value;
  mrTime.innerHTML = `<option value="">Seleziona prima data e turno</option>`;

  if (!date || !turno) return;

  if (isMonday(date)) {
    mrTime.innerHTML = `<option value="">Lunedì chiuso</option>`;
    return;
  }

  if (isSunday(date) && turno === "cena") {
    mrTime.innerHTML = `<option value="">Domenica sera non disponibile</option>`;
    return;
  }

  const slots = turno === "pranzo" ? lunchSlots : dinnerSlots;
  mrTime.innerHTML = `<option value="">Seleziona orario</option>` + slots.map(slot => `
    <option value="${slot}">${slot}</option>
  `).join("");
}

async function fetchAllReservations() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 2, 0);

  const fromISO = toISODate(from);
  const toISO = toISODate(to);

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .gte("reservation_date", fromISO)
    .lte("reservation_date", toISO)
    .order("reservation_date", { ascending: true })
    .order("reservation_time", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchBookingCalendarMap(fromISO, toISO) {
  const { data, error } = await supabase
    .from("booking_calendar")
    .select("*")
    .gte("day", fromISO)
    .lte("day", toISO);

  if (error) throw error;

  const map = new Map();
  (data || []).forEach(row => map.set(row.day, row));
  return map;
}

async function fetchBookingRulesUpTo(toISO) {
  const { data, error } = await supabase
    .from("booking_rules")
    .select("*")
    .lte("start_day", toISO)
    .order("start_day", { ascending: true });

  if (error) throw error;
  return data || [];
}

function getRuleForDay(dayISO, rules) {
  let selected = null;

  for (const rule of rules) {
    if (rule.start_day <= dayISO) selected = rule;
    else break;
  }

  if (selected) {
    return {
      lunch: selected.lunch_max_covers,
      dinner: selected.dinner_max_covers
    };
  }

  const monthIndex = new Date(dayISO + "T00:00:00").getMonth();
  const d = defaultMaxCoversForMonth(monthIndex);
  return { lunch: d, dinner: d };
}

function getMaxCoversForReservation(reservation, calendarMap, rules) {
  const service = detectService(reservation);
  const override = calendarMap.get(reservation.reservation_date);
  const base = getRuleForDay(reservation.reservation_date, rules);

  if (service === "dinner") {
    return override?.dinner_max_covers ?? base.dinner;
  }

  return override?.lunch_max_covers ?? base.lunch;
}

function buildDailyServiceMaps(reservations) {
  const lunchMap = new Map();
  const dinnerMap = new Map();

  reservations
    .filter(r => !r.hidden)
    .filter(r => r.status !== "cancelled")
    .forEach(r => {
      const key = r.reservation_date;
      const service = detectService(r);
      const people = Number(r.people || 0);

      if (service === "dinner") {
        dinnerMap.set(key, (dinnerMap.get(key) || 0) + people);
      } else {
        lunchMap.set(key, (lunchMap.get(key) || 0) + people);
      }
    });

  return { lunchMap, dinnerMap };
}

function getServiceOccupancyClass(covers, maxCovers) {
  if (covers >= maxCovers) return "full";
  if (covers >= Math.floor(maxCovers * 0.75)) return "warn";
  return "";
}

function getWhatsappLink(phone, message) {
  const cleanPhone = String(phone || "").replace(/[^\d]/g, "");
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

async function confirmReservation(reservation) {
  const { error } = await supabase
    .from("reservations")
    .update({
      status: "confirmed",
      confirmation_sent: true,
      confirmation_sent_at: new Date().toISOString()
    })
    .eq("id", reservation.id);

  if (error) throw error;

  const time = String(reservation.reservation_time || "").slice(0, 5);
  const msg = `Ciao ${reservation.customer_name}, la tua prenotazione da Officine Mare è confermata per il giorno ${reservation.reservation_date} alle ${time} per ${reservation.people} persone. Ti aspettiamo!`;

  if (reservation.customer_phone) {
    window.open(getWhatsappLink(reservation.customer_phone, msg), "_blank");
  }

  currentStatusView = "confirmed";
  statusFilter.value = "all";
  await loadReservations();
}

async function rejectReservation(reservationId) {
  const { error } = await supabase
    .from("reservations")
    .update({
      status: "cancelled",
      hidden: true
    })
    .eq("id", reservationId);

  if (error) throw error;
  await loadReservations();
}

async function openTableAssign(reservation) {
  modalReservation = reservation;

  const { data: tables, error: tablesError } = await supabase
    .from("restaurant_tables")
    .select("*")
    .order("code", { ascending: true });

  if (tablesError) throw tablesError;

  const { data: currentAssigned, error: currentAssignedError } = await supabase
    .from("reservation_tables")
    .select("table_code")
    .eq("reservation_id", reservation.id);

  if (currentAssignedError) throw currentAssignedError;

  const assignedNow = new Set((currentAssigned || []).map(x => x.table_code));

  const { data: sameSlotReservations, error: sameSlotError } = await supabase
    .from("reservations")
    .select("id")
    .eq("reservation_date", reservation.reservation_date)
    .eq("reservation_time", reservation.reservation_time)
    .in("status", ["confirmed", "arrived"]);

  if (sameSlotError) throw sameSlotError;

  const otherIds = (sameSlotReservations || []).map(x => x.id).filter(id => id !== reservation.id);

  let occupiedSet = new Set();
  if (otherIds.length) {
    const { data: occupied, error: occErr } = await supabase
      .from("reservation_tables")
      .select("table_code")
      .in("reservation_id", otherIds);

    if (occErr) throw occErr;
    occupiedSet = new Set((occupied || []).map(x => x.table_code));
  }

  tablesModalGrid.innerHTML = (tables || []).map(t => {
    const checked = assignedNow.has(t.code);
    const disabled = (!t.is_open) || (occupiedSet.has(t.code) && !checked);

    return `
      <label class="table-check-item">
        <input type="checkbox" class="table-check" value="${escapeHtml(t.code)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
        <span>
          <strong>${escapeHtml(t.code)}</strong><br>
          <small style="color:var(--muted)">
            ${!t.is_open ? "Chiuso globalmente" : occupiedSet.has(t.code) && !checked ? "Occupato in questa fascia" : `${escapeHtml(t.seats || 0)} coperti`}
          </small>
        </span>
      </label>
    `;
  }).join("");

  openTablesModal();
}

async function saveAssignedTables() {
  if (!modalReservation) return;

  const selected = Array.from(document.querySelectorAll(".table-check:checked")).map(x => x.value);

  const { error: delErr } = await supabase
    .from("reservation_tables")
    .delete()
    .eq("reservation_id", modalReservation.id);

  if (delErr) throw delErr;

  if (selected.length) {
    const rows = selected.map(code => ({
      reservation_id: modalReservation.id,
      table_code: code
    }));

    const { error: insErr } = await supabase
      .from("reservation_tables")
      .insert(rows);

    if (insErr) throw insErr;
  }

  const { error: updErr } = await supabase
    .from("reservations")
    .update({ assigned_table_code: selected[0] || null })
    .eq("id", modalReservation.id);

  if (updErr) throw updErr;

  closeTablesModal();
  await loadReservations();
}

function buildReservationCard(reservation, lunchMap, dinnerMap, calendarMap, rules) {
  let badgeClass = "badge-pending";
  let badgeText = "In attesa";

  if (reservation.status === "confirmed") {
    badgeClass = "badge-confirmed";
    badgeText = "Confermata";
  } else if (reservation.status === "arrived") {
    badgeClass = "badge-confirmed";
    badgeText = "Arrivata";
  }

  const service = detectService(reservation);
  const dayCovers = service === "dinner"
    ? (dinnerMap.get(reservation.reservation_date) || 0)
    : (lunchMap.get(reservation.reservation_date) || 0);

  const maxCovers = getMaxCoversForReservation(reservation, calendarMap, rules);
  const occupancyClass = getServiceOccupancyClass(dayCovers, maxCovers);
  const time = String(reservation.reservation_time || "").slice(0, 5);

  return `
    <article class="reservation-card">
      <div class="reservation-top">
        <div>
          <h3 class="reservation-name">${escapeHtml(reservation.customer_name)}</h3>

          <div class="reservation-submeta">
            <span class="badge ${badgeClass}">${badgeText}</span>
            <span class="covers-pill ${occupancyClass}">👥 ${dayCovers}/${maxCovers}</span>
            <span class="covers-pill">${service === "dinner" ? "🌙 Cena" : "☀️ Pranzo"}</span>
            <span class="covers-pill">🍽️ ${escapeHtml(reservation.people)} coperti</span>
            ${reservation.assigned_table_code ? `<span class="covers-pill">🪑 ${escapeHtml(reservation.assigned_table_code)}</span>` : ""}
          </div>

          <div class="reservation-meta">
            <span>📅 ${escapeHtml(reservation.reservation_date)}</span>
            <span>🕒 ${escapeHtml(time)}</span>
            <span>📞 ${escapeHtml(reservation.customer_phone || "-")}</span>
            <span>🔖 ${escapeHtml(reservation.source || "web")}</span>
          </div>

          ${reservation.notes ? `<div class="mini-note">📝 ${escapeHtml(reservation.notes)}</div>` : ""}
        </div>
      </div>

      <div class="reservation-actions">
        <button class="btn btn-soft" data-action="tables" data-id="${escapeHtml(reservation.id)}">Assegna tavoli</button>

        ${reservation.status === "pending" ? `
          <button class="btn btn-success" data-action="confirm" data-id="${escapeHtml(reservation.id)}">✓ Conferma</button>
          <button class="btn btn-danger" data-action="reject" data-id="${escapeHtml(reservation.id)}">✕ Rifiuta</button>
        ` : ""}

        ${reservation.status === "confirmed" ? `
          <button class="btn btn-danger" data-action="reject" data-id="${escapeHtml(reservation.id)}">✕ Rifiuta</button>
        ` : ""}
      </div>
    </article>
  `;
}

function attachCardActions(reservations) {
  reservationsList.querySelectorAll("[data-action='confirm']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const reservation = reservations.find(x => String(x.id) === String(btn.dataset.id));
      if (reservation) await confirmReservation(reservation);
    });
  });

  reservationsList.querySelectorAll("[data-action='reject']").forEach(btn => {
    btn.addEventListener("click", async () => {
      await rejectReservation(btn.dataset.id);
    });
  });

  reservationsList.querySelectorAll("[data-action='tables']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const reservation = reservations.find(x => String(x.id) === String(btn.dataset.id));
      if (reservation) await openTableAssign(reservation);
    });
  });
}

async function loadReservations() {
  currentSearch = searchInput.value.trim();

  const allReservations = await fetchAllReservations();
  const visibleReservations = allReservations.filter(x => !x.hidden);

  const { lunchMap, dinnerMap } = buildDailyServiceMaps(visibleReservations);
  const dates = visibleReservations.map(x => x.reservation_date).sort();

  let calendarMap = new Map();
  let rules = [];

  if (dates.length) {
    calendarMap = await fetchBookingCalendarMap(dates[0], dates[dates.length - 1]);
    rules = await fetchBookingRulesUpTo(dates[dates.length - 1]);
  }

  pendingCount.textContent = visibleReservations.filter(x => x.status === "pending").length;
  confirmedCount.textContent = visibleReservations.filter(x => x.status === "confirmed").length;
  periodLabel.textContent = getPeriodLabel();
  periodCount.textContent = applyPeriodFilter(visibleReservations).length;

  let data = [...visibleReservations];

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    data = data.filter(r =>
      String(r.customer_name || "").toLowerCase().includes(q) ||
      String(r.customer_phone || "").toLowerCase().includes(q) ||
      String(r.notes || "").toLowerCase().includes(q)
    );
  }

  data = applyStatusView(data);

  if (statusFilter.value !== "all") {
    data = data.filter(x => x.status === statusFilter.value);
  }

  data = applyPeriodFilter(data);

  if (!data.length) {
    reservationsList.innerHTML = `<div class="empty-card">Nessuna prenotazione trovata</div>`;
    return;
  }

  reservationsList.innerHTML = data.map(r => buildReservationCard(r, lunchMap, dinnerMap, calendarMap, rules)).join("");
  attachCardActions(data);
}

function cyclePeriod() {
  if (currentPeriod === "all") currentPeriod = "today";
  else if (currentPeriod === "today") currentPeriod = "week";
  else if (currentPeriod === "week") currentPeriod = "month";
  else currentPeriod = "all";

  loadReservations();
}

async function saveManualReservation(e) {
  e.preventDefault();

  const name = sanitizeText(document.getElementById("mrName").value, 80);
  const phone = sanitizeText(document.getElementById("mrPhone").value, 20);
  const email = sanitizeText(document.getElementById("mrEmail").value, 120);
  const date = mrDate.value;
  const turno = mrTurno.value;
  const time = mrTime.value;
  const people = Number(document.getElementById("mrPeople").value || 0);
  const notes = sanitizeText(document.getElementById("mrNotes").value, 500);
  const status = document.getElementById("mrStatus").value;
  const source = document.getElementById("mrSource").value;

  if (!name || !phone || !date || !turno || !time || !people) {
    alert("Compila tutti i campi obbligatori.");
    return;
  }

  const fullNotes = [
    "Turno: " + turno,
    notes,
    email ? "Email: " + email : ""
  ].filter(Boolean).join(" | ");

  const payload = {
    customer_name: name,
    customer_phone: phone,
    reservation_date: date,
    reservation_time: time,
    people,
    notes: fullNotes,
    status,
    source,
    service: turno === "cena" ? "dinner" : "lunch",
    hidden: false
  };

  const { error } = await supabase
    .from("reservations")
    .insert([payload]);

  if (error) {
    alert("Errore salvataggio: " + error.message);
    return;
  }

  closeManualReservationModal();
  await loadReservations();
}

document.getElementById("openDrawerBtn").addEventListener("click", openDrawer);
document.getElementById("closeDrawerBtn").addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);
document.getElementById("logoutBtn").addEventListener("click", doLogout);

document.getElementById("cardPending").addEventListener("click", () => {
  currentStatusView = "pending";
  statusFilter.value = "all";
  loadReservations();
});

document.getElementById("cardConfirmed").addEventListener("click", () => {
  currentStatusView = "confirmed";
  statusFilter.value = "all";
  loadReservations();
});

document.getElementById("cardPeriod").addEventListener("click", cyclePeriod);

searchInput.addEventListener("input", loadReservations);
statusFilter.addEventListener("change", () => {
  currentStatusView = "all";
  loadReservations();
});

document.getElementById("openManualReservationBtn").addEventListener("click", openManualReservationModal);
document.getElementById("closeManualReservationBtn").addEventListener("click", closeManualReservationModal);
document.getElementById("cancelManualReservationBtn").addEventListener("click", closeManualReservationModal);

manualReservationModal.addEventListener("click", (e) => {
  if (e.target === manualReservationModal) closeManualReservationModal();
});

mrDate.addEventListener("change", refreshManualReservationSlots);
mrTurno.addEventListener("change", refreshManualReservationSlots);
manualReservationForm.addEventListener("submit", saveManualReservation);

document.getElementById("closeTablesModalBtn").addEventListener("click", closeTablesModal);
document.getElementById("cancelTablesModalBtn").addEventListener("click", closeTablesModal);
document.getElementById("saveTablesBtn").addEventListener("click", saveAssignedTables);

tablesModal.addEventListener("click", (e) => {
  if (e.target === tablesModal) closeTablesModal();
});

await requireAuth();
await loadReservations();
