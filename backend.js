// backend.js
(function () {
  // Richiede Supabase JS v2 da CDN
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

  // ---------- MENU ITEMS (menu_items) ----------
  async function listMenuItems({ activeOnly = true } = {}) {
    const sb = getClient();
    await requireAuth(); // staff only
    let q = sb.from("menu_items").select("*").order("created_at", { ascending: false });
    if (activeOnly) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function createMenuItem({ name, category, price, active = true }) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb
      .from("menu_items")
      .insert({
        name: String(name || "").trim(),
        category: String(category || "").trim() || null,
        price: price != null ? Number(price) : null,
        active: !!active,
      })
      .select()
      .single();
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

  async function deactivateMenuItem(id) {
    return updateMenuItem(id, { active: false });
  }

  // ---------- MENU DAY (menu_day) ----------
  async function getMenuDay(dayISO) {
    const sb = getClient();
    // lettura pubblica OK (se fai policy public read) altrimenti metti requireAuth
    const { data, error } = await sb.from("menu_day").select("*").eq("day", dayISO).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function upsertMenuDay({ day, text, image_url }) {
    const sb = getClient();
    await requireAuth(); // staff
    const payload = {
      day,
      text: text ?? null,
      image_url: image_url ?? null,
    };
    // se non hai unique su day, funziona comunque ma inserisce più righe: consigliato mettere UNIQUE(day)
    const { data, error } = await sb.from("menu_day").upsert(payload, { onConflict: "day" }).select().single();
    if (error) throw error;
    return data;
  }

  // ---------- RESERVATIONS (reservations) ----------
  // DB columns: reservation_date (date), reservation_time (time),
  // people, customer_name, customer_phone, customer_email, notes, status, table_code
  async function createReservation(payload) {
    const sb = getClient();

    const cleanTurno = payload.turno ? String(payload.turno).trim() : "";
    const noteBase = String(payload.note || "").trim();
    const notes =
      cleanTurno && !noteBase.startsWith("[turno:")
        ? `[turno:${cleanTurno}] ${noteBase}`.trim()
        : noteBase || null;

    const row = {
      reservation_date: payload.data,           // "YYYY-MM-DD"
      reservation_time: payload.ora,            // "HH:MM"
      people: payload.persone != null ? Number(payload.persone) : null,
      customer_name: String(payload.nome || "").trim(),
      customer_phone: String(payload.telefono || "").trim() || null,
      customer_email: String(payload.email || "").trim() || null,
      notes,
      status: "pending",                        // pending / confirmed / arrived / canceled (decidi tu)
      table_code: payload.table_code || null,   // assegnabile dall'admin dopo
    };

    const { data, error } = await sb.from("reservations").insert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function listReservations({ dayISO, status, q } = {}) {
    const sb = getClient();
    await requireAuth(); // staff only (RLS)

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
        `customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,customer_email.ilike.%${term}%`
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

  // ---------- TABLES (restaurant_tables) ----------
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

  // ---------- ORDERS (orders + order_items) ----------
  // orders columns: id, table_code, status, created_by, created_at
  // order_items columns: id, order_id, menu_item_id, item_name, qty, line_status, ready_at, served, served_at
  async function createOrder({ table_code, note, items }) {
    const sb = getClient();
    const session = await requireAuth();

    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert({
        table_code,
        status: "sent",
        created_by: session.user.id,
      })
      .select()
      .single();

    if (e1) throw e1;

    const rows = (items || [])
      .filter((x) => Number(x.qty) > 0)
      .map((it) => ({
        order_id: order.id,
        menu_item_id: it.menu_item_id || null,
        item_name: String(it.name || it.item_name || "").trim(),
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

    // salva note nel modo più semplice: append alle note in reservation? (non c'è colonna note su orders)
    // nel tuo schema orders non ha "note". Se la vuoi, va aggiunta. Per ora la metto dentro a order_items? NO.
    // Quindi: ignoro note qui per coerenza con schema.
    // Se vuoi note su order, aggiungi colonna "note text" a orders.
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

    const { data, error } = await sb.from("order_items").update(patch).eq("id", lineId).select().single();
    if (error) throw error;
    return data;
  }

  async function setLineServed(lineId, served) {
    const sb = getClient();
    await requireAuth();

    const patch = served
      ? { served: true, served_at: new Date().toISOString() }
      : { served: false, served_at: null };

    const { data, error } = await sb.from("order_items").update(patch).eq("id", lineId).select().single();
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

  // ---------- SMS placeholder (Edge Function) ----------
  async function sendSMS({ to, message }) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.functions.invoke("send-sms", { body: { to, message } });
    if (error) throw error;
    return data;
  }

  // Compat alias: "bookings" -> "reservations"
  window.OM = {
    sb: getClient,

    // auth
    signIn,
    signOut,
    getSession,
    requireAuth,
    getMyRole,

    // reservations
    createReservation,
    listReservations,
    updateReservation,

    // alias vecchi nomi (se qualche pagina li usa ancora)
    createBooking: createReservation,
    listBookings: listReservations,
    updateBooking: updateReservation,

    // menu
    listMenuItems,
    createMenuItem,
    updateMenuItem,
    deactivateMenuItem,
    getMenuDay,
    upsertMenuDay,

    // tables
    listRestaurantTables,

    // orders
    createOrder,
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
