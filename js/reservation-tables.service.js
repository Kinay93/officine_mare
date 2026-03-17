import supabase from "./supabase-client.js";

export async function getReservationTables(reservationId) {
  const { data, error } = await supabase
    .from("reservation_tables")
    .select("*")
    .eq("reservation_id", reservationId);

  if (error) throw error;
  return data || [];
}

export async function setReservationTables(reservationId, tableCodes) {
  const { error: deleteError } = await supabase
    .from("reservation_tables")
    .delete()
    .eq("reservation_id", reservationId);

  if (deleteError) throw deleteError;

  if (!tableCodes || !tableCodes.length) return true;

  const rows = tableCodes.map(code => ({
    reservation_id: reservationId,
    table_code: code
  }));

  const { error: insertError } = await supabase
    .from("reservation_tables")
    .insert(rows);

  if (insertError) throw insertError;

  const { error: updateError } = await supabase
    .from("reservations")
    .update({ assigned_table_code: tableCodes[0] })
    .eq("id", reservationId);

  if (updateError) throw updateError;

  return true;
}
