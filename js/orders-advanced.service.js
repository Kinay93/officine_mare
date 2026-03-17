import supabase from "./supabase-client.js";

export async function getOpenOrdersWithItems() {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .is("admin_closed_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createOrderWithItems({ table_code, note, items }) {
  const { data: orderData, error: orderError } = await supabase
    .from("orders")
    .insert([{
      table_code,
      note: note || null,
      status: "open",
      kitchen_closed: false
    }])
    .select()
    .single();

  if (orderError) throw orderError;

  const rows = items.map(item => ({
    order_id: orderData.id,
    menu_item_id: item.menu_item_id || null,
    item_name: item.item_name,
    qty: Number(item.qty),
    line_status: "todo",
    served: false
  }));

  const { error: itemError } = await supabase
    .from("order_items")
    .insert(rows);

  if (itemError) throw itemError;

  return orderData;
}

export async function setLineServed(lineId) {
  const { data, error } = await supabase
    .from("order_items")
    .update({
      served: true,
      served_at: new Date().toISOString()
    })
    .eq("id", lineId)
    .select();

  if (error) throw error;
  return data;
}

export async function closeAdminOrder(orderId) {
  const { data, error } = await supabase
    .from("orders")
    .update({
      admin_closed_at: new Date().toISOString()
    })
    .eq("id", orderId)
    .select();

  if (error) throw error;
  return data;
}
