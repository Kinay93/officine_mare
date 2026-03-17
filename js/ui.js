import supabase from "./supabase-client.js";

export async function getTables() {
  const { data, error } = await supabase
    .from("restaurant_tables")
    .select("*")
    .order("code", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function updateTableStatus(code, is_open) {
  const { data, error } = await supabase
    .from("restaurant_tables")
    .update({ is_open })
    .eq("code", code)
    .select();

  if (error) throw error;
  return data;
}
