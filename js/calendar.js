import supabase from "./supabase-client.js";

const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const calendarGrid = document.getElementById("calendarGrid");
const calendarMonthTitle = document.getElementById("calendarMonthTitle");
const calendarStatus = document.getElementById("calendarStatus");

let currentMonthDate = new Date();
let busy = false;

async function requireAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    location.href = "login.html";
    throw new Error("NON_AUTHENTICATED");
  }
}

function openDrawer() {
  drawer?.classList.add("open");
  drawerOverlay?.classList.add("open");
}

function closeDrawer() {
  drawer?.classList.remove("open");
  drawerOverlay?.classList.remove("open");
}

async function doLogout() {
  await supabase.auth.signOut();
  location.href = "login.html";
}

function setStatus(message, type = "") {
  if (!calendarStatus) return;
  calendarStatus.textContent = message || "";
  calendarStatus.className = "calendar-status";
  if (type) calendarStatus.classList.add(type);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthTitle(date) {
  return date.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

function monthBounds(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { first, last };
}

function defaultCapForMonth(monthIndex) {
  return [4, 5, 6, 7, 8].includes(monthIndex) ? 60 : 40;
}

function getRuleForDay(dayISO, rules) {
  let selected = null;

  for (const rule of rules) {
    if (rule.start_day <= dayISO) {
      selected = rule;
    } else {
      break;
    }
  }

  if (selected) {
    return {
      lunch: Number(selected.lunch_max_covers || 0),
      dinner: Number(selected.dinner_max_covers || 0)
    };
  }

  const monthIndex = new Date(dayISO + "T00:00:00").getMonth();
  const base = defaultCapForMonth(monthIndex);
  return { lunch: base, dinner: base };
}

function detectService(reservation) {
  if (reservation.service === "lunch" || reservation.service === "dinner") return reservation.service;
  const notes = String(reservation.notes || "").toLowerCase();
  return notes.includes("turno: cena") ? "dinner" : "lunch";
}

function groupReservationsByDay(reservations) {
  const map = new Map();

  for (const row of reservations) {
    if (row.status === "cancelled" || row.hidden) continue;

    const day = row.reservation_date;
    if (!map.has(day)) {
      map.set(day, {
        lunchReservations: 0,
        dinnerReservations: 0,
        lunchCovers: 0,
        dinnerCovers: 0
      });
    }

    const cur = map.get(day);
    const service = detectService(row);

    if (service === "dinner") {
      cur.dinnerReservations += 1;
      cur.dinnerCovers += Number(row.people || 0);
    } else {
      cur.lunchReservations += 1;
      cur.lunchCovers += Number(row.people || 0);
    }
  }

  return map;
}

function buildCalendarMap(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.day, {
      lunch_closed: !!row.lunch_closed,
      dinner_closed: !!row.dinner_closed
    });
  }
  return map;
}

function serviceStateClass(covers, max, blocked) {
  if (blocked) return "blocked";
  if (covers >= max) return "full";
  if (covers >= Math.floor(max * 0.75)) return "warning";
  return "available";
}

function dayClass(lunchState, dinnerState) {
  if (lunchState === "full" || dinnerState === "full") return "day-full";
  if (lunchState === "warning" || dinnerState === "warning") return "day-warning";
  return "day-available";
}

async function fetchMonthData(firstISO, lastISO) {
  const [reservationsRes, calendarRes, rulesRes] = await Promise.all([
    supabase
      .from("reservations")
      .select("*")
      .gte("reservation_date", firstISO)
      .lte("reservation_date", lastISO),

    supabase
      .from("booking_calendar")
      .select("day, lunch_closed, dinner_closed")
      .gte("day", firstISO)
      .lte("day", lastISO),

    supabase
      .from("booking_rules")
      .select("*")
      .lte("start_day", lastISO)
      .order("start_day", { ascending: true })
  ]);

  if (reservationsRes.error) throw reservationsRes.error;
  if (calendarRes.error) throw calendarRes.error;
  if (rulesRes.error) throw rulesRes.error;

  return {
    reservations: reservationsRes.data || [],
    calendarRows: calendarRes.data || [],
    rules: rulesRes.data || []
  };
}

function renderMonth(days, reservationsMap, calendarMap, rules) {
  calendarGrid.innerHTML = days.map(day => {
    const iso = toISODate(day);

    const dayData = reservationsMap.get(iso) || {
      lunchReservations: 0,
      dinnerReservations: 0,
      lunchCovers: 0,
      dinnerCovers: 0
    };

    const blocks = calendarMap.get(iso);
    const caps = getRuleForDay(iso, rules);

    const lunchBlocked = !!blocks?.lunch_closed;
    const dinnerBlocked = !!blocks?.dinner_closed;

    const lunchState = serviceStateClass(dayData.lunchCovers, caps.lunch, lunchBlocked);
    const dinnerState = serviceStateClass(dayData.dinnerCovers, caps.dinner, dinnerBlocked);

    return `
      <article class="day-card ${dayClass(lunchState, dinnerState)}">
        <div class="day-top">
          <div class="day-number">${day.getDate()}</div>
          <div class="day-date-badge">${iso}</div>
        </div>

        <section class="service-box ${lunchBlocked ? "blocked" : ""}">
          <h3 class="service-title">Pranzo</h3>
          <div class="service-meta">
            <div>🗓 Prenotazioni: <strong>${dayData.lunchReservations}</strong></div>
            <div>👥 Coperti: <strong>${dayData.lunchCovers}/${caps.lunch}</strong></div>
            <div>🔒 Stato: <strong>${lunchBlocked ? "Bloccato" : "Aperto"}</strong></div>
          </div>
          <div class="service-actions">
            <button class="btn ${lunchBlocked ? "btn-danger" : "btn-soft"} btn-toggle-block"
              data-day="${iso}"
              data-service="lunch"
              data-blocked="${lunchBlocked}">
              ${lunchBlocked ? "Sblocca" : "Blocca"}
            </button>
            <button class="btn btn-soft btn-change-capacity"
              data-day="${iso}"
              data-service="lunch"
              data-current="${caps.lunch}">
              Capienza
            </button>
          </div>
        </section>

        <section class="service-box ${dinnerBlocked ? "blocked" : ""}">
          <h3 class="service-title">Cena</h3>
          <div class="service-meta">
            <div>🗓 Prenotazioni: <strong>${dayData.dinnerReservations}</strong></div>
            <div>👥 Coperti: <strong>${dayData.dinnerCovers}/${caps.dinner}</strong></div>
            <div>🔒 Stato: <strong>${dinnerBlocked ? "Bloccato" : "Aperto"}</strong></div>
          </div>
          <div class="service-actions">
            <button class="btn ${dinnerBlocked ? "btn-danger" : "btn-soft"} btn-toggle-block"
              data-day="${iso}"
              data-service="dinner"
              data-blocked="${dinnerBlocked}">
              ${dinnerBlocked ? "Sblocca" : "Blocca"}
            </button>
            <button class="btn btn-soft btn-change-capacity"
              data-day="${iso}"
              data-service="dinner"
              data-current="${caps.dinner}">
              Capienza
            </button>
          </div>
        </section>
      </article>
    `;
  }).join("");

  bindCalendarActions();
}

async function ensureCalendarRow(dayISO) {
  const { data, error } = await supabase
    .from("booking_calendar")
    .select("day, lunch_closed, dinner_closed")
    .eq("day", dayISO)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  const { error: insertError } = await supabase
    .from("booking_calendar")
    .insert([{
      day: dayISO,
      lunch_closed: false,
      dinner_closed: false
    }]);

  if (insertError) throw insertError;
}

async function toggleBlock(dayISO, service, blocked) {
  if (busy) return;
  busy = true;

  try {
    setStatus("Aggiornamento in corso...");

    await ensureCalendarRow(dayISO);

    const patch = service === "lunch"
      ? { lunch_closed: !blocked }
      : { dinner_closed: !blocked };

    const { error } = await supabase
      .from("booking_calendar")
      .update(patch)
      .eq("day", dayISO);

    if (error) throw error;

    await loadCalendar();
    setStatus("Servizio aggiornato ✅", "ok");
  } catch (err) {
    console.error(err);
    setStatus("Errore aggiornamento servizio: " + (err?.message || err), "bad");
  } finally {
    busy = false;
  }
}

async function getRulesUntil(dayISO) {
  const { data, error } = await supabase
    .from("booking_rules")
    .select("*")
    .lte("start_day", dayISO)
    .order("start_day", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function changeCapacityFromDay(dayISO, service, currentValue) {
  const input = prompt(
    `Nuova capienza ${service === "lunch" ? "pranzo" : "cena"} da ${dayISO} in avanti:`,
    String(currentValue)
  );

  if (input === null) return;

  const newValue = Number(input);
  if (!Number.isInteger(newValue) || newValue <= 0) {
    setStatus("Inserisci una capienza valida.", "bad");
    return;
  }

  if (busy) return;
  busy = true;

  try {
    setStatus("Aggiornamento capienza in corso...");

    const { data: existingRule, error: existingRuleError } = await supabase
      .from("booking_rules")
      .select("*")
      .eq("start_day", dayISO)
      .maybeSingle();

    if (existingRuleError) throw existingRuleError;

    if (existingRule) {
      const patch = {};

      if (service === "lunch") {
        patch.lunch_max_covers = newValue;
      } else {
        patch.dinner_max_covers = newValue;
      }

      const { error: updateError } = await supabase
        .from("booking_rules")
        .update(patch)
        .eq("id", existingRule.id);

      if (updateError) throw updateError;
    } else {
      const currentCaps = getRuleForDay(dayISO, await getRulesUntil(dayISO));

      const payload = {
        start_day: dayISO,
        lunch_max_covers: service === "lunch" ? newValue : currentCaps.lunch,
        dinner_max_covers: service === "dinner" ? newValue : currentCaps.dinner
      };

      const { error: insertError } = await supabase
        .from("booking_rules")
        .insert([payload]);

      if (insertError) throw insertError;
    }

    await loadCalendar();
    setStatus("Capienza aggiornata da quel giorno in avanti ✅", "ok");
  } catch (err) {
    console.error(err);
    setStatus("Errore aggiornamento capienza: " + (err?.message || err), "bad");
  } finally {
    busy = false;
  }
}

function bindCalendarActions() {
  document.querySelectorAll(".btn-toggle-block").forEach(btn => {
    btn.addEventListener("click", async () => {
      await toggleBlock(
        btn.dataset.day,
        btn.dataset.service,
        btn.dataset.blocked === "true"
      );
    });
  });

  document.querySelectorAll(".btn-change-capacity").forEach(btn => {
    btn.addEventListener("click", async () => {
      await changeCapacityFromDay(
        btn.dataset.day,
        btn.dataset.service,
        Number(btn.dataset.current || 0)
      );
    });
  });
}

async function loadCalendar() {
  const { first, last } = monthBounds(currentMonthDate);
  const firstISO = toISODate(first);
  const lastISO = toISODate(last);

  calendarMonthTitle.textContent = monthTitle(currentMonthDate);

  const days = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  try {
    const { reservations, calendarRows, rules } = await fetchMonthData(firstISO, lastISO);
    const reservationsMap = groupReservationsByDay(reservations);
    const calendarMap = buildCalendarMap(calendarRows);
    renderMonth(days, reservationsMap, calendarMap, rules);
  } catch (err) {
    console.error(err);
    setStatus("Errore caricamento calendario: " + (err?.message || err), "bad");
  }
}

document.getElementById("prevMonthBtn")?.addEventListener("click", async () => {
  currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1);
  await loadCalendar();
});

document.getElementById("nextMonthBtn")?.addEventListener("click", async () => {
  currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1);
  await loadCalendar();
});

document.getElementById("todayBtn")?.addEventListener("click", async () => {
  currentMonthDate = new Date();
  await loadCalendar();
});

document.getElementById("openDrawerBtn")?.addEventListener("click", openDrawer);
document.getElementById("closeDrawerBtn")?.addEventListener("click", closeDrawer);
drawerOverlay?.addEventListener("click", closeDrawer);
document.getElementById("logoutBtn")?.addEventListener("click", doLogout);

await requireAuth();
await loadCalendar();
