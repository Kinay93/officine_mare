// backend.js
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

  // ---------- HELPERS ----------
  function uniq(arr) {
    return Array.from(new Set((arr || []).map(String).map(s => s.trim()).filter(Boolean)));
  }
  function joinTablesInNotes(existingNotes, tableCodes) {
    const codes = uniq(tableCodes);
    if (!codes.length) return existingNotes || null;

    const tag = `TAVOLI: ${codes.join(",")}`;
    const base = (existingNotes || "").trim();

    // rimuovi eventuale vecchio "TAVOLI: ..."
    const cleaned = base.replace(/(?:^|\n)TAVOLI:\s*[^\n]*/g, "").trim();
    const out = (cleaned ? cleaned + "\n" : "") + tag;
    return out.trim();
  }
  function firstTableOrNull(tableCodes) {
    const codes = uniq(tableCodes);
    return codes.length ? codes[0] : null;
  }

  // =========================
  // ====== RESERVATIONS =====
  // =========================
  // Schema reale:
  // reservations: id, reservation_date (date), reservation_time (time),
  // people (int), customer_name, customer_phone, notes, status, table_code, created_at

  async function createReservation(payload) {
    // payload UI: { name, phone, email?, date, time, people, notes, table_codes? }
    const sb = getClient();

    // insert client (se RLS permette insert anon). Se hai RLS che blocca, va fatto con policy.
    const tableCodes = uniq(payload.table_codes || []);
    const insertRow = {
      reservation_date: payload.date,          // YYYY-MM-DD
      reservation_time: payload.time,          // HH:MM
      people: Number(payload.people || 1),
      customer_name: payload.name || payload.customer_name || "",
      customer_phone: payload.phone || payload.customer_phone || "",
      status: payload.status || "pending",
      table_code: firstTableOrNull(tableCodes), // FK valida solo per 1 tavolo
      notes: joinTablesInNotes(
        (payload.notes || "") + (payload.email ? `\nEMAIL: ${payload.email}` : ""),
        tableCodes
      ),
    };

    const { data, error } = await sb.from("reservations").insert(insertRow).select().single();
    if (error) throw error;
    return data;
  }

  async function listReservations({ dayISO, status, q } = {}) {
    const sb = getClient();
    await requireAuth();

    let query = sb
      .from("reservations")
      .select("*")
      .order("reservation_time", { ascending: true });

    if (dayISO) query = query.eq("reservation_date", dayISO);
    if (status && status !== "all" && status !== "Tutti" && status !== "Tutti gli stati") {
      query = query.eq("status", status);
    }

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

    // patch può contenere table_codes (multi)
    const tableCodes = patch.table_codes ? uniq(patch.table_codes) : null;

    const rowPatch = { ...patch };
    delete rowPatch.table_codes;

    if (tableCodes) {
      rowPatch.table_code = firstTableOrNull(tableCodes);
      // Merge in notes
      rowPatch.notes = joinTablesInNotes(patch.notes ?? null, tableCodes);
    }

    const { data, error } = await sb
      .from("reservations")
      .update(rowPatch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function assignReservationTables(reservationId, tableCodes) {
    const codes = uniq(tableCodes);
    if (!codes.length) throw new Error("NO_TABLE_SELECTED");

    // serve FK valida sul primo tavolo
    return updateReservation(reservationId, {
      table_codes: codes,
    });
  }

  // =====================
  // ====== TABLES =======
  // =====================
  // restaurant_tables: code (pk), seats, is_open, created_at
  async function listRestaurantTables() {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.from("restaurant_tables").select("*").order("code", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function setTableOpen(code, isOpen) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb
      .from("restaurant_tables")
      .update({ is_open: !!isOpen })
      .eq("code", code)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // =====================
  // ====== MENU =========
  // =====================
  // menu_items: id, name, category, price, active, created_at
  async function listMenuItems({ activeOnly = true } = {}) {
    const sb = getClient();
    await requireAuth();
    let q = sb.from("menu_items").select("*").order("category", { ascending: true }).order("name", { ascending: true });
    if (activeOnly) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function createMenuItem({ name, category, price }) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb
      .from("menu_items")
      .insert({ name, category: category || null, price: price != null ? Number(price) : null, active: true })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function setMenuItemActive(id, active) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb
      .from("menu_items")
      .update({ active: !!active })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateMenuItem(id, patch) {
    const sb = getClient();
    await requireAuth();
    const clean = { ...patch };
    if (clean.price != null) clean.price = Number(clean.price);
    const { data, error } = await sb.from("menu_items").update(clean).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  // menu_day: id, day (date), text (text), image_url (text), created_at
  async function getMenuDay(dayISO) {
    const sb = getClient();
    // menu day è pubblico in lettura (idealmente). Se RLS staff-only, allora serve auth.
    const { data, error } = await sb
      .from("menu_day")
      .select("*")
      .eq("day", dayISO)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function setMenuDay(dayISO, { text, image_url }) {
    const sb = getClient();
    await requireAuth();

    // upsert su "day"
    const row = { day: dayISO, text: text || null, image_url: image_url || null };

    const { data, error } = await sb
      .from("menu_day")
      .upsert(row, { onConflict: "day" })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // =====================
  // ====== ORDERS =======
  // =====================
  // orders: id, table_code, status, created_by, created_at
  // order_items: id, order_id, menu_item_id, item_name, qty, line_status, ready_at, served, served_at
  //
  // status ammessi: NON usiamo "sent". Usiamo "open" e "closed".
  const ORDER_STATUS_OPEN = "open";
  const ORDER_STATUS_CLOSED = "closed";

  async function createOrder({ table_code, note, items }) {
    const sb = getClient();
    await requireAuth();

    if (!table_code) throw new Error("TABLE_REQUIRED");
    const cleanItems = (items || [])
      .map(it => ({
        menu_item_id: it.menu_item_id || null,
        item_name: it.item_name || it.name || "",
        qty: Number(it.qty || 1),
      }))
      .filter(it => it.item_name && it.qty > 0);

    if (!cleanItems.length) throw new Error("EMPTY_ORDER");

    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert({
        table_code,
        status: ORDER_STATUS_OPEN,
        // note non esiste su orders nello schema: lo mettiamo nella prima riga in item_name se serve
      })
      .select()
      .single();

    if (e1) throw e1;

    const rows = cleanItems.map((it) => ({
      order_id: order.id,
      menu_item_id: it.menu_item_id,
      item_name: (note && note.trim())
        ? `${it.item_name}  — NOTE: ${note.trim()}`
        : it.item_name,
      qty: it.qty,
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
      .neq("status", ORDER_STATUS_CLOSED)
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
    // IMPORTANT: non deve essere reversibile
    const sb = getClient();
    await requireAuth();

    const { data: cur, error: e0 } = await sb
      .from("order_items")
      .select("id,served,served_at")
      .eq("id", lineId)
      .single();

    if (e0) throw e0;
    if (cur?.served) return cur; // già servito -> non fare nulla

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
    // chiude la comanda (admin)
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .update({ status: ORDER_STATUS_CLOSED })
      .eq("id", orderId)
      .select()
      .single();

    if (error) throw error;
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
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables" }, (payload) =>
        onEvent({ table: "restaurant_tables", ...payload })
      )
      .subscribe();

    return () => sb.removeChannel(channel);
  }

  // ---------- SMS (placeholder: Edge Function) ----------
  async function sendSMS({ to, message }) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.functions.invoke("send-sms", {
      body: { to, message },
    });
    if (error) throw error;
    return data;
  }

  // Export
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
    assignReservationTables,

    // tables
    listRestaurantTables,
    setTableOpen,

    // menu
    listMenuItems,
    createMenuItem,
    updateMenuItem,
    setMenuItemActive,
    getMenuDay,
    setMenuDay,

    // orders
    createOrder,
    getActiveOrdersWithItems,
    setLineReady,
    setLineServed, // non reversibile
    closeOrder,

    // realtime
    subscribeRealtime,

    // sms
    sendSMS,
  };
})();
