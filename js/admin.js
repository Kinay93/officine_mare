import { requireAuth, logout } from "./auth.service.js";
import { searchReservations, updateReservationStatus } from "./reservations.service.js";
import { getTables } from "./ui.js";
import { getReservationTables, setReservationTables } from "./reservation-tables.service.js";
import { sendReservationConfirmation, markConfirmationSent } from "./notifications.service.js";

await requireAuth();

let currentStatusView = "all";
let currentPeriod = "all";
let modalReservationId = null;
let tablesCache = [];
let currentSearch = "";

const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");

const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");

const pendingCount = document.getElementById("pendingCount");
const confirmedCount = document.getElementById("confirmedCount");
const periodCount = document.getElementById("periodCount");
const periodLabel = document.getElementById("periodLabel");

const reservationsList = document.getElementById("reservationsList");
const tablesModal = document.getElementById("tablesModal");
const tablesModalGrid = document.getElementById("tablesModalGrid");

function openDrawer() {
  drawer.classList.add("open");
  drawerOverlay.classList.add("open");
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawerOverlay.classList.remove("open");
}

function openTablesModal() {
  tablesModal.classList.add("open");
}

function closeTablesModal() {
  tablesModal.classList.remove("open");
  modalReservationId = null;
}

function formatTodayISO() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isToday(dateStr) {
  return dateStr === formatTodayISO();
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function openReservationTablesModal(reservationId) {
  modalReservationId = reservationId;
  tablesCache = await getTables();
  const assigned = await getReservationTables(reservationId);
  const assignedCodes = assigned.map(x => x.table_code);

  tablesModalGrid.innerHTML = tablesCache.map(t => `
    <label class="table-check-item">
      <input
        type="checkbox"
        class="modal-table-check"
        value="${escapeHtml(t.code)}"
        ${assignedCodes.includes(t.code) ? "checked" : ""}
        ${!t.is_open ? "disabled" : ""}
      >
      <span>${escapeHtml(t.code)}</span>
    </label>
  `).join("");

  openTablesModal();
}

async function saveTablesModal() {
  if (!modalReservationId) return;

  const selected = Array.from(document.querySelectorAll(".modal-table-check:checked"))
    .map(x => x.value);

  await setReservationTables(modalReservationId, selected);
  closeTablesModal();
  await loadReservations();
}

async function confirmReservation(id, customerName, customerPhone, reservationDate, reservationTime) {
  await updateReservationStatus(id, "confirmed");

  try {
    await sendReservationConfirmation({
      reservationId: id,
      customerName,
      customerPhone,
      reservationDate,
      reservationTime
    });
    await markConfirmationSent(id);
  } catch (e) {
    console.warn("Conferma non inviata:", e);
  }

  currentStatusView = "confirmed";
  statusFilter.value = "confirmed";
  await loadReservations();
}

async function rejectReservation(id) {
  await updateReservationStatus(id, "cancelled");
  await loadReservations();
}

function buildReservationCard(r) {
  let badgeClass = "badge-pending";
  let badgeText = "In attesa";

  if (r.status === "confirmed") {
    badgeClass = "badge-confirmed";
    badgeText = "Confermata";
  } else if (r.status === "cancelled") {
    badgeClass = "badge-cancelled";
    badgeText = "Rifiutata";
  }

  const time = String(r.reservation_time || "").slice(0, 5);

  return `
    <article class="reservation-card">
      <div class="reservation-top">
        <div>
          <h3 class="reservation-name">${escapeHtml(r.customer_name)}</h3>
          <div style="margin-top:10px;">
            <span class="badge ${badgeClass}">${badgeText}</span>
          </div>

          <div class="reservation-meta">
            <span>📅 ${escapeHtml(r.reservation_date)}</span>
            <span>🕒 ${escapeHtml(time)}</span>
            <span>👥 ${escapeHtml(r.people)} persone</span>
            <span>📞 ${escapeHtml(r.customer_phone || "-")}</span>
            ${r.notes ? `<span>✉️ ${escapeHtml(r.notes)}</span>` : ""}
          </div>
        </div>
      </div>

      <div class="reservation-actions">
        <button class="btn btn-soft" data-action="tables" data-id="${escapeHtml(r.id)}">Assegna tavoli</button>

        ${r.status === "pending" ? `
          <button
            class="btn btn-success"
            data-action="confirm"
            data-id="${escapeHtml(r.id)}"
            data-name="${escapeHtml(r.customer_name)}"
            data-phone="${escapeHtml(r.customer_phone || "")}"
            data-date="${escapeHtml(r.reservation_date)}"
            data-time="${escapeHtml(time)}"
          >
            ✓ Conferma
          </button>
          <button class="btn btn-danger" data-action="reject" data-id="${escapeHtml(r.id)}">✕ Rifiuta</button>
        ` : ""}

        ${r.status === "confirmed" ? `
          <button class="btn btn-danger" data-action="reject" data-id="${escapeHtml(r.id)}">✕ Rifiuta</button>
        ` : ""}
      </div>
    </article>
  `;
}

function attachCardActions() {
  reservationsList.querySelectorAll("[data-action='tables']").forEach(btn => {
    btn.addEventListener("click", async () => {
      await openReservationTablesModal(btn.dataset.id);
    });
  });

  reservationsList.querySelectorAll("[data-action='confirm']").forEach(btn => {
    btn.addEventListener("click", async () => {
      await confirmReservation(
        btn.dataset.id,
        btn.dataset.name,
        btn.dataset.phone,
        btn.dataset.date,
        btn.dataset.time
      );
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

  let data = await searchReservations(currentSearch, "all");
  data = data.filter(x => !x.hidden);

  pendingCount.textContent = data.filter(x => x.status === "pending").length;
  confirmedCount.textContent = data.filter(x => x.status === "confirmed").length;

  periodLabel.textContent = getPeriodLabel();
  periodCount.textContent = applyPeriodFilter(data).length;

  data = applyStatusView(data);

  if (statusFilter.value !== "all") {
    data = data.filter(x => x.status === statusFilter.value);
  }

  data = applyPeriodFilter(data);

  if (!data.length) {
    reservationsList.innerHTML = `<div class="empty-card">Nessuna prenotazione trovata</div>`;
    return;
  }

  reservationsList.innerHTML = data.map(buildReservationCard).join("");
  attachCardActions();
}

function cyclePeriod() {
  if (currentPeriod === "all") currentPeriod = "today";
  else if (currentPeriod === "today") currentPeriod = "week";
  else if (currentPeriod === "week") currentPeriod = "month";
  else currentPeriod = "all";

  loadReservations();
}

async function doLogout() {
  await logout();
  location.href = "login.html";
}

/* Event listeners */
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

searchInput.addEventListener("input", () => {
  loadReservations();
});

statusFilter.addEventListener("change", () => {
  currentStatusView = "all";
  loadReservations();
});

document.getElementById("closeTablesModalBtn").addEventListener("click", closeTablesModal);
document.getElementById("cancelTablesModalBtn").addEventListener("click", closeTablesModal);
document.getElementById("saveTablesBtn").addEventListener("click", saveTablesModal);

tablesModal.addEventListener("click", (e) => {
  if (e.target === tablesModal) closeTablesModal();
});

/* Init */
loadReservations();
