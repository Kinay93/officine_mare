import supabase from "./supabase-client.js";

const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const calendarGrid = document.getElementById("calendarGrid");
const calendarMonthTitle = document.getElementById("calendarMonthTitle");
const calendarStatus = document.getElementById("calendarStatus");

let currentMonthDate = new Date();
let isReloading = false;

async function requireAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    location.href = "login.html";
    throw new Error("NON_AUTHENTICATED");
  }
}

function openDrawer() {
  if (drawer) drawer.classList.add("open");
  if (drawerOverlay) drawerOverlay.classList.add("open");
}

function closeDrawer() {
  if (drawer) drawer.classList.remove("open");
  if (drawerOverlay) drawerOverlay.classList.remove("open");
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
  return date.toLocaleDateString("it-IT", {
    month: "long",
    year: "numeric"
  });
}

function monthBounds(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { first, last };
}

function monthDefaultCap(monthIndex) {
  return [4, 5, 6, 7, 8].includes(monthIndex) ? 60 : 40;
}

function baseCapacityForDay(dayISO) {
  const monthIndex = new Date(dayISO + "T00:00:00").getMonth();
  return monthDefaultCap(monthIndex);
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

  const fallback = baseCapacityForDay(dayISO);
  return {
    lunch: fallback,
    dinner: fallback
  };
}

function serviceBadgeClass(covers, max, blocked) {
  if (blocked) return "blocked";
  if (covers >= max) return "full";
  if (covers >= Math.floor(max * 0.75)) return "warning";
  return "available";
}

function dayBadgeClass(lunchState, dinnerState) {
  if (lunchState === "full" || dinnerState === "full") return "day-full";
  if (lunchState === "warning" || dinnerState === "warning") return "day-warning";
  return "day-available";
}

async function fetchMonthData(firstISO, lastISO) {
  const [
    reservationsRes,
    calendarRes,
    rulesRes
  ] = await Promise.all([
    supabase
      .from("reservations")
      .select("*")
      .gte("reservation_date", firstISO)
      .lte("reservation_date", lastISO),
    supabase
      .from("booking_calendar")
      .select("*")
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

function detectService(reservation) {
  if (reservation.service === "lunch" || reservation.service === "dinner") {
    return reservation.service;
  }

  const notes = String(reservation.notes || "").toLowerCase();
  if (notes.includes("turno: cena")) return "dinner";
  return "lunch";
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

    const service = detectService(row);
    const cur = map.get(day);

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
  rows.forEach(row => map.set(row.day, row));
  return map;
}

function getEffectiveState(iso, reservationsMap, calendarMap, rules) {
  const dayData = reservationsMap.get(iso) || {
    lunchReservations: 0,
    dinnerReservations: 0,
    lunchCovers: 0,
    dinnerCovers: 0
  };

  const row = calendarMap.get(iso);
  const rule = getRuleForDay(iso, rules);

  return {
    dayData,
    lunchMax: Number(row?.lunch_max_covers ?? rule.lunch),
    dinnerMax: Number(row?.dinner_max_covers ?? rule.dinner),
    lunchBlocked: !!row?.lunch_closed,
    dinnerBlocked: !!row?.dinner_closed
  };
}

function renderMonth(days, reservationsMap, calendarMap, rules) {
  calendarGrid.innerHTML = days.map(day => {
    const iso = toISODate(day);
    const state = getEffectiveState(iso, reservationsMap, calendarMap, rules);

    const lunchState = serviceBadgeClass(state.dayData.lunchCovers, state.lunchMax, state.lunchBlocked);
    const dinnerState = serviceBadgeClass(state.dayData.dinnerCovers, state.dinnerMax, state.dinnerBlocked);
    const cardClass = dayBadgeClass(lunchState, dinnerState);

    return `
      <article class="day-card ${cardClass}">
        <div class="day-top">
          <div class="day-number">${day.getDate()}</div>
          <div class="day-date-badge">${iso}</div>
        </div>

        <section class="service-box ${state.lunchBlocked ? "blocked" : ""}">
          <h3 class="service-title">Pranzo</h3>
          <div class="service-meta">
            <div>🗓 Prenotazioni: <strong>${state.dayData.lunchReservations}</strong></div>
            <div>👥 Coperti: <strong>${state.dayData.lunchCovers}/${state.lunchMax}</strong></div>
            <div>🔒 Stato: <strong>${state.lunchBlocked ? "Bloccato" : "Aperto"}</strong></div>
          </div>

          <div class="service-actions">
            <button
              class="btn ${state.lunchBlocked ? "btn-danger" : "btn-soft"} btn-toggle-block"
              data-day="${iso}"
              data-service="lunch"
              data-blocked="${state.lunchBlocked}">
              ${state.lunchBlocked ? "Sblocca" : "Blocca"}
            </button>

            <button
              class="btn btn-soft btn-change-capacity"
              data-day="${iso}"
              data-service="lunch"
              data-current="${state.lunchMax}">
              Capienza
            </button>
          </div>
        </section>

        <section class="service-box ${state.dinnerBlocked ? "blocked" : ""}">
          <h3 class="service-title">Cena</h3>
          <div class="service-meta">
            <div>🗓 Prenotazioni: <strong>${state.dayData.dinnerReservations}</strong></div>
            <div>👥 Coperti: <strong>${state.dayData.dinnerCovers}/${state.dinnerMax}</strong></div>
            <div>🔒 Stato: <strong>${state.dinnerBlocked ? "Bloccato" : "Aperto"}</strong></div>
          </div>

          <div class="service-actions">
            <button
              class="btn ${state.dinnerBlocked ? "btn-danger" : "btn-soft"} btn-toggle-block"
              data-day="${iso}"
              data-service="dinner"
              data-blocked="${state.dinnerBlocked}">
              ${state.dinnerBlocked ? "Sblocca" : "Blocca"}
            </button>

            <button
              class="btn btn-soft btn-change-capacity"
              data-day="${iso}"
              data-service="dinner"
              data-current="${state.dinnerMax}">
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
    .select("*")
    .eq("day", dayISO)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  const fallback = baseCapacityForDay(dayISO);

  const payload = {
    day: dayISO,
    lunch_closed: false,
    dinner_closed: false,
    lunch_max_covers: fallback,
    dinner_max_covers: fallback
  };

  const { data: inserted, error: insertError } = await supabase
    .from("booking_calendar")
    .insert([payload])
    .select()
    .single();

  if (insertError) throw insertError;
  return inserted;
}

async function getEffectiveCapsForDay(dayISO) {
  const [{ data: row, error: rowError }, { data: rules, error: ruleError }] = await Promise.all([
    supabase
      .from("booking_calendar")
      .select("*")
      .eq("day", dayISO)
      .maybeSingle(),
    supabase
      .from("booking_rules")
      .select("*")
      .lte("start_day", dayISO)
      .order("start_day", { ascending: true })
  ]);

  if (rowError) throw rowError;
  if (ruleError) throw ruleError;

  const rule = getRuleForDay(dayISO, rules || []);

  return {
    lunch: Number(row?.lunch_max_covers ?? rule.lunch),
    dinner: Number(row?.dinner_max_covers ?? rule.dinner),
    lunchClosed: !!row?.lunch_closed,
    dinnerClosed: !!row?.dinner_closed
  };
}

async function syncCalendarDayWithRules(dayISO) {
  const effective = await getEffectiveCapsForDay(dayISO);

  const { error } = await supabase
    .from("booking_calendar")
    .upsert([{
      day: dayISO,
      lunch_closed: effective.lunchClosed,
      dinner_closed: effective.dinnerClosed,
      lunch_max_covers: effective.lunch,
      dinner_max_covers: effective.dinner
    }], { onConflict: "day" });

  if (error) throw error;
}

async function refreshCalendarView(message = "", type = "ok") {
  await loadCalendar();
  if (message) setStatus(message, type);
}

async function toggleBlock(dayISO, service, currentBlocked) {
  if (isReloading) return;
  isReloading = true;
  setStatus("Aggiornamento in corso...");

  try {
    const existing = await ensureCalendarRow(dayISO);

    const patch = service === "lunch"
      ? {
          lunch_closed: !currentBlocked,
          lunch_max_covers: Number(existing.lunch_max_covers)
        }
      : {
          dinner_closed: !currentBlocked,
          dinner_max_covers: Number(existing.dinner_max_covers)
        };

    const { error } = await supabase
      .from("booking_calendar")
      .update(patch)
      .eq("day", dayISO);

    if (error) throw error;

    await refreshCalendarView("Servizio aggiornato ✅", "ok");
  } catch (err) {
    console.error(err);
    setStatus("Errore aggiornamento servizio: " + (err?.message || err), "bad");
  } finally {
    isReloading = false;
  }
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

  if (isReloading) return;
  isReloading = true;
  setStatus("Aggiornamento capienza in corso...");

  try {
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
      const currentEffective = await getEffectiveCapsForDay(dayISO);

      const insertRule = {
        start_day: dayISO,
        lunch_max_covers: service === "lunch" ? newValue : currentEffective.lunch,
        dinner_max_covers: service === "dinner" ? newValue : currentEffective.dinner
      };

      const { error: insertError } = await supabase
        .from("booking_rules")
        .insert([insertRule]);

      if (insertError) throw insertError;
    }

    await syncCalendarDayWithRules(dayISO);
    await refreshCalendarView("Capienza aggiornata da quel giorno in avanti ✅", "ok");
  } catch (err) {
    console.error(err);
    setStatus("Errore aggiornamento capienza: " + (err?.message || err), "bad");
  } finally {
    isReloading = false;
  }
}

function bindCalendarActions() {
  document.querySelectorAll(".btn-toggle-block").forEach(btn => {
    btn.addEventListener("click", async () => {
      const day = btn.dataset.day;
      const service = btn.dataset.service;
      const blocked = btn.dataset.blocked === "true";
      await toggleBlock(day, service, blocked);
    });
  });

  document.querySelectorAll(".btn-change-capacity").forEach(btn => {
    btn.addEventListener("click", async () => {
      const day = btn.dataset.day;
      const service = btn.dataset.service;
      const current = Number(btn.dataset.current || 0);
      await changeCapacityFromDay(day, service, current);
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
