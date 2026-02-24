// backend.js (Supabase JS v2) - versione robusta/compatibile
(function () {
  // 0) Supabase CDN check
  if (!window.supabase || !window.supabase.createClient) {
    console.error("[OM] Supabase JS non caricato. Aggiungi: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    // comunque espongo OM per evitare crash di pagine che lo chiamano
    window.OM = window.OM || {};
    window.OM.__error = "SUPABASE_CDN_MISSING";
    return;
  }

  const { createClient } = window.supabase;

  // 1) Leggi config con più nomi possibili
  function readConfig() {
    const url =
      window.SUPABASE_URL ||
      window.supabaseUrl ||
      window.SUPABASEURL ||
      window.SB_URL;

    const key =
      window.SUPABASE_ANON_KEY ||
      window.supabaseAnonKey ||
      window.SUPABASE_KEY ||
      window.SB_ANON_KEY;

    return { url, key };
  }

  function assertConfig() {
    const { url, key } = readConfig();
    if (!url || !key) {
      console.error("[OM] Config Supabase mancante o con nomi diversi.", {
        urlFound: !!url,
        keyFound: !!key,
        hint: "Nel supabase-config.js definisci window.SUPABASE_URL e window.SUPABASE_ANON_KEY (o supabaseUrl/supabaseAnonKey).",
      });
      throw new Error("SUPABASE_CONFIG_MISSING");
    }
    return { url, key };
  }

  function getClient() {
    if (window.__sb) return window.__sb;
    const { url, key } = assertConfig();

    window.__sb = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    });

    return window.__sb;
  }

  // ---------------- AUTH ----------------
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
    const s = await getSession();
    if (!s) return null;

    const { data, error } = await sb
      .from("staff_users")
      .select("role")
      .eq("user_id", s.user.id)
      .maybeSingle();

    if (error) throw error;
    return data?.role || null;
  }

  // ---------------- MENU ITEMS (staff) ----------------
  async function listMenuItems({ activeOnly = true } = {}) {
    const sb = getClient();
    await requireAuth();

    let q = sb.from("menu_items").select("*").order("category", { ascending: true }).order("name", { ascending: true });
    if (activeOnly) q = q.eq("active", true);

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function upsertMenuItem(payload) {
    const sb = getClient();
    await requireAuth();

    const clean = {
      id: payload.id || undefined,
      name: payload.name,
      category: payload.category,
      price: payload.price ?? null,
      active: payload.active ?? true,
    };

    const { error } = await sb.from("menu_items").upsert(clean);
    if (error) throw error;
    return true;
  }

  async function setMenuItemActive(id, active) {
    const sb = getClient();
    await requireAuth();

    const { error } = await sb.from("menu_items").update({ active }).eq("id", id);
    if (error) throw error;
    return true;
  }

  // ---------------- MENU DAY (pubblico) ----------------
  async function getMenuDay(dateISO) {
    const sb = getClient();
    const { data, error } = await sb.from("menu_day").select("*").eq("date", dateISO).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // ---------------- RESERVATIONS ----------------
  // pubblico insert (RLS deve permettere)
  async function createReservation(payload) {
    const sb = getClient();

    const row = {
      customer_name: payload.customer_name,
      customer_phone: payload.customer_phone,
      reservation_date: payload.reservation_date,
      reservation_time: payload.reservation_time,
      people: Number(payload.people || 1),
      notes: payload.notes ?? null,
      status: "pending",
    };

    const { data, error } = await sb.from("reservations").insert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function listReservationsRange({ fromISO, toISO, status = "all", q = "" } = {}) {
    const sb = getClient();
    await requireAuth();

    let query = sb
      .from("reservations")
      .select("*")
      .gte("reservation_date", fromISO)
      .lte("reservation_date", toISO)
      .order("reservation_date", { ascending: true })
      .order("reservation_time", { ascending: true });

    if (status && status !== "all") query = query.eq("status", status);

    if (q && q.trim()) {
      const term = q.trim();
      query = query.or(`customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,notes.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function updateReservation(id, patch) {
    const sb = getClient();
    await requireAuth();

    const { error } = await sb.from("reservations").update(patch).eq("id", id);
    if (error) throw error;
    return true;
  }

  async function getReservationTables(reservationId) {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("reservation_tables")
      .select("table_code")
      .eq("reservation_id", reservationId);

    if (error) throw error;
    return (data || []).map((x) => x.table_code);
  }

  async function setReservationTables(reservationId, tableCodes) {
    const sb = getClient();
    await requireAuth();

    const codes = Array.from(new Set((tableCodes || []).filter(Boolean)));

    const { error: delErr } = await sb.from("reservation_tables").delete().eq("reservation_id", reservationId);
    if (delErr) throw delErr;

    if (codes.length) {
      const rows = codes.map((c) => ({ reservation_id: reservationId, table_code: c }));
      const { error: insErr } = await sb.from("reservation_tables").insert(rows);
      if (insErr) throw insErr;
    }

    return true;
  }

  async function getReservedTableGroups({ fromISO, toISO, statuses = ["confirmed", "arrived"] } = {}) {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("reservations")
      .select("*, reservation_tables(table_code)")
      .gte("reservation_date", fromISO)
      .lte("reservation_date", toISO)
      .in("status", statuses)
      .order("reservation_date", { ascending: true })
      .order("reservation_time", { ascending: true });

    if (error) throw error;

    return (data || []).map((r) => ({
      reservation: r,
      tables: (r.reservation_tables || []).map((t) => t.table_code),
    }));
  }

  // ---------------- TABLES ----------------
  async function listRestaurantTables() {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb.from("restaurant_tables").select("*").order("code", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function setRestaurantTableOpen(code, isOpen) {
    const sb = getClient();
    await requireAuth();

    const { error } = await sb.from("restaurant_tables").update({ is_open: !!isOpen }).eq("code", code);
    if (error) throw error;
    return true;
  }

  // ---------------- ORDERS ----------------
  async function createOrder({ table_code, note, items }) {
    const sb = getClient();
    await requireAuth();

    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert({ table_code, note: note || null, kitchen_closed: false, admin_closed_at: null })
      .select()
      .single();
    if (e1) throw e1;

    const rows = (items || []).map((it) => ({
      order_id: order.id,
      menu_item_id: it.menu_item_id || null,
      item_name: it.item_name,
      qty: Number(it.qty || 1),
      price: it.price != null ? Number(it.price) : null,
      line_status: "todo",
      ready_at: null,
      served: false,
      served_at: null,
    }));

    if (rows.length) {
      const { error: e2 } = await sb.from("order_items").insert(rows);
      if (e2) throw e2;
    }

    return order;
  }

  async function getAdminOpenOrdersWithItems() {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("*, order_items(*)")
      .is("admin_closed_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function getKitchenOpenOrdersWithItems() {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("*, order_items(*)")
      .eq("kitchen_closed", false)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function getOpenOrdersTableCodes() {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb.from("orders").select("table_code").is("admin_closed_at", null);
    if (error) throw error;
    return new Set((data || []).map((x) => x.table_code));
  }

  async function setLineReady(lineId, ready) {
    const sb = getClient();
    await requireAuth();

    const patch = ready
      ? { line_status: "ready", ready_at: new Date().toISOString() }
      : { line_status: "todo", ready_at: null };

    const { error } = await sb.from("order_items").update(patch).eq("id", lineId);
    if (error) throw error;
    return true;
  }

  async function setLineServed(lineId) {
    const sb = getClient();
    await requireAuth();

    const { error } = await sb
      .from("order_items")
      .update({ served: true, served_at: new Date().toISOString() })
      .eq("id", lineId);

    if (error) throw error;
    return true;
  }

  async function closeOrder(orderId) {
    const sb = getClient();
    await requireAuth();

    const { error } = await sb.from("orders").update({ admin_closed_at: new Date().toISOString() }).eq("id", orderId);
    if (error) throw error;
    return true;
  }

  async function kitchenCloseIfComplete(orderId) {
    const sb = getClient();
    await requireAuth();

    const { data: items, error: e1 } = await sb.from("order_items").select("id,line_status").eq("order_id", orderId);
    if (e1) throw e1;

    const allReady = (items || []).length > 0 && items.every((x) => x.line_status === "ready");
    if (!allReady) throw new Error("ORDER_NOT_COMPLETE");

    const { error: e2 } = await sb.from("orders").update({ kitchen_closed: true }).eq("id", orderId);
    if (e2) throw e2;

    return true;
  }

  // ---------------- REALTIME ----------------
  function subscribeRealtime(onEvent) {
    const sb = getClient();
    const ch = sb
      .channel("om-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, (p) => onEvent({ table: "reservations", ...p }))
      .on("postgres_changes", { event: "*", schema: "public", table: "reservation_tables" }, (p) => onEvent({ table: "reservation_tables", ...p }))
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => onEvent({ table: "orders", ...p }))
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, (p) => onEvent({ table: "order_items", ...p }))
      .subscribe();

    return () => sb.removeChannel(ch);
  }

  // Export
  window.OM = {
    // debug
    __config: readConfig,
    sb: getClient,

    // auth
    signIn, signOut, getSession, requireAuth, getMyRole,

    // menu
    listMenuItems, upsertMenuItem, setMenuItemActive, getMenuDay,

    // reservations
    createReservation, listReservationsRange, updateReservation,
    getReservationTables, setReservationTables, getReservedTableGroups,

    // tables
    listRestaurantTables, setRestaurantTableOpen, getOpenOrdersTableCodes,

    // orders
    createOrder, getAdminOpenOrdersWithItems, getKitchenOpenOrdersWithItems,
    setLineReady, setLineServed, closeOrder, kitchenCloseIfComplete,

    // realtime
    subscribeRealtime,
  };

  console.log("[OM] backend.js caricato OK. Config found:", window.OM.__config());
})();
