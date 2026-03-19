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

async function loadTables() {
  const { data, error } = await supabase
    .from("restaurant_tables")
    .select("*")
    .order("code", { ascending: true });

  if (error) throw error;

  const grid = document.getElementById("tablesGrid");

  grid.innerHTML = (data || []).map(t => `
    <article class="reservation-card">
      <div class="reservation-top">
        <div>
          <h3 class="reservation-name">${escapeHtml(t.code)}</h3>
          <div class="reservation-meta">
            <span>${escapeHtml(t.seats || 0)} coperti</span>
          </div>
        </div>

        <div class="reservation-actions" style="margin-top:0;">
          <span class="badge ${t.is_open ? "badge-confirmed" : "badge-cancelled"}">
            ${t.is_open ? "Aperto" : "Chiuso"}
          </span>
          <button class="btn ${t.is_open ? "btn-danger" : "btn-primary"} toggle-table-btn" data-code="${escapeHtml(t.code)}" data-open="${t.is_open}">
            ${t.is_open ? "Chiudi tavolo" : "Apri tavolo"}
          </button>
        </div>
      </div>
    </article>
  `).join("");

  document.querySelectorAll(".toggle-table-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error: updError } = await supabase
        .from("restaurant_tables")
        .update({ is_open: btn.dataset.open !== "true" })
        .eq("code", btn.dataset.code);

      if (updError) {
        alert("Errore aggiornamento tavolo: " + updError.message);
        return;
      }

      await loadTables();
    });
  });
}

document.getElementById("openDrawerBtn").addEventListener("click", openDrawer);
document.getElementById("closeDrawerBtn").addEventListener("click", closeDrawer);
document.getElementById("drawerOverlay").addEventListener("click", closeDrawer);
document.getElementById("logoutBtn").addEventListener("click", doLogout);

await requireAuth();
await loadTables();
