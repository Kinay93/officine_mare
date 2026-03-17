import supabase from "./supabase-client.js";

export async function getMenuItems() {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createMenuItem(item) {
  const { data, error } = await supabase
    .from("menu_items")
    .insert([item])
    .select();

  if (error) throw error;
  return data;
}

export async function updateMenuItem(id, item) {
  const { data, error } = await supabase
    .from("menu_items")
    .update(item)
    .eq("id", id)
    .select();

  if (error) throw error;
  return data;
}

export async function toggleMenuItem(id, active) {
  const { data, error } = await supabase
    .from("menu_items")
    .update({ active })
    .eq("id", id)
    .select();

  if (error) throw error;
  return data;
}
