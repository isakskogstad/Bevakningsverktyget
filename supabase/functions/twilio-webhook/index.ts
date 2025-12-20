import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const form = await req.formData();
    const from = String(form.get("From") || "");
    const to = String(form.get("To") || "");
    const body = String(form.get("Body") || "");
    const sid = String(form.get("MessageSid") || "");

    if (!body) {
      return new Response("Missing body", { status: 400, headers: corsHeaders });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: prefs } = await adminClient
      .from("sms_preferences")
      .select("user_id, phone_number")
      .eq("phone_number", from)
      .limit(1);

    const userId = prefs?.[0]?.user_id || null;

    if (!userId) {
      return new Response("Unknown sender", { status: 200, headers: corsHeaders });
    }

    await adminClient.from("sms_logs").insert({
      user_id: userId,
      from_phone: from,
      to_phone: to,
      message: body,
      twilio_sid: sid || null,
      status: "received",
      sent_at: new Date().toISOString(),
      cost_sek: 0,
    });

    return new Response("OK", { headers: corsHeaders });
  } catch (error) {
    console.error("twilio-webhook error:", error);
    return new Response("Error", { status: 500, headers: corsHeaders });
  }
});
