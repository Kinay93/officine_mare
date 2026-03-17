import supabase from "./supabase-client.js";

export async function getReservations() {
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .order("reservation_date", { ascending: true })
    .order("reservation_time", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function updateReservationStatus(id, status) {
  const { data, error } = await supabase
    .from("reservations")
    .update({ status })
    .eq("id", id)
    .select();

  if (error) throw error;
  return data;
}

export async function searchReservations(search, status = "all") {
  let query = supabase
    .from("reservations")
    .select("*")
    .order("reservation_date", { ascending: true })
    .order("reservation_time", { ascending: true });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (search && search.trim()) {
    query = query.or(
      `customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
