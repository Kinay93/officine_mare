import supabase from "./supabase-client.js";

async function requireAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    location.href = "login.html";
    throw new Error("NON_AUTHENTICATED");
  }
}

function openDrawer() {
  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawerOverlay").classList.add("open");
}

function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawerOverlay").classList.remove("open");
}

async function doLogout() {
  await supabase.auth.signOut();
  location.href = "login.html";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("start_date", { ascending: true });

  if (error) throw error;

  const box = document.getElementById("eventsList");

  if (!(data || []).length) {
    box.innerHTML = `<div class="empty-card">Nessun evento presente</div>`;
    return;
  }

  box.innerHTML = data.map(ev => `
    <article class="reservation-card">
      <div class="reservation-top">
        <div>
          <h3 class="reservation-name">${escapeHtml(ev.title)}</h3>
          <div class="reservation-meta">
            <span>📅 ${escapeHtml(ev.start_date)} ${ev.end_date && ev.end_date !== ev.start_date ? "→ " + escapeHtml(ev.end_date) : ""}</span>
            <span>🕒 ${escapeHtml(ev.start_time || "-")} ${ev.end_time ? " - " + escapeHtml(ev.end_time) : ""}</span>
            <span>${ev.is_active ? "✅ Attivo" : "⏸️ Non attivo"}</span>
          </div>
          ${ev.description ? `<div class="mini-note">${escapeHtml(ev.description)}</div>` : ""}
          ${ev.image_url ? `<div class="mini-note">🖼️ ${escapeHtml(ev.image_url)}</div>` : ""}
        </div>
        <div class="reservation-actions" style="margin-top:0;">
          <button class="btn btn-soft toggle-event-btn" data-id="${ev.id}" data-active="${ev.is_active}">
            ${ev.is_active ? "Disattiva" : "Attiva"}
          </button>
          <button class="btn btn-danger delete-event-btn" data-id="${ev.id}">Elimina</button>
        </div>
      </div>
    </article>
  `).join("");

  document.querySelectorAll(".toggle-event-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error: updErr } = await supabase
        .from("events")
        .update({ is_active: btn.dataset.active !== "true" })
        .eq("id", btn.dataset.id);

      if (updErr) {
        alert("Errore aggiornamento evento: " + updErr.message);
        return;
      }

      await loadEvents();
    });
  });

  document.querySelectorAll(".delete-event-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Eliminare l'evento?")) return;

      const { error: delErr } = await supabase
        .from("events")
        .delete()
        .eq("id", btn.dataset.id);

      if (delErr) {
        alert("Errore eliminazione evento: " + delErr.message);
        return;
      }

      await loadEvents();
    });
  });
}

async function saveEvent() {
  const title = document.getElementById("evTitle").value.trim();
  const startDate = document.getElementById("evStartDate").value;
  const endDate = document.getElementById("evEndDate").value;
  const startTime = document.getElementById("evStartTime").value || null;
  const endTime = document.getElementById("evEndTime").value || null;
  const description = document.getElementById("evDescription").value.trim();
  const imageUrl = document.getElementById("evImageUrl").value.trim() || null;
  const isActive = document.getElementById("evActive").value === "true";

  if (!title || !startDate || !endDate) {
    alert("Titolo, data inizio e data fine sono obbligatori.");
    return;
  }

  const { error } = await supabase
    .from("events")
    .insert([{
      title,
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      end_time: endTime,
      description,
      image_url: imageUrl,
      is_active: isActive
    }]);

  if (error) {
    alert("Errore salvataggio evento: " + error.message);
    return;
  }

  document.getElementById("evTitle").value = "";
  document.getElementById("evStartDate").value = "";
  document.getElementById("evEndDate").value = "";
  document.getElementById("evStartTime").value = "";
  document.getElementById("evEndTime").value = "";
  document.getElementById("evDescription").value = "";
  document.getElementById("evImageUrl").value = "";
  document.getElementById("evActive").value = "true";

  await loadEvents();
}

document.getElementById("openDrawerBtn").addEventListener("click", openDrawer);
document.getElementById("closeDrawerBtn").addEventListener("click", closeDrawer);
document.getElementById("drawerOverlay").addEventListener("click", closeDrawer);
document.getElementById("logoutBtn").addEventListener("click", doLogout);
document.getElementById("saveEventBtn").addEventListener("click", saveEvent);

await requireAuth();
await loadEvents();
