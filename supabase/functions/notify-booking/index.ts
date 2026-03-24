import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  try {
    const body = await req.json();

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const TO_EMAIL = Deno.env.get("TO_EMAIL");

    if (!RESEND_API_KEY || !TO_EMAIL) {
      return new Response(
        JSON.stringify({ error: "Missing env vars" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const serviceLabel =
      body.service === "dinner" ? "Cena" : "Pranzo";

    const html = `
      <div style="font-family: Arial, sans-serif; color: #17365d;">
        <h2>Nuova prenotazione ricevuta</h2>
        <p><strong>Nome:</strong> ${body.customer_name}</p>
        <p><strong>Telefono:</strong> ${body.customer_phone}</p>
        <p><strong>Data:</strong> ${body.reservation_date}</p>
        <p><strong>Ora:</strong> ${body.reservation_time}</p>
        <p><strong>Persone:</strong> ${body.people}</p>
        <p><strong>Servizio:</strong> ${serviceLabel}</p>
        <p><strong>Note:</strong> ${body.notes || "-"}</p>
        <hr>
        <p style="font-size: 13px; color: #5c6f8f;">
          Prenotazione ricevuta dal sito Officine Mare.
        </p>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Officine Mare <onboarding@resend.dev>",
        to: [TO_EMAIL],
        subject: "Nuova prenotazione - Officine Mare",
        html
      })
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      return new Response(JSON.stringify(resendData), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(
      JSON.stringify({ ok: true, resendData }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
});
