import supabase from "./supabase-client.js";

export async function getOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createOrder(order) {
  const { data, error } = await supabase
    .from("orders")
    .insert([order])
    .select();

  if (error) throw error;
  return data;
}

export async function createOrderItem(item) {
  const { data, error } = await supabase
    .from("order_items")
    .insert([item])
    .select();

  if (error) throw error;
  return data;
}
