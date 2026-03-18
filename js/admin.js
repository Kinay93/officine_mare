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

let currentStatusView = "all";
let currentPeriod = "all";

async function requireAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    location.href = "login.html";
    throw new Error("NON_AUTHENTICATED");
  }
  return data.session;
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

function buildDailyCoverMap(reservations) {
  const map = new Map();

  reservations
    .filter(r => !r.hidden)
    .filter(r => r.status !== "cancelled")
    .forEach(r => {
      const key = r.reservation_date;
      const current = map.get(key) || 0;
      map.set(key, current + Number(r.people || 0));
    });

  return map;
}

function getMaxCoversForDay(dateStr, calendarMap) {
  const override = calendarMap.get(dateStr);
  if (override?.max_covers) return override.max_covers;
  const d = new Date(dateStr + "T00:00:00");
  return defaultMaxCoversForMonth(d.getMonth());
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

function buildReservationCard(r, dailyCoverMap, calendarMap) {
  let badgeClass = "badge-pending";
  let badgeText = "In attesa";

  if (r.status === "confirmed") {
    badgeClass = "badge-confirmed";
    badgeText = "Confermata";
  } else if (r.status === "arrived") {
    badgeClass = "badge-confirmed";
    badgeText = "Arrivata";
  }

  const dayCovers = dailyCoverMap.get(r.reservation_date) || 0;
  const maxCovers = getMaxCoversForDay(r.reservation_date, calendarMap);
  const time = String(r.reservation_time || "").slice(0, 5);

  return `
    <article class="reservation-card">
      <div class="reservation-top">
        <div>
          <h3 class="reservation-name">${escapeHtml(r.customer_name)}</h3>

          <div class="reservation-submeta">
            <span class="badge ${badgeClass}">${badgeText}</span>
            <span class="covers-pill">👥 ${dayCovers}/${maxCovers}</span>
            <span class="covers-pill">🍽️ ${escapeHtml(r.people)} coperti</span>
          </div>

          <div class="reservation-meta">
            <span>📅 ${escapeHtml(r.reservation_date)}</span>
            <span>🕒 ${escapeHtml(time)}</span>
            <span>📞 ${escapeHtml(r.customer_phone || "-")}</span>
            <span>🔖 ${escapeHtml(r.source || "web")}</span>
          </div>

          ${r.notes ? `<div class="mini-note">📝 ${escapeHtml(r.notes)}</div>` : ""}
        </div>
      </div>

      <div class="reservation-actions">
        ${r.status === "pending" ? `
          <button class="btn btn-success" data-action="confirm" data-id="${escapeHtml(r.id)}">✓ Conferma</button>
          <button class="btn btn-danger" data-action="reject" data-id="${escapeHtml(r.id)}">✕ Rifiuta</button>
        ` : ""}

        ${r.status === "confirmed" ? `
          <button class="btn btn-danger" data-action="reject" data-id="${escapeHtml(r.id)}">✕ Rifiuta</button>
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
}

async function loadReservations() {
  currentSearch = searchInput.value.trim();

  const allReservations = await fetchAllReservations();
  const visibleReservations = allReservations.filter(x => !x.hidden);

  const dailyCoverMap = buildDailyCoverMap(visibleReservations);
  const dates = visibleReservations.map(x => x.reservation_date).sort();

  let calendarMap = new Map();
  if (dates.length) {
    calendarMap = await fetchBookingCalendarMap(dates[0], dates[dates.length - 1]);
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

  reservationsList.innerHTML = data.map(r => buildReservationCard(r, dailyCoverMap, calendarMap)).join("");
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

/* listeners */
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

await requireAuth();
loadReservations();
