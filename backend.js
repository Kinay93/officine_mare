// backend.js (Supabase v2) — allineato allo schema reale
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

  // ---------- MENU ITEMS ----------
  async function listMenuItems({ activeOnly = true } = {}) {
    const sb = getClient();
    await requireAuth();
    let q = sb.from("menu_items").select("*").order("category", { ascending: true }).order("name", { ascending: true });
    if (activeOnly) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function upsertMenuItem(item) {
    const sb = getClient();
    await requireAuth();
    const payload = {
      id: item.id || undefined,
      name: (item.name || "").trim(),
      category: (item.category || "").trim(),
      price: item.price != null ? Number(item.price) : null,
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

  // ---------- TABLES ----------
  async function listRestaurantTables() {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.from("restaurant_tables").select("*").order("code", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  // ✅ NUOVO: apri/chiudi tavolo
  async function setRestaurantTableOpen(code, is_open) {
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

  async function getOpenOrdersTableCodes() {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.from("orders").select("table_code").eq("status", "open");
    if (error) throw error;
    return new Set((data || []).map(x => x.table_code));
  }

  // ---------- RESERVATIONS ----------
  async function listReservationsRange({ fromISO, toISO, status, q } = {}) {
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

  async function getReservationTables(reservationId) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb
      .from("reservation_tables")
      .select("table_code")
      .eq("reservation_id", reservationId);
    if (error) throw error;
    return (data || []).map(x => x.table_code);
  }

  async function setReservationTables(reservationId, tableCodes) {
    const sb = getClient();
    await requireAuth();

    const codes = Array.from(new Set((tableCodes || []).map(x => String(x).trim()).filter(Boolean)));

    const { error: eDel } = await sb.from("reservation_tables").delete().eq("reservation_id", reservationId);
    if (eDel) throw eDel;

    if (codes.length) {
      const rows = codes.map(code => ({ reservation_id: reservationId, table_code: code }));
      const { error: eIns } = await sb.from("reservation_tables").insert(rows);
      if (eIns) throw eIns;
    }

    return codes;
  }

  // ✅ NUOVO: gruppi tavoli prenotati (per filtrare dropdown comande)
  // Ritorna array: [{ reservation, tables:[...sorted] }]
  async function getReservedTableGroups({ fromISO, toISO, statuses } = {}) {
    const sb = getClient();
    await requireAuth();

    const sts = (statuses && statuses.length) ? statuses : ["confirmed", "arrived"];

    const { data: res, error: e1 } = await sb
      .from("reservations")
      .select("id,reservation_date,reservation_time,people,customer_name,customer_phone,status,notes,table_code")
      .gte("reservation_date", fromISO)
      .lte("reservation_date", toISO)
      .in("status", sts)
      .order("reservation_date", { ascending: true })
      .order("reservation_time", { ascending: true });

    if (e1) throw e1;

    if (!res?.length) return [];

    const resIds = res.map(r => r.id);
    const { data: links, error: e2 } = await sb
      .from("reservation_tables")
      .select("reservation_id,table_code")
      .in("reservation_id", resIds);

    if (e2) throw e2;

    const map = new Map();
    res.forEach(r => map.set(r.id, { reservation: r, tables: [] }));
    (links || []).forEach(l => {
      const obj = map.get(l.reservation_id);
      if (obj) obj.tables.push(l.table_code);
    });

    // Se non ci sono link, usa eventualmente reservations.table_code (fallback)
    for (const obj of map.values()) {
      if (!obj.tables.length && obj.reservation?.table_code) obj.tables = [obj.reservation.table_code];
      obj.tables = Array.from(new Set(obj.tables)).sort();
    }

    return Array.from(map.values());
  }

  // ---------- ORDERS ----------
  async function createOrder({ table_code, note, items }) {
    const sb = getClient();
    await requireAuth();

    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert({ table_code, status: "open" })
      .select()
      .single();
    if (e1) throw e1;

    const rows = (items || [])
      .filter(it => Number(it.qty || 0) > 0)
      .map(it => ({
        order_id: order.id,
        menu_item_id: it.menu_item_id || null,
        item_name: it.item_name || it.name || "",
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

  async function setLineServed(lineId) {
    const sb = getClient();
    await requireAuth();

    const { data: cur, error: e0 } = await sb
      .from("order_items")
      .select("served")
      .eq("id", lineId)
      .single();
    if (e0) throw e0;
    if (cur?.served) return cur;

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

  async function closeOrder(orderId) {
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

  async function archiveOrderIfComplete(orderId) {
    const sb = getClient();
    await requireAuth();

    const { data: items, error: e1 } = await sb
      .from("order_items")
      .select("id,line_status")
      .eq("order_id", orderId);
    if (e1) throw e1;

    const allReady = (items || []).length > 0 && items.every(x => x.line_status === "ready");
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
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, (payload) => onEvent({ table: "reservations", ...payload }))
      .on("postgres_changes", { event: "*", schema: "public", table: "reservation_tables" }, (payload) => onEvent({ table: "reservation_tables", ...payload }))
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables" }, (payload) => onEvent({ table: "restaurant_tables", ...payload }))
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => onEvent({ table: "orders", ...payload }))
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, (payload) => onEvent({ table: "order_items", ...payload }))
      .subscribe();

    return () => sb.removeChannel(channel);
  }

  window.OM = {
    sb: getClient,
    signIn, signOut, getSession, requireAuth, getMyRole,

    listMenuItems, upsertMenuItem, setMenuItemActive,

    listRestaurantTables,
    setRestaurantTableOpen,
    getOpenOrdersTableCodes,

    listReservationsRange,
    updateReservation,
    getReservationTables,
    setReservationTables,
    getReservedTableGroups,

    createOrder, getActiveOrdersWithItems, setLineReady, setLineServed, closeOrder, archiveOrderIfComplete,

    subscribeRealtime,
  };
})();
