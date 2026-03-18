import supabase from "./supabase-client.js";

async function requireAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    location.href = "login.html";
    throw new Error("NON_AUTHENTICATED");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function getMenuItems() {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function loadMenu() {
  const items = await getMenuItems();
  const box = document.getElementById("menuList");

  if (!items.length) {
    box.innerHTML = `<div class="empty-card">Nessun piatto presente</div>`;
    return;
  }

  box.innerHTML = items.map(item => `
    <article class="reservation-card">
      <div class="reservation-top">
        <div>
          <h3 class="reservation-name">${escapeHtml(item.name)}</h3>
          <div class="reservation-meta">
            <span>📖 ${escapeHtml(item.category || "-")}</span>
            <span>💶 €${Number(item.price || 0).toFixed(2)}</span>
            ${item.description ? `<span>📝 ${escapeHtml(item.description)}</span>` : ""}
          </div>
        </div>

        <div class="reservation-actions" style="margin-top:0;">
          <button class="btn btn-danger delete-item-btn" data-id="${item.id}">Elimina</button>
        </div>
      </div>
    </article>
  `).join("");

  document.querySelectorAll(".delete-item-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Eliminare il piatto?")) return;

      const { error } = await supabase
        .from("menu_items")
        .delete()
        .eq("id", btn.dataset.id);

      if (error) {
        alert("Errore eliminazione: " + error.message);
        return;
      }

      await loadMenu();
    });
  });
}

async function saveItem() {
  const name = document.getElementById("itemName").value.trim();
  const category = document.getElementById("itemCategory").value;
  const price = Number(document.getElementById("itemPrice").value || 0);
  const description = document.getElementById("itemDescription").value.trim();

  if (!name || !category) {
    alert("Inserisci almeno nome e categoria.");
    return;
  }

  const { error } = await supabase
    .from("menu_items")
    .insert([{
      name,
      category,
      price,
      description,
      active: true
    }]);

  if (error) {
    alert("Errore salvataggio: " + error.message);
    return;
  }

  document.getElementById("itemName").value = "";
  document.getElementById("itemCategory").value = "";
  document.getElementById("itemPrice").value = "";
  document.getElementById("itemDescription").value = "";

  await loadMenu();
}

async function saveMenuDayImage(file) {
  const day = todayISO();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `menu-day-${day}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("menu-day")
    .upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg"
    });

  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage
    .from("menu-day")
    .getPublicUrl(path);

  const image_url = publicData.publicUrl;

  const { data: existing, error: existingError } = await supabase
    .from("menu_day")
    .select("id")
    .eq("day", day)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await supabase
      .from("menu_day")
      .update({ image_url, text: null })
      .eq("id", existing.id);

    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("menu_day")
      .insert([{ day, image_url, text: null }]);

    if (error) throw error;
  }

  return image_url;
}

async function loadDayMenuPreview() {
  const day = todayISO();
  const { data, error } = await supabase
    .from("menu_day")
    .select("*")
    .eq("day", day)
    .maybeSingle();

  if (error) throw error;

  const preview = document.getElementById("menuDayPreview");

  if (data?.image_url) {
    preview.innerHTML = `
      <img src="${data.image_url}" alt="Menù del giorno"
           style="max-width:320px;width:100%;border-radius:16px;border:1px solid var(--border);box-shadow:var(--shadow);">
    `;
  } else {
    preview.innerHTML = `<div style="color:var(--muted);">Nessuna immagine caricata oggi.</div>`;
  }
}

async function uploadDayMenu() {
  const input = document.getElementById("menuDayFile");
  const status = document.getElementById("menuDayStatus");
  const file = input.files?.[0];

  if (!file) {
    alert("Seleziona un'immagine.");
    return;
  }

  try {
    status.textContent = "Caricamento in corso...";
    await saveMenuDayImage(file);
    status.textContent = "Menù del giorno aggiornato.";
    input.value = "";
    await loadDayMenuPreview();
  } catch (err) {
    status.textContent = "Errore caricamento: " + (err?.message || err);
  }
}

document.getElementById("openDrawerBtn").addEventListener("click", openDrawer);
document.getElementById("closeDrawerBtn").addEventListener("click", closeDrawer);
document.getElementById("drawerOverlay").addEventListener("click", closeDrawer);
document.getElementById("logoutBtn").addEventListener("click", doLogout);
document.getElementById("saveItemBtn").addEventListener("click", saveItem);
document.getElementById("uploadDayMenuBtn").addEventListener("click", uploadDayMenu);

await requireAuth();
await loadMenu();
await loadDayMenuPreview();
