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

  // ---------- PRENOTAZIONI ----------
  async function createBooking(payload) {
    const sb = getClient();
    const { data, error } = await sb.from("bookings").insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async function listBookings({ dayISO, status, q } = {}) {
    const sb = getClient();
    await requireAuth();

    let query = sb
      .from("bookings")
      .select("*")
      .order("data", { ascending: true })
      .order("ora", { ascending: true });

    if (dayISO) query = query.eq("data", dayISO);
    if (status && status !== "all") query = query.eq("status", status);

    if (q && q.trim()) {
      const term = q.trim();
      query = query.or(`nome.ilike.%${term}%,telefono.ilike.%${term}%,email.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function updateBooking(id, patch) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.from("bookings").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  // ---------- ORDINI ----------
  async function createOrder({ table_code, note, items }) {
    const sb = getClient();
    await requireAuth();

    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert({
        table_code,
        note: note || null,
        // status admin: "open" | "closed"
        status: "open",
        kitchen_closed_at: null,
      })
      .select()
      .single();

    if (e1) throw e1;

    const rows = (items || []).map((it) => ({
      order_id: order.id,
      name: it.name,
      qty: Number(it.qty || 1),
      price: it.price != null ? Number(it.price) : null,
      line_status: "todo", // todo | ready
      served: false,
      ready_at: null,
      served_at: null,
    }));

    if (rows.length) {
      const { error: e2 } = await sb.from("order_items").insert(rows);
      if (e2) throw e2;
    }

    return order;
  }

  // Admin: vede ordini finché non chiude conto (status != closed)
  async function getOrdersForAdmin() {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("*, order_items(*)")
      .neq("status", "closed")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // Kitchen: vede ordini finché non chiude per cucina (kitchen_closed_at is null) e finché admin non ha chiuso conto
  async function getOrdersForKitchen() {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("*, order_items(*)")
      .is("kitchen_closed_at", null)
      .neq("status", "closed")
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

  // Admin: una volta servito NON si torna indietro (come hai chiesto)
  async function setLineServed(lineId) {
    const sb = getClient();
    await requireAuth();

    const { data: current, error: e0 } = await sb
      .from("order_items")
      .select("served")
      .eq("id", lineId)
      .single();

    if (e0) throw e0;
    if (current?.served) return current;

    const { data, error } = await sb
      .from("order_items")
      .update({ served: true, served_at: new Date().toISOString() })
      .eq("id", lineId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Kitchen: chiude SOLO per cucina (sparisce in kitchen, resta in admin)
  async function closeOrderForKitchen(orderId) {
    const sb = getClient();
    await requireAuth();

    // chiudibile solo se TUTTE le righe sono ready
    const { data: items, error: e1 } = await sb
      .from("order_items")
      .select("id,line_status")
      .eq("order_id", orderId);

    if (e1) throw e1;

    const allReady = (items || []).length > 0 && items.every((x) => x.line_status === "ready");
    if (!allReady) throw new Error("ORDER_NOT_COMPLETE");

    const { data, error: e2 } = await sb
      .from("orders")
      .update({ kitchen_closed_at: new Date().toISOString() })
      .eq("id", orderId)
      .select()
      .single();

    if (e2) throw e2;
    return data;
  }

  // Admin: chiude conto (sparisce anche da kitchen)
  async function closeOrderForAdmin(orderId) {
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .update({ status: "closed" })
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
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, (payload) =>
        onEvent({ table: "bookings", ...payload })
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) =>
        onEvent({ table: "orders", ...payload })
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, (payload) =>
        onEvent({ table: "order_items", ...payload })
      )
      .subscribe();

    return () => sb.removeChannel(channel);
  }

  // ---------- SMS placeholder ----------
  async function sendSMS({ to, message }) {
    const sb = getClient();
    await requireAuth();
    const { data, error } = await sb.functions.invoke("send-sms", { body: { to, message } });
    if (error) throw error;
    return data;
  }

  window.OM = {
    sb: getClient,

    signIn,
    signOut,
    getSession,
    requireAuth,
    getMyRole,

    createBooking,
    listBookings,
    updateBooking,

    createOrder,

    // nuove “view”
    getOrdersForAdmin,
    getOrdersForKitchen,

    setLineReady,
    setLineServed,

    closeOrderForKitchen,
    closeOrderForAdmin,

    subscribeRealtime,
    sendSMS,
  };
})();
