import supabase from "./supabase-client.js";

export async function getKitchenOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("kitchen_closed", false)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function setLineReady(lineId, ready) {
  const patch = ready
    ? {
        line_status: "ready",
        ready_at: new Date().toISOString()
      }
    : {
        line_status: "todo",
        ready_at: null
      };

  const { data, error } = await supabase
    .from("order_items")
    .update(patch)
    .eq("id", lineId)
    .select();

  if (error) throw error;
  return data;
}

export async function closeKitchenOrder(orderId) {
  const { data, error } = await supabase
    .from("orders")
    .update({
      kitchen_closed: true,
      kitchen_closed_at: new Date().toISOString()
    })
    .eq("id", orderId)
    .select();

  if (error) throw error;
  return data;
}

export function printKitchenOrder(order) {
  const popup = window.open("", "_blank", "width=350,height=700");
  if (!popup) return false;

  popup.document.write(`
    <html>
    <head>
      <title>Comanda ${order.table_code}</title>
      <style>
        body { font-family: Arial; padding: 12px; width: 280px; }
        h2,h3,p { margin: 0 0 8px; }
        .line { border-bottom: 1px dashed #000; margin: 8px 0; }
      </style>
    </head>
    <body>
      <h2>OFFICINE MARE</h2>
      <p><strong>Tavolo:</strong> ${order.table_code || "-"}</p>
      <p><strong>Ora:</strong> ${new Date(order.created_at).toLocaleTimeString("it-IT")}</p>
      ${order.note ? `<p><strong>Nota:</strong> ${order.note}</p>` : ""}
      <div class="line"></div>
      ${(order.order_items || []).map(i => `
        <p><strong>${i.qty}x</strong> ${i.item_name}</p>
      `).join("")}
    </body>
    </html>
  `);

  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 400);

  return true;
}
