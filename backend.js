// backend.js
(function(){
  function assert(cond, msg){ if(!cond) throw new Error(msg); }

  function getClient(){
    assert(window.supabase && window.supabase.createClient, "Supabase JS non caricato (manca CDN @supabase/supabase-js v2).");
    assert(window.SUPABASE_URL && window.SUPABASE_ANON_KEY, "Manca SUPABASE_URL o SUPABASE_ANON_KEY (supabase-config.js).");

    if(!window.__OM_SB){
      window.__OM_SB = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true },
        realtime: { params: { eventsPerSecond: 10 } }
      });
    }
    return window.__OM_SB;
  }

  // ---------- AUTH ----------
  async function signIn(email, password){
    const sb = getClient();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if(error) throw error;
    return data;
  }
  async function signOut(){
    const sb = getClient();
    const { error } = await sb.auth.signOut();
    if(error) throw error;
  }
  async function getSession(){
    const sb = getClient();
    const { data, error } = await sb.auth.getSession();
    if(error) throw error;
    return data.session;
  }
  async function requireAuth(){
    const s = await getSession();
    if(!s) throw new Error("NON_AUTHENTICATED");
    return s;
  }
  async function getMyRole(){
    const sb = getClient();
    const s = await getSession();
    if(!s) return null;

    const { data, error } = await sb
      .from("staff_users")
      .select("role")
      .eq("user_id", s.user.id)
      .maybeSingle();

    if(error) throw error;
    return data?.role || null;
  }

  // ---------- UTILS ----------
  const isoNow = () => new Date().toISOString();
  const uniq = (arr) => Array.from(new Set((arr||[]).filter(Boolean)));

  // ============================================================
  // CLIENT: RESERVATIONS
  // ============================================================
  async function createReservation(payload){
    const sb = getClient();
    const { data, error } = await sb
      .from("reservations")
      .insert([payload])
      .select()
      .single();
    if(error) throw error;
    return data;
  }

  // ============================================================
  // MENU DAY
  // ============================================================
  async function getMenuDay(dayISO){
    const sb = getClient();
    const { data, error } = await sb
      .from("menu_day")
      .select("*")
      .eq("day", dayISO)
      .maybeSingle();
    if(error) throw error;
    return data;
  }

  // ============================================================
  // STAFF: TABLES
  // ============================================================
  async function listRestaurantTables(){
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("restaurant_tables")
      .select("*")
      .order("code", { ascending: true });
    if(error) throw error;
    return data || [];
  }

  async function setRestaurantTableOpen(tableCode, isOpen){
    const sb = getClient();
    await requireAuth();

    const { error } = await sb
      .from("restaurant_tables")
      .update({ is_open: !!isOpen })
      .eq("code", tableCode);
    if(error) throw error;
    return true;
  }

  // Tavoli con comanda “ancora visibile in admin”
  async function getOpenOrdersTableCodes(){
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("table_code")
      .is("admin_closed_at", null);

    if(error) throw error;
    return new Set((data || []).map(x => x.table_code));
  }

  // ============================================================
  // STAFF: MENU ITEMS
  // ============================================================
  async function listMenuItems({ activeOnly=true } = {}){
    const sb = getClient();
    await requireAuth();

    let q = sb
      .from("menu_items")
      .select("*")
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if(activeOnly) q = q.eq("active", true);

    const { data, error } = await q;
    if(error) throw error;
    return data || [];
  }

  async function upsertMenuItem({ id=null, name, category, price=null, active=true }){
    const sb = getClient();
    await requireAuth();

    const row = { name, category, active };
    if(price !== null && price !== undefined) row.price = price;

    if(id){
      const { data, error } = await sb
        .from("menu_items")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if(error) throw error;
      return data;
    }else{
      const { data, error } = await sb
        .from("menu_items")
        .insert([row])
        .select()
        .single();
      if(error) throw error;
      return data;
    }
  }

  async function setMenuItemActive(id, active){
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("menu_items")
      .update({ active: !!active })
      .eq("id", id)
      .select()
      .single();
    if(error) throw error;
    return data;
  }

  // ============================================================
  // STAFF: RESERVATIONS + TABLE ASSIGN (reservation_tables)
  // ============================================================
  async function listReservationsRange({ fromISO, toISO, status="all", q="" } = {}){
    const sb = getClient();
    await requireAuth();

    let query = sb
      .from("reservations")
      .select("*")
      .gte("reservation_date", fromISO)
      .lte("reservation_date", toISO)
      .order("reservation_date", { ascending: true })
      .order("reservation_time", { ascending: true });

    if(status && status !== "all") query = query.eq("status", status);

    if(q && q.trim()){
      const term = q.trim();
      query = query.or(`customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,notes.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if(error) throw error;
    return data || [];
  }

  async function updateReservation(reservationId, patch){
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("reservations")
      .update(patch)
      .eq("id", reservationId)
      .select()
      .single();
    if(error) throw error;
    return data;
  }

  async function getReservationTables(reservationId){
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("reservation_tables")
      .select("table_code")
      .eq("reservation_id", reservationId);

    if(error) throw error;
    return (data || []).map(x => x.table_code);
  }

  // ✅ robusto: delete + insert
  async function setReservationTables(reservationId, tableCodes){
    const sb = getClient();
    await requireAuth();

    const chosen = uniq(tableCodes);

    const { error: e1 } = await sb
      .from("reservation_tables")
      .delete()
      .eq("reservation_id", reservationId);
    if(e1) throw e1;

    if(chosen.length){
      const rows = chosen.map(code => ({ reservation_id: reservationId, table_code: code }));
      const { error: e2 } = await sb.from("reservation_tables").insert(rows);
      if(e2) throw e2;

      // compat: salva primary su reservations.table_code (opzionale)
      await sb.from("reservations").update({ table_code: chosen[0] }).eq("id", reservationId);
    }else{
      await sb.from("reservations").update({ table_code: null }).eq("id", reservationId);
    }

    return true;
  }

  async function getReservedTableGroups({ fromISO, toISO, statuses=["confirmed","arrived"] } = {}){
    const sb = getClient();
    await requireAuth();

    let query = sb
      .from("reservations")
      .select("id,customer_name,customer_phone,reservation_date,reservation_time,status")
      .gte("reservation_date", fromISO)
      .lte("reservation_date", toISO)
      .order("reservation_date", { ascending: true })
      .order("reservation_time", { ascending: true });

    if(statuses?.length) query = query.in("status", statuses);

    const { data: res, error } = await query;
    if(error) throw error;

    const out = [];
    for(const r of (res || [])){
      const tables = await getReservationTables(r.id);
      out.push({ reservation: r, tables: (tables || []).slice().sort() });
    }
    return out;
  }

  // ============================================================
  // ORDERS + ORDER_ITEMS
  // ============================================================
  async function createOrder({ table_code, note=null, items }){
    const sb = getClient();
    const session = await requireAuth();

    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert([{
        table_code,
        created_by: session.user.id
        // status default 'open'
      }])
      .select()
      .single();
    if(e1) throw e1;

    const rows = (items || [])
      .filter(x => Number(x.qty) > 0)
      .map(x => ({
        order_id: order.id,
        menu_item_id: x.menu_item_id || null,
        item_name: x.item_name,
        qty: Number(x.qty),
        served: false
      }));

    if(!rows.length) throw new Error("EMPTY_ORDER_ITEMS");

    const { error: e2 } = await sb.from("order_items").insert(rows);
    if(e2) throw e2;

    return order;
  }

  async function getAdminOpenOrdersWithItems(){
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("*, order_items(*)")
      .is("admin_closed_at", null)
      .order("created_at", { ascending: false });

    if(error) throw error;
    return data || [];
  }

  async function getKitchenOpenOrdersWithItems(){
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .select("*, order_items(*)")
      .eq("kitchen_closed", false)
      .order("created_at", { ascending: false });

    if(error) throw error;
    return data || [];
  }

  // compat vecchio nome
  async function getActiveOrdersWithItems(){
    return await getAdminOpenOrdersWithItems();
  }

  async function setLineReady(lineId, ready){
    const sb = getClient();
    await requireAuth();

    const patch = ready
      ? { line_status: "ready", ready_at: isoNow() }
      : { line_status: "todo", ready_at: null };

    const { data, error } = await sb
      .from("order_items")
      .update(patch)
      .eq("id", lineId)
      .select()
      .single();

    if(error) throw error;
    return data;
  }

  // ✅ servito irreversibile
  async function setLineServed(lineId){
    const sb = getClient();
    await requireAuth();

    const { data: cur, error: e0 } = await sb
      .from("order_items")
      .select("served")
      .eq("id", lineId)
      .single();
    if(e0) throw e0;

    if(cur?.served) return cur;

    const { data, error } = await sb
      .from("order_items")
      .update({ served: true, served_at: isoNow() })
      .eq("id", lineId)
      .select()
      .single();

    if(error) throw error;
    return data;
  }

  // ✅ cucina chiude solo cucina (kitchen_closed=true) se tutto pronto
  async function archiveOrderIfComplete(orderId){
    const sb = getClient();
    await requireAuth();

    const { data: items, error: e1 } = await sb
      .from("order_items")
      .select("id,line_status")
      .eq("order_id", orderId);
    if(e1) throw e1;

    const allReady = (items || []).length > 0 && items.every(x => x.line_status === "ready");
    if(!allReady) throw new Error("ORDER_NOT_COMPLETE");

    const { data, error: e2 } = await sb
      .from("orders")
      .update({ kitchen_closed: true, kitchen_closed_at: isoNow() })
      .eq("id", orderId)
      .select()
      .single();

    if(e2) throw e2;
    return data;
  }

  // ✅ admin chiude conto (ordine sparisce da admin)
  async function closeOrder(orderId){
    const sb = getClient();
    await requireAuth();

    const { data, error } = await sb
      .from("orders")
      .update({ admin_closed_at: isoNow(), status: "archived" })
      .eq("id", orderId)
      .select()
      .single();

    if(error) throw error;
    return data;
  }

  // ============================================================
  // REALTIME
  // ============================================================
  function subscribeRealtime(onEvent){
    const sb = getClient();
    const channel = sb
      .channel("om-realtime")
      .on("postgres_changes", { event:"*", schema:"public", table:"reservations" }, payload => onEvent({ table:"reservations", ...payload }))
      .on("postgres_changes", { event:"*", schema:"public", table:"reservation_tables" }, payload => onEvent({ table:"reservation_tables", ...payload }))
      .on("postgres_changes", { event:"*", schema:"public", table:"orders" }, payload => onEvent({ table:"orders", ...payload }))
      .on("postgres_changes", { event:"*", schema:"public", table:"order_items" }, payload => onEvent({ table:"order_items", ...payload }))
      .on("postgres_changes", { event:"*", schema:"public", table:"menu_items" }, payload => onEvent({ table:"menu_items", ...payload }))
      .subscribe();

    return () => sb.removeChannel(channel);
  }

  window.OM = {
    sb: getClient,

    // auth
    signIn, signOut, getSession, requireAuth, getMyRole,

    // cliente
    createReservation,
    getMenuDay,

    // tables
    listRestaurantTables,
    setRestaurantTableOpen,
    getOpenOrdersTableCodes,

    // menu items
    listMenuItems,
    upsertMenuItem,
    setMenuItemActive,

    // reservations
    listReservationsRange,
    updateReservation,
    getReservationTables,
    setReservationTables,
    getReservedTableGroups,

    // orders
    createOrder,
    getActiveOrdersWithItems,
    getAdminOpenOrdersWithItems,
    getKitchenOpenOrdersWithItems,
    setLineReady,
    setLineServed,
    archiveOrderIfComplete,
    closeOrder,

    // realtime
    subscribeRealtime
  };
})();
