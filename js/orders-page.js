import supabase from "./supabase-client.js";

const orderModal = document.getElementById("orderModal");
const orderTableSelect = document.getElementById("orderTableSelect");
const orderMenuWrap = document.getElementById("orderMenuWrap");
const orderNote = document.getElementById("orderNote");

let menuItems = [];
let selectableReservations = [];

async function requireAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    location.href = "login.html";
    throw new Error("NON_AUTHENTICATED");
  }
  return data.session;
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

function openOrderModal() {
  orderModal.classList.add("open");
}

function closeOrderModal() {
  orderModal.classList.remove("open");
  orderNote.value = "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadOpenOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .is("admin_closed_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const box = document.getElementById("ordersList");

  if (!(data || []).length) {
    box.innerHTML = `<div class="empty-card">Nessuna comanda aperta</div>`;
    return;
  }

  box.innerHTML = data.map(order => `
    <article class="reservation-card">
      <div class="reservation-top">
        <div>
          <h3 class="reservation-name">Tavolo ${escapeHtml(order.table_code)}</h3>
          <div class="reservation-meta">
            <span>🕒 ${new Date(order.created_at).toLocaleString("it-IT")}</span>
            ${order.note ? `<span>📝 ${escapeHtml(order.note)}</span>` : ""}
          </div>
          <div class="mini-note">
            ${(order.order_items || []).map(i => `${escapeHtml(i.item_name)} x${i.qty}`).join(" · ")}
          </div>
        </div>
      </div>
    </article>
  `).join("");
}

async function loadSelectableReservations() {
  const today = new Date();
  const fromISO = today.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("reservations")
    .select("id, customer_name, reservation_date, reservation_time, assigned_table_code, status")
    .gte("reservation_date", fromISO)
    .in("status", ["confirmed", "arrived"])
    .not("assigned_table_code", "is", null)
    .order("reservation_date", { ascending: true })
    .order("reservation_time", { ascending: true });

  if (error) throw error;

  selectableReservations = data || [];

  orderTableSelect.innerHTML = selectableReservations.length
    ? selectableReservations.map(r => `
        <option value="${escapeHtml(r.assigned_table_code)}">
          ${escapeHtml(r.assigned_table_code)} - ${escapeHtml(r.customer_name)} - ${escapeHtml(r.reservation_date)} ${escapeHtml(String(r.reservation_time).slice(0,5))}
        </option>
      `).join("")
    : `<option value="">Nessun tavolo prenotato disponibile</option>`;
}

async function loadMenuItems() {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  menuItems = data || [];
}

function buildMenuPicker() {
  const grouped = {};
  menuItems.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  orderMenuWrap.innerHTML = Object.entries(grouped).map(([category, items]) => `
    <div class="menu-group">
      <h3 style="margin-bottom:10px;">${escapeHtml(category)}</h3>
      ${items.map(item => `
        <div class="menu-item-row" data-id="${item.id}" data-name="${escapeHtml(item.name)}" data-price="${item.price}">
          <div>
            <strong>${escapeHtml(item.name)}</strong><br>
            <span style="color:var(--muted)">€${Number(item.price || 0).toFixed(2)}</span>
          </div>
          <div class="qty-controls">
            <button class="btn btn-soft qty-dec" type="button">−</button>
            <strong class="qty-value">0</strong>
            <button class="btn btn-primary qty-inc" type="button">+</button>
          </div>
        </div>
      `).join("")}
    </div>
  `).join("");

  document.querySelectorAll(".menu-item-row").forEach(row => {
    let qty = 0;
    const valueEl = row.querySelector(".qty-value");
    row.querySelector(".qty-inc").addEventListener("click", () => {
      qty++;
      valueEl.textContent = String(qty);
      row.dataset.qty = String(qty);
    });
    row.querySelector(".qty-dec").addEventListener("click", () => {
      qty = Math.max(0, qty - 1);
      valueEl.textContent = String(qty);
      row.dataset.qty = String(qty);
    });
    row.dataset.qty = "0";
  });
}

async function createOrder() {
  const tableCode = orderTableSelect.value;
  if (!tableCode) {
    alert("Seleziona un tavolo.");
    return;
  }

  const rows = Array.from(document.querySelectorAll(".menu-item-row"));
  const items = rows
    .map(r => ({
      menu_item_id: r.dataset.id,
      item_name: r.dataset.name,
      qty: Number(r.dataset.qty || "0")
    }))
    .filter(x => x.qty > 0);

  if (!items.length) {
    alert("Seleziona almeno un piatto.");
    return;
  }

  const session = await requireAuth();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert([{
      table_code: tableCode,
      created_by: session.user.id,
      note: orderNote.value.trim(),
      status: "open"
    }])
    .select()
    .single();

  if (orderError) {
    alert("Errore creazione ordine: " + orderError.message);
    return;
  }

  const rowsToInsert = items.map(i => ({
    order_id: order.id,
    menu_item_id: i.menu_item_id,
    item_name: i.item_name,
    qty: i.qty,
    line_status: "todo",
    served: false
  }));

  const { error: itemError } = await supabase
    .from("order_items")
    .insert(rowsToInsert);

  if (itemError) {
    alert("Errore righe ordine: " + itemError.message);
    return;
  }

  closeOrderModal();
  await loadOpenOrders();
}

document.getElementById("openDrawerBtn").addEventListener("click", openDrawer);
document.getElementById("closeDrawerBtn").addEventListener("click", closeDrawer);
document.getElementById("drawerOverlay").addEventListener("click", closeDrawer);
document.getElementById("logoutBtn").addEventListener("click", doLogout);

document.getElementById("openOrderModalBtn").addEventListener("click", async () => {
  await loadSelectableReservations();
  await loadMenuItems();
  buildMenuPicker();
  openOrderModal();
});

document.getElementById("closeOrderModalBtn").addEventListener("click", closeOrderModal);
document.getElementById("cancelOrderModalBtn").addEventListener("click", closeOrderModal);
document.getElementById("saveOrderBtn").addEventListener("click", createOrder);

orderModal.addEventListener("click", (e) => {
  if (e.target === orderModal) closeOrderModal();
});

await requireAuth();
await loadOpenOrders();
