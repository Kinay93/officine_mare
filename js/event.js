import supabase from "./supabase-client.js";

const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");

const eventForm = document.getElementById("eventForm");
const eventTitle = document.getElementById("eventTitle");
const eventDescription = document.getElementById("eventDescription");
const eventStartDate = document.getElementById("eventStartDate");
const eventEndDate = document.getElementById("eventEndDate");
const eventStartTime = document.getElementById("eventStartTime");
const eventImage = document.getElementById("eventImage");
const eventActive = document.getElementById("eventActive");
const resetEventBtn = document.getElementById("resetEventBtn");
const imagePreviewWrap = document.getElementById("imagePreviewWrap");
const imagePreview = document.getElementById("imagePreview");
const eventsListWrap = document.getElementById("eventsListWrap");
const eventStatusMsg = document.getElementById("eventStatusMsg");

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
  eventStatusMsg.textContent = message || "";
  eventStatusMsg.className = "status-msg";
  if (type) eventStatusMsg.classList.add(type);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeText(value, maxLen = 500) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function resetForm() {
  eventForm.reset();
  imagePreviewWrap.style.display = "none";
  imagePreview.removeAttribute("src");
  setStatus("");
}

function previewSelectedImage() {
  const file = eventImage.files?.[0];
  if (!file) {
    imagePreviewWrap.style.display = "none";
    imagePreview.removeAttribute("src");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    imagePreview.src = reader.result;
    imagePreviewWrap.style.display = "block";
  };
  reader.readAsDataURL(file);
}

async function uploadEventImage(file) {
  if (!file) return null;

  if (file.size > 4 * 1024 * 1024) {
    throw new Error("Immagine troppo grande. Massimo 4MB.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const fileName = `event_${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("events")
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from("events")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

async function loadEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    eventsListWrap.innerHTML = `<div class="empty-box">Errore caricamento eventi.</div>`;
    return;
  }

  const rows = data || [];

  if (!rows.length) {
    eventsListWrap.innerHTML = `<div class="empty-box">Nessun evento salvato.</div>`;
    return;
  }

  eventsListWrap.innerHTML = rows.map(row => `
    <article class="event-item">
      <img
        class="event-item-cover"
        src="${row.image_url || "assets/fondo.webp"}"
        alt="${escapeHtml(row.title || "Evento")}"
      >
      <div class="event-item-body">
        <div class="event-item-date">
          📅 ${escapeHtml(row.start_date || "")}${row.end_date && row.end_date !== row.start_date ? " → " + escapeHtml(row.end_date) : ""}
          ${row.start_time ? " · 🕒 " + escapeHtml(String(row.start_time).slice(0, 5)) : ""}
        </div>

        <h4 class="event-item-title">${escapeHtml(row.title || "")}</h4>

        <div class="event-item-desc">
          ${escapeHtml(row.description || "")}
        </div>

        <div class="event-item-meta">
          <span class="event-pill">${row.is_active ? "✅ Attivo" : "⏸️ Non attivo"}</span>
          ${row.image_url ? `<span class="event-pill">🖼️ Con foto</span>` : `<span class="event-pill">📝 Solo testo</span>`}
        </div>
      </div>

      <div class="event-item-footer">
        <button class="btn btn-danger btn-delete-event" data-id="${escapeHtml(row.id)}">Elimina</button>
      </div>
    </article>
  `).join("");

  document.querySelectorAll(".btn-delete-event").forEach(btn => {
    btn.addEventListener("click", async () => {
      const eventId = btn.dataset.id;
      if (!confirm("Eliminare questo evento?")) return;

      const { error: deleteError } = await supabase
        .from("events")
        .delete()
        .eq("id", eventId);

      if (deleteError) {
        alert("Errore eliminazione evento: " + deleteError.message);
        return;
      }

      await loadEvents();
    });
  });
}

async function saveEvent(e) {
  e.preventDefault();

  const title = sanitizeText(eventTitle.value, 120);
  const description = sanitizeText(eventDescription.value, 2000);
  const startDate = eventStartDate.value;
  const endDate = eventEndDate.value || startDate;
  const startTime = eventStartTime.value || null;
  const isActive = eventActive.value === "true";
  const file = eventImage.files?.[0] || null;

  if (!title) {
    setStatus("Inserisci il titolo.", "bad");
    return;
  }

  if (!description) {
    setStatus("Inserisci la descrizione.", "bad");
    return;
  }

  if (!startDate) {
    setStatus("Inserisci la data di inizio.", "bad");
    return;
  }

  if (endDate && endDate < startDate) {
    setStatus("La data fine non può essere precedente alla data inizio.", "bad");
    return;
  }

  setStatus("Salvataggio in corso...");

  try {
    let imageUrl = null;

    if (file) {
      imageUrl = await uploadEventImage(file);
    }

    const payload = {
      title,
      description,
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      image_url: imageUrl,
      is_active: isActive
    };

    const { error } = await supabase
      .from("events")
      .insert([payload]);

    if (error) throw error;

    setStatus("Evento salvato correttamente ✅", "ok");
    resetForm();
    await loadEvents();
  } catch (err) {
    console.error(err);
    setStatus("Errore salvataggio evento: " + (err?.message || err), "bad");
  }
}

const openDrawerBtn = document.getElementById("openDrawerBtn");
const closeDrawerBtn = document.getElementById("closeDrawerBtn");
const logoutBtn = document.getElementById("logoutBtn");

if (openDrawerBtn) openDrawerBtn.addEventListener("click", openDrawer);
if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closeDrawer);
if (drawerOverlay) drawerOverlay.addEventListener("click", closeDrawer);
if (logoutBtn) logoutBtn.addEventListener("click", doLogout);

if (eventImage) eventImage.addEventListener("change", previewSelectedImage);
if (resetEventBtn) resetEventBtn.addEventListener("click", resetForm);
if (eventForm) eventForm.addEventListener("submit", saveEvent);

await requireAuth();
await loadEvents();
