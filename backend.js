/* backend.js */
(function () {
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
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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
    const s = await getSession();
    if (!s) throw new Error("NON_AUTHENTICATED");
    return s;
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

  // ---------- TABLES ----------
  async function listRestaurantTables() {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.from("restaurant_tables").select("*").order("code");
    if (error) throw error;
    return data || [];
  }

  // ---------- MENU ITEMS (GESTIBILE) ----------
  async function listMenuItems({ activeOnly = true } = {}) {
    const sb = getClient();
    await requireAuth();
    let q = sb.from("menu_items").select("*").order("category").order("name");
    if (activeOnly) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function createMenuItem({ name, category, price }) {
    const sb = getClient();
    await requireAuth();
    const row = { name, category: category || null, price: price != null ? Number(price) : null, active: true };
    const { data, error } = await sb.from("menu_items").insert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function updateMenuItem(id, patch) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.from("menu_items").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  async function setMenuItemActive(id, active) {
    return updateMenuItem(id, { active: !!active });
  }

  // ---------- RESERVATIONS (CLIENT INSERT, STAFF READ/UPDATE) ----------
  // Mappa payload client -> schema reale reservations
  // Schema (dal tuo screenshot): reservation_date, reservation_time, people, customer_name, customer_phone, notes, status, table_code
  async function createReservation(payload) {
    const sb = getClient();

    // payload atteso dal form cliente:
    // { nome, telefono, email?, data, ora, persone, note }
    const notes = [
      payload.note || payload.notes || "",
      payload.email ? `Email: ${payload.email}` : ""
    ].filter(Boolean).join("\n");

    const row = {
      reservation_date: payload.data,                 // YYYY-MM-DD
      reservation_time: payload.ora,                  // HH:MM
      people: Number(payload.persone || payload.people || 1),
      customer_name: payload.nome || payload.customer_name,
      customer_phone: payload.telefono || payload.customer_phone || null,
      notes: notes || null,
      status: "pending",                              // pending | confirmed | arrived | cancelled (coerente con gestionale)
      table_code: payload.table_code || null          // compat: primo tavolo (se lo metti)
    };

    const { data, error } = await sb.from("reservations").insert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function listReservations({ dayISO, status, q } = {}) {
    const sb = getClient();
    await requireAuth();

    // join per mostrare multi tavoli (se esiste reservation_tables)
    let query = sb
      .from("reservations")
      .select("*, reservation_tables(table_code)")
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
    const { data, error } = await sb.from("reservations").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  // Multi-tavolo: salva in reservation_tables e aggiorna table_code su reservations (per compat UI)
  async function setReservationTables(reservationId, tableCodes) {
    const sb = getClient();
    await requireAuth();

    const tables = Array.from(new Set((tableCodes || []).filter(Boolean)));

    // 1) delete vecchie righe
    // (se la tabella non esiste, qui ti darà errore: in quel caso crea reservation_tables)
    const { error: eDel } = await sb
      .from("reservation_tables")
      .delete()
      .eq("reservation_id", reservationId);

    if (eDel) throw eDel;

    // 2) insert nuove
    if (tables.length) {
      const rows = tables.map((t) => ({ reservation_id: reservationId, table_code: t }));
      const { error: eIns } = await sb.from("reservation_tables").insert(rows);
      if (eIns) throw eIns;
    }

    // 3) aggiorna colonna compat (primo tavolo)
    const primary = tables[0] || null;
    await updateReservation(reservationId, { table_code: primary });

    return { ok: true, tables };
  }

  // ---------- ORDERS ----------
  // Schema orders (dal tuo screenshot): id, table_code, status, created_by, created_at
  // Schema order_items: id, order_id, menu_item_id, item_name, qty, line_status, ready_at, served, served_at
  async function createOrder({ table_code, items }) {
    const sb = getClient();
    await requireAuth();

    if (!table_code) throw new Error("Manca table_code");
    if (!items || !items.length) throw new Error("Nessun item");

    // 1) crea ordine
    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert({ table_code, status: "open" })
      .select()
      .single();

    if (e1) throw e1;

    // 2) righe
    const rows = items.map((it) => ({
      order_id: order.id,
      menu_item_id: it.menu_item_id || null,
      item_name: it.item_name || it.name, // compat
      qty: Number(it.qty || 1),
      line_status: "todo",
      ready_at: null,
      served: false,
      served_at: null,
    }));

    const { error: e2 } = await sb.from("order_items").insert(rows);
    if (e2) throw e2;

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

  // ✅ SERVITO: solo “true”, NON si può tornare indietro
  async function setLineServed(lineId) {
    const sb = getClient();
    await requireAuth();

    // se già servito non fare nulla
    const { data: current, error: e0 } = await sb
      .from("order_items")
      .select("served")
      .eq("id", lineId)
      .single();

    if (e0) throw e0;
    if (current?.served) return current;

    const patch = { served: true, served_at: new Date().toISOString() };

    const { data, error } = await sb
      .from("order_items")
      .update(patch)
      .eq("id", lineId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // archivia solo quando TUTTE le righe sono ready (cucina)
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
      .on("postgres_changes", { event: "*", schema: "public", table: "reservation_tables" }, (payload) =>
        onEvent({ table: "reservation_tables", ...payload })
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

    // menu
    listMenuItems,
    createMenuItem,
    updateMenuItem,
    setMenuItemActive,

    // reservations
    createReservation,
    listReservations,
    updateReservation,
    setReservationTables,

    // orders
    createOrder,
    getActiveOrdersWithItems,
    setLineReady,
    setLineServed,
    archiveOrderIfComplete,

    // realtime
    subscribeRealtime,
  };
})();
