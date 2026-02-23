// backend.js
(function () {
  // Richiede: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  if (!window.supabase) {
    console.error("Supabase JS non caricato. Aggiungi CDN @supabase/supabase-js v2.");
    return;
  }

  const { createClient } = window.supabase;

  function getClient() {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      throw new Error("Manca SUPABASE_URL o SUPABASE_ANON_KEY (supabase-config.js).");
    }
    if (!window.__sb) {
      window.__sb = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
        realtime: { params: { eventsPerSecond: 10 } },
      });
    }
    return window.__sb;
  }

  // ----------------- Helpers -----------------
  function csvFromTables(tables) {
    if (!tables) return null;
    if (Array.isArray(tables)) {
      const clean = tables.map(String).map(s => s.trim()).filter(Boolean);
      return clean.length ? clean.join(",") : null;
    }
    const s = String(tables).trim();
    return s ? s : null;
  }

  function tablesFromCsv(csv) {
    if (!csv) return [];
    return String(csv).split(",").map(s => s.trim()).filter(Boolean);
  }

  // ----------------- AUTH -----------------
  async function signIn(email, password) {
    const sb = getClient();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const sb = getClient();
    const { error } = await sb.auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const sb = getClient();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function requireAuth() {
    const session = await getSession();
    if (!session) throw new Error("NON_AUTHENTICATED");
    return session;
  }

  async function getMyRole() {
    const sb = getClient();
    const session = await getSession();
    if (!session) return null;

    const { data, error } = await sb
      .from("staff_users")
      .select("role")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error) throw error;
    return data?.role || null;
  }

  // ----------------- TABLES -----------------
  async function listRestaurantTables() {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb
      .from("restaurant_tables")
      .select("*")
      .order("code", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function setTableOpen(code, is_open) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb
      .from("restaurant_tables")
      .update({ is_open: !!is_open })
      .eq("code", code)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ----------------- RESERVATIONS (CLIENT INSERT / STAFF READ+UPDATE) -----------------
  // Schema: reservations(
  //  id uuid, reservation_date date, reservation_time time, people,
  //  customer_name, customer_phone, notes, status, table_code, created_at
  // )
  async function createReservation(payload) {
    // payload UI: { nome, telefono, email?, data, ora, persone, note }
    const sb = getClient();

    const notesParts = [];
    if (payload?.note) notesParts.push(String(payload.note));
    if (payload?.email) notesParts.push(`Email: ${String(payload.email).trim()}`);
    const notes = notesParts.join("\n").trim() || null;

    const row = {
      reservation_date: payload.data,         // YYYY-MM-DD
      reservation_time: payload.ora,          // HH:MM
      people: Number(payload.persone || 1),
      customer_name: String(payload.nome || "").trim(),
      customer_phone: String(payload.telefono || "").trim() || null,
      notes,
      status: "pending",                      // usa "pending" come default (staff lo cambia)
      table_code: null,                       // assegnazione dopo (multi in CSV)
    };

    const { data, error } = await sb.from("reservations").insert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function listReservations({ dayISO, status, q } = {}) {
    const sb = getClient();
    await requireAuth();

    let query = sb
      .from("reservations")
      .select("*")
      .order("reservation_date", { ascending: true })
      .order("reservation_time", { ascending: true });

    if (dayISO) query = query.eq("reservation_date", dayISO);
    if (status && status !== "all") query = query.eq("status", status);

    if (q && q.trim()) {
      const term = q.trim();
      query = query.or(
        `customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,notes.ilike.%${term}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function updateReservation(id, patch) {
    const sb = getClient();
    await requireAuth();

    // patch permessi: status, notes, table_code, people, reservation_date/time, customer_*
    const safePatch = { ...patch };

    if (safePatch.table_code && Array.isArray(safePatch.table_code)) {
      safePatch.table_code = csvFromTables(safePatch.table_code);
    }

    const { data, error } = await sb
      .from("reservations")
      .update(safePatch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function assignReservationTables(reservationId, tableCodesArray) {
    return updateReservation(reservationId, { table_code: csvFromTables(tableCodesArray) });
  }

  // ----------------- MENU ITEMS -----------------
  async function listMenuItems({ activeOnly = true } = {}) {
    const sb = getClient();
    await requireAuth();

    let q = sb.from("menu_items").select("*").order("category", { ascending: true }).order("name", { ascending: true });
    if (activeOnly) q = q.eq("active", true);

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function createMenuItem({ name, category, price, active = true }) {
    const sb = getClient();
    await requireAuth();

    const row = {
      name: String(name || "").trim(),
      category: String(category || "").trim() || null,
      price: price != null ? Number(price) : null,
      active: !!active,
    };

    const { data, error } = await sb.from("menu_items").insert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function updateMenuItem(id, patch) {
    const sb = getClient();
    await requireAuth();

    const safe = { ...patch };
    if (safe.price != null) safe.price = Number(safe.price);

    const { data, error } = await sb.from("menu_items").update(safe).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  async function deactivateMenuItem(id) {
    return updateMenuItem(id, { active: false });
  }

  // ----------------- MENU DAY (foto/testo del giorno) -----------------
  // menu_day: id, day, text, image_url, created_at
  async function getMenuDay(dayISO) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb
      .from("menu_day")
      .select("*")
      .eq("day", dayISO)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function upsertMenuDay({ day, text, image_url }) {
    const sb = getClient();
    await requireAuth();

    const row = {
      day,
      text: text != null ? String(text) : null,
      image_url: image_url != null ? String(image_url) : null,
    };

    // upsert su "day" (serve unique index su day; se non c'è, fa insert e basta)
    const { data, error } = await sb.from("menu_day").upsert(row, { onConflict: "day" }).select().single();
    if (error) throw error;
    return data;
  }

  // ----------------- ORDERS + ORDER ITEMS -----------------
  // orders: id, table_code, status, created_by, created_at
  // order_items: id, order_id, menu_item_id, item_name, qty, line_status, ready_at, served, served_at

  // IMPORTANT: il tuo DB ha un CHECK su orders.status -> NON usare "sent".
  // Usiamo: "open" e "archived"
  async function createOrder({ table_code, note, items }) {
    const sb = getClient();
    const session = await requireAuth();

    // 1) order
    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert({
        table_code: String(table_code),
        status: "open",
        created_by: session.user.id,
      })
      .select()
      .single();

    if (e1) throw e1;

    // 2) order_items
    const rows = (items || [])
      .filter(it => Number(it.qty || 0) > 0)
      .map((it) => ({
        order_id: order.id,
        menu_item_id: it.menu_item_id || null,
        item_name: String(it.item_name || it.name || "").trim(),
        qty: Number(it.qty || 1),
        line_status: "todo",
        ready_at: null,
        served: false,
        served_at: null,
      }));

    if (rows.length) {
      const { error: e2 } = await sb.from("order_items").insert(rows);
      if (e2) throw e2;
    }

    // opzionale: nota -> la mettiamo in "notes" non esiste in orders, quindi NO DB.
    // La gestiamo lato UI (local) oppure in futuro aggiungiamo colonna.
    return order;
  }

  async function getActiveOrdersWithItems() {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("*, order_items(*)")
      .neq("status", "archived")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function setLineReady(lineId, ready) {
    const sb = getClient();
    await requireAuth();

    const patch = ready
      ? { line_status: "ready", ready_at: new Date().toISOString() }
      : { line_status: "todo", ready_at: null };

    const { data, error } = await sb
      .from("order_items")
      .update(patch)
      .eq("id", lineId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // SERVITO: una volta true NON si torna indietro (richiesta tua)
  async function setLineServed(lineId) {
    const sb = getClient();
    await requireAuth();

    // check stato attuale
    const { data: cur, error: e0 } = await sb
      .from("order_items")
      .select("served")
      .eq("id", lineId)
      .single();
    if (e0) throw e0;

    if (cur?.served) return cur;

    const { data, error } = await sb
      .from("order_items")
      .update({ served: true, served_at: new Date().toISOString() })
      .eq("id", lineId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Admin: chiudi comanda a mano (archived)
  async function archiveOrder(orderId) {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .update({ status: "archived" })
      .eq("id", orderId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Cucina: archivia solo quando TUTTE le righe sono ready (come avevi chiesto)
  async function archiveOrderIfComplete(orderId) {
    const sb = getClient();
    await requireAuth();

    const { data: items, error: e1 } = await sb
      .from("order_items")
      .select("id,line_status")
      .eq("order_id", orderId);
    if (e1) throw e1;

    const allReady = (items || []).length > 0 && items.every((x) => x.line_status === "ready");
    if (!allReady) throw new Error("ORDER_NOT_COMPLETE");

    return archiveOrder(orderId);
  }

  // ----------------- REALTIME -----------------
  function subscribeRealtime(onEvent) {
    const sb = getClient();
    const channel = sb
      .channel("om-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, (payload) =>
        onEvent({ table: "reservations", ...payload })
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) =>
        onEvent({ table: "orders", ...payload })
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, (payload) =>
        onEvent({ table: "order_items", ...payload })
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, (payload) =>
        onEvent({ table: "menu_items", ...payload })
      )
      .subscribe();

    return () => sb.removeChannel(channel);
  }

  // ----------------- SMS (placeholder Edge Function) -----------------
  async function sendSMS({ to, message }) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.functions.invoke("send-sms", { body: { to, message } });
    if (error) throw error;
    return data;
  }

  // Export globale
  window.OM = {
    sb: getClient,

    // auth
    signIn,
    signOut,
    getSession,
    requireAuth,
    getMyRole,

    // tables
    listRestaurantTables,
    setTableOpen,

    // reservations
    createReservation,
    listReservations,
    updateReservation,
    assignReservationTables,
    tablesFromCsv,

    // menu items
    listMenuItems,
    createMenuItem,
    updateMenuItem,
    deactivateMenuItem,

    // menu day
    getMenuDay,
    upsertMenuDay,

    // orders
    createOrder,
    getActiveOrdersWithItems,
    setLineReady,
    setLineServed,        // one-way
    archiveOrder,
    archiveOrderIfComplete,

    // realtime
    subscribeRealtime,

    // sms
    sendSMS,
  };
})();
