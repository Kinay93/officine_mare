import supabase from "./supabase-client.js";

export async function markConfirmationSent(reservationId) {
  const { data, error } = await supabase
    .from("reservations")
    .update({
      confirmation_sent: true,
      confirmation_sent_at: new Date().toISOString()
    })
    .eq("id", reservationId)
    .select();

  if (error) throw error;
  return data;
}

export async function sendReservationConfirmation(payload) {
  const response = await fetch("YOUR_ENDPOINT", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Invio conferma fallito");
  }

  return await response.json().catch(() => ({}));
}
