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

export async function deleteMenuItem(id) {
  const { error } = await supabase
    .from("menu_items")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return true;
}

export async function saveMenuDay(payload) {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  const { data: existing } = await supabase
    .from("menu_day")
    .select("id")
    .eq("day", day)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("menu_day")
      .update(payload)
      .eq("id", existing.id)
      .select();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("menu_day")
    .insert([{ day, ...payload }])
    .select();

  if (error) throw error;
  return data;
}

export async function getMenuDay() {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  const { data, error } = await supabase
    .from("menu_day")
    .select("*")
    .eq("day", day)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}
