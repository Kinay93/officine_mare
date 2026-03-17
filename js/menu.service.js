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

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function saveMenuDayImage(file) {
  if (!file) throw new Error("Seleziona un file immagine");

  const day = todayISO();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `menu-day-${day}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("menu-day")
    .upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg"
    });

  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage
    .from("menu-day")
    .getPublicUrl(path);

  const image_url = publicData.publicUrl;

  const { data: existing, error: existingError } = await supabase
    .from("menu_day")
    .select("id")
    .eq("day", day)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await supabase
      .from("menu_day")
      .update({ image_url, text: null })
      .eq("id", existing.id);

    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("menu_day")
      .insert([{ day, image_url, text: null }]);

    if (error) throw error;
  }

  return image_url;
}

export async function getMenuDay() {
  const day = todayISO();

  const { data, error } = await supabase
    .from("menu_day")
    .select("*")
    .eq("day", day)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}
