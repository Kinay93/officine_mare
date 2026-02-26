/* ============================================================
   OFFICINE MARE — BACKEND SUPABASE
   ALLINEATO AL DB REALE
   ============================================================ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

let supabase = null;

/* ============================================================
   INIT CLIENT
   ============================================================ */

export function getClient() {
  if (!supabase) {

    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      console.error("Supabase config non trovata. Carica prima supabase-config.js");
      return null;
    }

    supabase = createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );

    console.log("[OM] Supabase inizializzato correttamente.");
  }

  return supabase;
}

/* ============================================================
   MENU DEL GIORNO
   ============================================================ */

export async function getMenuDay(dateISO) {
  const sb = getClient();
  if (!sb) return null;

  const { data, error } = await sb
    .from("menu_day")
    .select("*")
    .eq("day", dateISO)
    .maybeSingle();

  if (error) {
    console.error("Errore getMenuDay:", error);
    return null;
  }

  return data;
}

export async function upsertMenuDay(day, text, image_url) {
  const sb = getClient();
  if (!sb) return;

  const { error } = await sb
    .from("menu_day")
    .upsert([{ day, text, image_url }], { onConflict: "day" });

  if (error) console.error("Errore upsertMenuDay:", error);
}

/* ============================================================
   MENU ITEMS
   ============================================================ */

export async function getMenuItems() {
  const sb = getClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from("menu_items")
    .select("*")
    .eq("active", true)
    .order("category");

  if (error) {
    console.error("Errore getMenuItems:", error);
    return [];
  }

  return data;
}

/* ============================================================
   TAVOLI
   ============================================================ */

export async function getTables() {
  const sb = getClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from("restaurant_tables")
    .select("*")
    .order("code");

  if (error) {
    console.error("Errore getTables:", error);
    return [];
  }

  return data;
}

export async function setTableOpen(table_code, isOpen) {
  const sb = getClient();
  if (!sb) return;

  const { error } = await sb
    .from("restaurant_tables")
    .update({ is_open: isOpen })
    .eq("code", table_code);

  if (error) console.error("Errore setTableOpen:", error);
}

/* ============================================================
   PRENOTAZIONI
   ============================================================ */

export async function getReservationsRange(startDate, endDate) {
  const sb = getClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from("reservations")
    .select(`
      *,
      reservation_tables (
        table_code
      )
    `)
    .gte("reservation_date", startDate)
    .lte("reservation_date", endDate)
    .order("reservation_date");

  if (error) {
    console.error("Errore getReservationsRange:", error);
    return [];
  }

  return data;
}

export async function confirmReservation(reservationId, tableCodes) {
  const sb = getClient();
  if (!sb) return;

  await sb
    .from("reservations")
    .update({ status: "confirmed" })
    .eq("id", reservationId);

  if (tableCodes?.length) {

    const rows = tableCodes.map(code => ({
      reservation_id: reservationId,
      table_code: code
    }));

    await sb.from("reservation_tables").insert(rows);

    for (const code of tableCodes) {
      await setTableOpen(code, true);
    }
  }
}

/* ============================================================
   ORDINI
   ============================================================ */

export async function createOrder(table_code, items) {
  const sb = getClient();
  if (!sb) return null;

  const { data: order, error } = await sb
    .from("orders")
    .insert([{ table_code }])
    .select()
    .single();

  if (error) {
    console.error("Errore createOrder:", error);
    return null;
  }

  const rows = items.map(i => ({
    order_id: order.id,
    menu_item_id: i.menu_item_id || null,
    item_name: i.item_name,
    qty: i.qty
  }));

  await sb.from("order_items").insert(rows);

  return order;
}

export async function getOpenOrdersAdmin() {
  const sb = getClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from("orders")
    .select(`
      *,
      order_items (*)
    `)
    .is("admin_closed_at", null)
    .order("created_at");

  if (error) {
    console.error("Errore getOpenOrdersAdmin:", error);
    return [];
  }

  return data;
}

export async function getOpenOrdersKitchen() {
  const sb = getClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from("orders")
    .select(`
      *,
      order_items (*)
    `)
    .eq("kitchen_closed", false)
    .order("created_at");

  if (error) {
    console.error("Errore getOpenOrdersKitchen:", error);
    return [];
  }

  return data;
}

/* ============================================================
   STATO PIATTI
   ============================================================ */

export async function setItemReady(itemId) {
  const sb = getClient();
  if (!sb) return;

  const { error } = await sb
    .from("order_items")
    .update({
      line_status: "ready",
      ready_at: new Date().toISOString()
    })
    .eq("id", itemId);

  if (error) console.error("Errore setItemReady:", error);
}

export async function setItemServed(itemId) {
  const sb = getClient();
  if (!sb) return;

  const { data } = await sb
    .from("order_items")
    .select("served")
    .eq("id", itemId)
    .single();

  if (data?.served) return; // IRREVERSIBILE

  const { error } = await sb
    .from("order_items")
    .update({
      served: true,
      served_at: new Date().toISOString()
    })
    .eq("id", itemId);

  if (error) console.error("Errore setItemServed:", error);
}

/* ============================================================
   CHIUSURE
   ============================================================ */

export async function closeKitchenOrder(orderId) {
  const sb = getClient();
  if (!sb) return;

  const { error } = await sb
    .from("orders")
    .update({
      kitchen_closed: true,
      kitchen_closed_at: new Date().toISOString()
    })
    .eq("id", orderId);

  if (error) console.error("Errore closeKitchenOrder:", error);
}

export async function closeAdminOrder(orderId) {
  const sb = getClient();
  if (!sb) return;

  const { data: order } = await sb
    .from("orders")
    .select("table_code")
    .eq("id", orderId)
    .single();

  const { error } = await sb
    .from("orders")
    .update({
      admin_closed_at: new Date().toISOString(),
      status: "archived"
    })
    .eq("id", orderId);

  if (error) {
    console.error("Errore closeAdminOrder:", error);
    return;
  }

  if (order?.table_code) {
    await setTableOpen(order.table_code, false);
  }
}
