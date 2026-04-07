import supabase from "./supabase-client.js";

const form = document.getElementById("bookingForm");
const statusBox = document.getElementById("bookingStatus");
const dateEl = document.getElementById("date");
const turnoEl = document.getElementById("turno");
const timeEl = document.getElementById("time");

const eventsSection = document.getElementById("eventsSection");
const eventCardsWrap = document.getElementById("eventCardsWrap");

const dayMenuPanel = document.getElementById("dayMenuPanel");
const dayMenuContent = document.getElementById("dayMenuContent");
const toggleDayMenuBtn = document.getElementById("toggleDayMenuBtn");

let closedServiceMap = new Map();
let rulesCache = [];

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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


function normalizeDateToISO(value) {
  if (!value) return "";

  const rawOriginal = String(value).trim();
  const raw = rawOriginal.toLowerCase().replace(/\s+/g, " "); // normalizza spazi multipli

  // già ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  // dd/mm/yyyy
  let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }

  // dd-mm-yyyy (ma non yyyy-mm-dd già catturato sopra)
  m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }

  const monthMap = {
    gen: "01", gennaio: "01", jan: "01", january: "01",
    feb: "02", febbraio: "02", february: "02",
    mar: "03", marzo: "03", march: "03",
    apr: "04", aprile: "04", april: "04",
    mag: "05", maggio: "05", may: "05",
    giu: "06", giugno: "06", jun: "06", june: "06",
    lug: "07", luglio: "07", jul: "07", july: "07",
    ago: "08", agosto: "08", aug: "08", august: "08",
    set: "09", sett: "09", settembre: "09", sep: "09", sept: "09", september: "09",
    ott: "10", ottobre: "10", oct: "10", october: "10",
    nov: "11", novembre: "11", november: "11",
    dic: "12", dicembre: "12", dec: "12", december: "12"
  };

  // "2 apr 2026" / "2 aprile 2026" — formato iPhone italiano
  m = raw.match(/^(\d{1,2})\s+([a-zà-ù]+)\.?\s+(\d{4})$/i);
  if (m) {
    const dd = pad(Number(m[1]));
    const mm = monthMap[m[2].replace(/\.$/, "")]; // rimuove eventuale punto finale "apr."
    const yyyy = m[3];
    if (mm) return `${yyyy}-${mm}-${dd}`;
  }

  // "apr 2, 2026" / "april 2 2026" — formato iPhone inglese
  m = raw.match(/^([a-zà-ù]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m) {
    const mm = monthMap[m[1].replace(/\.$/, "")];
    const dd = pad(Number(m[2]));
    const yyyy = m[3];
    if (mm) return `${yyyy}-${mm}-${dd}`;
  }

  // fallback: usa Date ma estrai i componenti locali, non UTC (bug Safari con fuso orario)
  const parsed = new Date(rawOriginal);
  if (!Number.isNaN(parsed.getTime())) {
    // getFullYear/Month/Date usa il fuso locale, evitando lo shift di ±1 giorno di Safari
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  console.warn("normalizeDateToISO: formato non riconosciuto →", JSON.stringify(rawOriginal));
  return "";
}
function defaultMaxCoversForMonth(monthIndex) {
  return [4, 5, 6, 7, 8].includes(monthIndex) ? 60 : 40;
}

function getRuleForDay(dayISO, rules) {
  let selected = null;

  for (const rule of rules) {
    if (rule.start_day <= dayISO) selected = rule;
    else break;
  }

  if (selected) {
    return {
      lunch: Number(selected.lunch_max_covers || 0),
      dinner: Number(selected.dinner_max_covers || 0)
    };
  }

  const monthIndex = new Date(dayISO + "T00:00:00").getMonth();
  const d = defaultMaxCoversForMonth(monthIndex);
  return { lunch: d, dinner: d };
}

async function loadClosedServicesForNextYear() {
  const fromISO = todayISO();
  const toISO = addDaysISO(365);

  const [{ data: calendarData, error: calendarError }, { data: rulesData, error: rulesError }] = await Promise.all([
    supabase
      .from("booking_calendar")
      .select("day, lunch_closed, dinner_closed, lunch_max_covers, dinner_max_covers")
      .gte("day", fromISO)
      .lte("day", toISO),
    supabase
      .from("booking_rules")
      .select("*")
      .lte("start_day", toISO)
      .order("start_day", { ascending: true })
  ]);

  if (calendarError) throw calendarError;
  if (rulesError) throw rulesError;

  rulesCache = rulesData || [];
  closedServiceMap = new Map();

  (calendarData || []).forEach(row => {
    closedServiceMap.set(row.day, {
      lunch_closed: !!row.lunch_closed,
      dinner_closed: !!row.dinner_closed,
      lunch_max_covers: row.lunch_max_covers,
      dinner_max_covers: row.dinner_max_covers
    });
  });
}

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

function getServiceState(dateStr, turno) {
  const row = closedServiceMap.get(dateStr);
  const base = getRuleForDay(dateStr, rulesCache);

  if (!row) {
    return {
      closed: false,
      max: turno === "cena" ? Number(base.dinner) : Number(base.lunch)
    };
  }

  if (turno === "cena") {
    return {
      closed: !!row.dinner_closed,
      max: Number(base.dinner)
    };
  }

  return {
    closed: !!row.lunch_closed,
    max: Number(base.lunch)
  };
}

async function getCurrentBookedCovers(dateStr, turno) {
  const service = turno === "cena" ? "dinner" : "lunch";

  const { data, error } = await supabase
    .from("reservations")
    .select("people, service, notes, status, hidden")
    .eq("reservation_date", dateStr);

  if (error) throw error;

  const rows = (data || []).filter(r => r.status !== "cancelled" && !r.hidden);

  let covers = 0;

  for (const row of rows) {
    let rowService = row.service;

    if (rowService !== "lunch" && rowService !== "dinner") {
      const notes = String(row.notes || "").toLowerCase();
      rowService = notes.includes("turno: cena") ? "dinner" : "lunch";
    }

    if (rowService === service) {
      covers += Number(row.people || 0);
    }
  }

  return covers;
}

async function isBlockedOrFull(dateStr, turno) {
  const serviceState = getServiceState(dateStr, turno);

  if (serviceState.closed) {
    return {
      blocked: true,
      reason: "Questo servizio è bloccato e non è prenotabile."
    };
  }

  const covers = await getCurrentBookedCovers(dateStr, turno);

  if (covers >= serviceState.max) {
    return {
      blocked: true,
      reason: "Questo servizio è al completo."
    };
  }

  return {
    blocked: false,
    reason: "",
    covers,
    max: serviceState.max
  };
}

async function refreshSlots() {
  const normalizedDate = normalizeDateToISO(dateEl.value);
  const turno = turnoEl.value;

  timeEl.innerHTML = `<option value="">Seleziona prima data e turno</option>`;

  if (!normalizedDate || !turno) return;

  if (isMonday(normalizedDate)) {
    timeEl.innerHTML = `<option value="">Lunedì chiuso</option>`;
    return;
  }

  if (isSunday(normalizedDate) && turno === "cena") {
    timeEl.innerHTML = `<option value="">Domenica sera non disponibile</option>`;
    return;
  }

  const state = await isBlockedOrFull(normalizedDate, turno);

  if (state.blocked) {
    timeEl.innerHTML = `<option value="">${state.reason}</option>`;
    return;
  }

  const slots = turno === "pranzo" ? lunchSlots : dinnerSlots;
  timeEl.innerHTML = `<option value="">Seleziona orario</option>` + slots.map(slot => `
    <option value="${slot}">${slot}</option>
  `).join("");
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, "");
}

function containsDangerousPattern(value) {
  const v = String(value || "").toLowerCase();
  return (
    v.includes("<script") ||
    v.includes("</script") ||
    v.includes("javascript:") ||
    v.includes("data:text/html") ||
    v.includes("onerror=") ||
    v.includes("onload=") ||
    v.includes("onclick=") ||
    v.includes("onmouseover=") ||
    v.includes("iframe") ||
    v.includes("svg") ||
    v.includes("document.cookie") ||
    v.includes("window.location") ||
    v.includes("alert(")
  );
}

function sanitizeText(value, maxLen = 120) {
  let v = normalizeSpaces(value);
  v = stripHtml(v);
  v = v.slice(0, maxLen);
  return v;
}

function validateName(value) {
  const v = sanitizeText(value, 80);
  if (!v) return { ok: false, msg: "Inserisci il nome." };
  if (containsDangerousPattern(v)) return { ok: false, msg: "Nome non valido." };
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]{2,80}$/.test(v)) {
    return { ok: false, msg: "Il nome contiene caratteri non validi." };
  }
  return { ok: true, value: v };
}

function validatePhone(value) {
  let v = normalizeSpaces(value).replace(/[^\d+ ]/g, "");
  v = v.slice(0, 20);

  if (!v) return { ok: false, msg: "Inserisci il telefono." };
  if (containsDangerousPattern(v)) return { ok: false, msg: "Telefono non valido." };
  if (!/^\+?[0-9 ]{6,20}$/.test(v)) {
    return { ok: false, msg: "Numero di telefono non valido." };
  }

  return { ok: true, value: v };
}

function validateEmail(value) {
  let v = normalizeSpaces(value).toLowerCase().slice(0, 120);

  if (!v) return { ok: true, value: "" };
  if (containsDangerousPattern(v)) return { ok: false, msg: "Email non valida." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
    return { ok: false, msg: "Formato email non valido." };
  }

  return { ok: true, value: v };
}

function validateNotes(value) {
  let v = sanitizeText(value, 500);
  if (containsDangerousPattern(v)) {
    return { ok: false, msg: "Le note contengono testo non consentito." };
  }
  return { ok: true, value: v };
}

function showError(msg) {
  statusBox.className = "booking-status bad";
  statusBox.textContent = msg;
}

function showOk(msg) {
  statusBox.className = "booking-status ok";
  statusBox.textContent = msg;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.getElementById("notes")?.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[<>]/g, "");
});

document.getElementById("name")?.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]/g, "");
});

document.getElementById("phone")?.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^\d+ ]/g, "");
});

dateEl?.addEventListener("change", async () => {
  const normalizedDate = normalizeDateToISO(dateEl.value);

  if (normalizedDate && turnoEl.value) {
    const state = await isBlockedOrFull(normalizedDate, turnoEl.value);
    if (state.blocked) {
      showError(state.reason);
    } else {
      statusBox.className = "booking-status";
      statusBox.textContent = "";
    }
  } else {
    statusBox.className = "booking-status";
    statusBox.textContent = "";
  }7

  await refreshSlots();
});

turnoEl?.addEventListener("change", async () => {
  const normalizedDate = normalizeDateToISO(dateEl.value);

  if (normalizedDate && turnoEl.value) {
    const state = await isBlockedOrFull(normalizedDate, turnoEl.value);
    if (state.blocked) {
      showError(state.reason);
    } else {
      statusBox.className = "booking-status";
      statusBox.textContent = "";
    }
  } else {
    statusBox.className = "booking-status";
    statusBox.textContent = "";
  }

  await refreshSlots();
});

toggleDayMenuBtn?.addEventListener("click", async () => {
  dayMenuPanel.classList.toggle("open");

  if (dayMenuPanel.classList.contains("open")) {
    const day = todayISO();

    const { data, error } = await supabase
      .from("menu_day")
      .select("*")
      .eq("day", day)
      .maybeSingle();

    if (error) {
      dayMenuContent.textContent = "Errore caricamento menù del giorno.";
      return;
    }

    if (data?.image_url) {
      dayMenuContent.innerHTML = `<img src="${data.image_url}" alt="Menù del giorno">`;
    } else if (data?.text) {
      dayMenuContent.textContent = data.text;
    } else {
      dayMenuContent.textContent = "Nessun menù del giorno disponibile.";
    }
  }
});

async function loadEvents() {
  const fromISO = todayISO();
  const toISO = addDaysISO(31);

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("is_active", true)
    .gte("end_date", fromISO)
    .lte("start_date", toISO)
    .order("start_date", { ascending: true });

  if (error) {
    console.warn("Eventi non caricati:", error.message);
    return;
  }

  const eventsData = data || [];

  if (!eventsData.length) {
    eventsSection?.classList.remove("show");
    if (eventCardsWrap) eventCardsWrap.innerHTML = "";
    return;
  }

  eventsSection?.classList.add("show");

  if (eventCardsWrap) {
    eventCardsWrap.innerHTML = eventsData.map((ev, index) => `
      <article class="event-card-mini" data-event-index="${index}">
        <img
          class="event-card-cover"
          src="${ev.image_url || "assets/fondo.webp"}"
          alt="${escapeHtml(ev.title || "Evento")}"
        >
        <div class="event-card-body">
          <div class="event-card-date">
            📅 ${escapeHtml(ev.start_date)}${ev.end_date && ev.end_date !== ev.start_date ? " → " + escapeHtml(ev.end_date) : ""}
            ${ev.start_time ? " · 🕒 " + escapeHtml(String(ev.start_time).slice(0, 5)) : ""}
          </div>
          <div class="event-card-title">${escapeHtml(ev.title || "Evento")}</div>
          <div class="event-card-preview">
            ${escapeHtml((ev.description || "Dettagli evento disponibili a breve.").slice(0, 90))}
            ${(ev.description || "").length > 90 ? "..." : ""}
          </div>
          <div class="event-card-full">
            ${escapeHtml(ev.description || "Dettagli evento disponibili a breve.")}
          </div>
        </div>
      </article>
    `).join("");

    document.querySelectorAll(".event-card-mini").forEach(card => {
      card.addEventListener("click", () => {
        card.classList.toggle("open");
      });

      card.addEventListener("touchstart", () => {
        card.classList.toggle("open");
      }, { passive: true });
    });
  }
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const normalizedDate = normalizeDateToISO(dateEl.value);

  if (!normalizedDate) {
    showError("Data non valida.");
    return;
  }

  if (isMonday(normalizedDate)) {
    showError("Il lunedì il ristorante è chiuso.");
    return;
  }

  if (isSunday(normalizedDate) && turnoEl.value === "cena") {
    showError("La domenica sera non è disponibile.");
    return;
  }

  const serviceState = await isBlockedOrFull(normalizedDate, turnoEl.value);
  if (serviceState.blocked) {
    showError(serviceState.reason);
    return;
  }

  if (!timeEl.value) {
    showError("Seleziona un orario valido.");
    return;
  }

  const nameCheck = validateName(document.getElementById("name").value);
  if (!nameCheck.ok) {
    showError(nameCheck.msg);
    return;
  }

  const phoneCheck = validatePhone(document.getElementById("phone").value);
  if (!phoneCheck.ok) {
    showError(phoneCheck.msg);
    return;
  }

  const emailCheck = validateEmail(document.getElementById("email").value);
  if (!emailCheck.ok) {
    showError(emailCheck.msg);
    return;
  }

  const notesCheck = validateNotes(document.getElementById("notes").value);
  if (!notesCheck.ok) {
    showError(notesCheck.msg);
    return;
  }

  const people = Number(document.getElementById("people").value || 0);
  if (!people || people < 1 || people > 12) {
    showError("Numero persone non valido.");
    return;
  }

  const bookedAfterInsert = Number(serviceState.covers || 0) + people;
  if (bookedAfterInsert > Number(serviceState.max || 0)) {
    showError("Con questa prenotazione il servizio supererebbe la capienza disponibile.");
    return;
  }

  const safeNotes = [
    "Turno: " + turnoEl.value,
    notesCheck.value,
    emailCheck.value ? "Email: " + emailCheck.value : ""
  ].filter(Boolean).join(" | ");

  const payload = {
    customer_name: nameCheck.value,
    customer_phone: phoneCheck.value,
    reservation_date: normalizedDate,
    reservation_time: timeEl.value,
    people,
    notes: safeNotes,
    status: "pending",
    source: "web",
    service: turnoEl.value === "cena" ? "dinner" : "lunch",
    hidden: false
  };

  try {
    statusBox.className = "booking-status";
    statusBox.textContent = "Invio in corso...";

    const { data: insertedData, error } = await supabase
      .from("reservations")
      .insert([payload])
      .select()
      .single();

    if (error) throw error;

    console.log("Prenotazione salvata:", insertedData);

    try {
      console.log("Invio richiesta mail...");

      const { data: mailData, error: mailError } = await supabase.functions.invoke("notify-booking", {
        body: {
          reservation_id: insertedData?.id || null,
          customer_name: payload.customer_name,
          customer_phone: payload.customer_phone,
          reservation_date: payload.reservation_date,
          reservation_time: payload.reservation_time,
          people: payload.people,
          service: payload.service,
          notes: payload.notes || ""
        }
      });

      console.log("Risposta mail:", mailData);

      if (mailError) {
        console.error("Errore mail:", mailError);
      }
    } catch (mailErr) {
      console.error("Errore invoke:", mailErr);
    }

    form.reset();
    timeEl.innerHTML = `<option value="">Seleziona prima data e turno</option>`;
    showOk("Prenotazione inviata con successo.");

    await loadClosedServicesForNextYear();
    await loadEvents();
  } catch (err) {
    showError("Errore invio: " + (err?.message || err));
  }
});

await loadClosedServicesForNextYear();
await loadEvents();
