// backend.js (schema-aligned: reservations/orders/order_items/menu_items/menu_day/restaurant_tables)
(function () {
  if (!window.supabase) {
    console.error("Supabase JS non caricato. Aggiungi lo script CDN @supabase/supabase-js v2.");
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

  // ---------- AUTH ----------
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

  // ---------- MENU (menu_items + menu_day) ----------
  async function listMenuItems({ onlyActive = true } = {}) {
    const sb = getClient();
    // menu visibile anche senza login (puoi cambiare con RLS)
    let q = sb.from("menu_items").select("*").order("category", { ascending: true }).order("name", { ascending: true });
    if (onlyActive) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function upsertMenuItem(item) {
    // staff only
    const sb = getClient();
    await requireAuth();
    // item: {id?, name, category, price, active}
    const payload = {
      id: item.id || undefined,
      name: String(item.name || "").trim(),
      category: String(item.category || "Altro").trim(),
      price: item.price == null || item.price === "" ? null : Number(item.price),
      active: item.active !== false,
    };
    const { data, error } = await sb.from("menu_items").upsert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async function setMenuItemActive(id, active) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.from("menu_items").update({ active: !!active }).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  async function getMenuDay(dayISO) {
    const sb = getClient();
    // dayISO: 'YYYY-MM-DD'
    const { data, error } = await sb
      .from("menu_day")
      .select("*")
      .eq("day", dayISO)
      .order("created_at", { ascending: false })
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function saveMenuDay({ dayISO, text, image_url }) {
    const sb = getClient();
    await requireAuth();

    const payload = {
      day: dayISO,
      text: text || null,
      image_url: image_url || null,
    };

    // upsert by day (se hai unique(day) è perfetto; altrimenti crea record multipli ma prendiamo l’ultimo)
    const { data, error } = await sb.from("menu_day").insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  // ---------- TAVOLI ----------
  async function listRestaurantTables() {
    const sb = getClient();
    // staff view (di solito). Se vuoi anche senza login, togli requireAuth e apri RLS.
    await requireAuth();
    const { data, error } = await sb.from("restaurant_tables").select("*").order("code", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  // ---------- PRENOTAZIONI (reservations) ----------
  // Schema reale (dal tuo diagramma):
  // reservations: reservation_date(date), reservation_time(time), people(int),
  // customer_name(text), customer_phone(text), notes(text),
  // status(text), table_code(text), created_at(timestamptz)
  async function createReservation(payload) {
    // payload: { customer_name, customer_phone, reservation_date, reservation_time, people, notes }
    const sb = getClient();

    // NON inseriamo customer_email (non esiste).
    // Se arriva email dal form, la mettiamo dentro notes.
    const clean = {
      reservation_date: payload.reservation_date,
      reservation_time: payload.reservation_time, // "HH:MM:SS" o "HH:MM"
      people: Number(payload.people || 1),
      customer_name: String(payload.customer_name || "").trim(),
      customer_phone: String(payload.customer_phone || "").trim(),
      notes: payload.notes ? String(payload.notes) : null,
      // status e table_code li decide lo staff (o default DB)
    };

    const { data, error } = await sb.from("reservations").insert(clean).select().single();
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
        `customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function updateReservation(id, patch) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.from("reservations").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  // ---------- ORDINI (orders + order_items) ----------
  // orders: id(uuid), table_code(text), status(text check: usa 'open' / 'archived'), created_by(uuid), created_at
  // order_items: id(uuid), order_id, menu_item_id(uuid), item_name(text), qty(int), line_status(text), ready_at, served(bool), served_at
  async function getOpenOrderForTable(table_code) {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("*")
      .eq("table_code", table_code)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async function createOrAppendOrder({ table_code, note, items }) {
    // staff only
    const sb = getClient();
    const session = await requireAuth();

    if (!table_code) throw new Error("TABLE_REQUIRED");
    const cleanItems = (items || []).filter(x => Number(x.qty || 0) > 0);

    if (!cleanItems.length) throw new Error("NO_ITEMS");

    // 1) prendi ordine open del tavolo (se esiste)
    let order = await getOpenOrderForTable(table_code);

    // 2) se non esiste, crealo con status 'open' (NON 'sent')
    if (!order) {
      const { data: created, error: e1 } = await sb
        .from("orders")
        .insert({
          table_code,
          status: "open",
          created_by: session.user.id,
        })
        .select()
        .single();
      if (e1) throw e1;
      order = created;
    }

    // 3) inserisci righe
    const rows = cleanItems.map((it) => ({
      order_id: order.id,
      menu_item_id: it.menu_item_id || null,
      item_name: String(it.item_name || it.name || "").trim(),
      qty: Number(it.qty || 1),
      line_status: "todo",
      ready_at: null,
      served: false,
      served_at: null,
    }));

    const { error: e2 } = await sb.from("order_items").insert(rows);
    if (e2) throw e2;

    // 4) se note, appendi in notes dell’ordine? (non hai colonna note su orders nel diagramma)
    // quindi la salviamo come riga "nota" fittizia? NO.
    // Per ora: se vuoi note, aggiungi colonna note su orders. Intanto la ignoriamo.
    return order;
  }

  async function getActiveOrdersWithItems() {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("*, order_items(*)")
      .eq("status", "open")
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

  async function setLineServed(lineId, served) {
    const sb = getClient();
    await requireAuth();

    const patch = served
      ? { served: true, served_at: new Date().toISOString() }
      : { served: false, served_at: null };

    const { data, error } = await sb
      .from("order_items")
      .update(patch)
      .eq("id", lineId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

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

    const { data, error: e2 } = await sb
      .from("orders")
      .update({ status: "archived" })
      .eq("id", orderId)
      .select()
      .single();

    if (e2) throw e2;
    return data;
  }

  // ---------- REALTIME ----------
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
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_day" }, (payload) =>
        onEvent({ table: "menu_day", ...payload })
      )
      .subscribe();

    return () => sb.removeChannel(channel);
  }

  // ---------- SMS (placeholder Edge Function) ----------
  async function sendSMS({ to, message }) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.functions.invoke("send-sms", { body: { to, message } });
    if (error) throw error;
    return data;
  }

  window.OM = {
    sb: getClient,

    // auth
    signIn,
    signOut,
    getSession,
    requireAuth,
    getMyRole,

    // menu
    listMenuItems,
    upsertMenuItem,
    setMenuItemActive,
    getMenuDay,
    saveMenuDay,

    // tables
    listRestaurantTables,

    // reservations
    createReservation,
    listReservations,
    updateReservation,

    // orders
    getOpenOrderForTable,
    createOrAppendOrder,
    getActiveOrdersWithItems,
    setLineReady,
    setLineServed,
    archiveOrderIfComplete,

    // realtime
    subscribeRealtime,

    // sms
    sendSMS,
  };
})();
