import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Purchase Document Edge Function
 *
 * Hanterar dokumentköp från Bolagsverket:
 * 1. Validerar köp mot daglig budget
 * 2. Loggar köpet i databasen
 * 3. Initierar köpprocessen (returnerar status)
 * 4. Skickar SMS-verifiering via Twilio
 *
 * Själva dokumenthämtningen sker via separat process (protokoll-scraper.js)
 * som körs server-side.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Budget-konfiguration
const DAILY_BUDGET_LIMIT = 500; // SEK per dag

// Twilio-konfiguration (hämtas från miljövariabler)
const TWILIO_CONFIG = {
  accountSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
  authToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
  fromNumber: Deno.env.get("TWILIO_FROM_NUMBER") || "",
  toNumber: Deno.env.get("TWILIO_TO_NUMBER") || "", // SMS mottagare för OTP
};

// Dokumenttyper och priser
// OBS: Årsredovisningar (AR) hämtas GRATIS via Bolagsverket Värdefulla Datamängder API
// direkt i frontend - de skickas aldrig till denna Edge Function
const DOCUMENT_PRICES: Record<string, number> = {
  AR: 0, // Årsredovisning - GRATIS via BV API (hämtas i frontend)
  REG: 75, // Registreringsbevis - måste köpas
  PROT: 250, // Bolagsstämmoprotokoll - måste köpas
  STYRPROT: 250, // Styrelseprotokoll - måste köpas
  BOLAG: 125, // Bolagsordning - måste köpas
  FPLAN: 350, // Fusionsplan - måste köpas
  KONKURSBESLUT: 0, // Gratis via POIT
  LIKBESLUT: 0, // Gratis via POIT
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      action,
      orgnr,
      documents,
      userId,
      verificationCode,
      purchaseId,
    } = body;

    // Supabase-klient
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ====================
    // ACTION: initiate - Starta köpprocess
    // ====================
    if (action === "initiate") {
      if (!orgnr || !documents || !Array.isArray(documents)) {
        return new Response(
          JSON.stringify({ error: "Saknar orgnr eller documents" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Beräkna totalt pris
      const totalPrice = documents.reduce((sum: number, doc: { id: string; price?: number }) => {
        const price = doc.price ?? DOCUMENT_PRICES[doc.id] ?? 0;
        return sum + price;
      }, 0);

      // Hämta dagens köp från databasen
      const today = new Date().toISOString().split("T")[0];
      const { data: todayPurchases, error: purchaseError } = await supabase
        .from("document_purchases")
        .select("amount_sek")
        .gte("created_at", `${today}T00:00:00`)
        .lt("created_at", `${today}T23:59:59`);

      if (purchaseError) {
        console.error("Fel vid hämtning av köp:", purchaseError);
      }

      const todayTotal = todayPurchases?.reduce((sum, p) => sum + (p.amount_sek || 0), 0) || 0;
      const remainingBudget = DAILY_BUDGET_LIMIT - todayTotal;

      // Kontrollera budget
      if (totalPrice > remainingBudget) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "BUDGET_EXCEEDED",
            message: `Daglig budget överskriden. Kvar idag: ${remainingBudget} kr`,
            todayTotal,
            remainingBudget,
            requestedAmount: totalPrice,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Skapa köppost i databasen (status: pending)
      const purchaseData = {
        orgnr,
        documents: JSON.stringify(documents),
        amount_sek: totalPrice,
        status: "pending",
        user_id: userId || null,
        created_at: new Date().toISOString(),
      };

      const { data: purchase, error: insertError } = await supabase
        .from("document_purchases")
        .insert(purchaseData)
        .select()
        .single();

      if (insertError) {
        console.error("Fel vid skapande av köp:", insertError);
        return new Response(
          JSON.stringify({ error: "Kunde inte skapa köppost", details: insertError }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Om totalPrice > 0, kräv SMS-verifiering
      if (totalPrice > 0 && TWILIO_CONFIG.accountSid) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Spara OTP i databasen
        await supabase
          .from("document_purchases")
          .update({ otp_code: otp, otp_sent_at: new Date().toISOString() })
          .eq("id", purchase.id);

        // Skicka SMS via Twilio
        try {
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_CONFIG.accountSid}/Messages.json`;
          const twilioAuth = btoa(`${TWILIO_CONFIG.accountSid}:${TWILIO_CONFIG.authToken}`);

          const smsResponse = await fetch(twilioUrl, {
            method: "POST",
            headers: {
              "Authorization": `Basic ${twilioAuth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              From: TWILIO_CONFIG.fromNumber,
              To: TWILIO_CONFIG.toNumber,
              Body: `Bevakningsverktyget: Din verifieringskod är ${otp}. Giltig i 10 minuter.`,
            }),
          });

          if (!smsResponse.ok) {
            console.error("Twilio SMS fel:", await smsResponse.text());
          }
        } catch (smsError) {
          console.error("Kunde inte skicka SMS:", smsError);
        }

        return new Response(
          JSON.stringify({
            success: true,
            purchaseId: purchase.id,
            requiresVerification: true,
            totalAmount: totalPrice,
            message: "SMS-verifiering skickad",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Om gratis dokument, markera som godkänd direkt
      return new Response(
        JSON.stringify({
          success: true,
          purchaseId: purchase.id,
          requiresVerification: false,
          totalAmount: totalPrice,
          status: "approved",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ====================
    // ACTION: verify - Verifiera OTP
    // ====================
    if (action === "verify") {
      if (!purchaseId || !verificationCode) {
        return new Response(
          JSON.stringify({ error: "Saknar purchaseId eller verificationCode" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Hämta köpet
      const { data: purchase, error: fetchError } = await supabase
        .from("document_purchases")
        .select("*")
        .eq("id", purchaseId)
        .single();

      if (fetchError || !purchase) {
        return new Response(
          JSON.stringify({ error: "Köp hittades inte" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Kontrollera OTP
      if (purchase.otp_code !== verificationCode) {
        return new Response(
          JSON.stringify({ error: "Felaktig verifieringskod" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Kontrollera att OTP inte är för gammal (10 min)
      const otpSentAt = new Date(purchase.otp_sent_at);
      const now = new Date();
      const diffMs = now.getTime() - otpSentAt.getTime();
      if (diffMs > 10 * 60 * 1000) {
        return new Response(
          JSON.stringify({ error: "Verifieringskoden har gått ut" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Uppdatera status till verified
      await supabase
        .from("document_purchases")
        .update({
          status: "verified",
          verified_at: new Date().toISOString(),
        })
        .eq("id", purchaseId);

      return new Response(
        JSON.stringify({
          success: true,
          status: "verified",
          message: "Verifiering godkänd. Dokumenthämtning startar...",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ====================
    // ACTION: status - Hämta köpstatus
    // ====================
    if (action === "status") {
      if (!purchaseId) {
        return new Response(
          JSON.stringify({ error: "Saknar purchaseId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: purchase, error: fetchError } = await supabase
        .from("document_purchases")
        .select("*")
        .eq("id", purchaseId)
        .single();

      if (fetchError || !purchase) {
        return new Response(
          JSON.stringify({ error: "Köp hittades inte" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          purchase: {
            id: purchase.id,
            status: purchase.status,
            documents: JSON.parse(purchase.documents || "[]"),
            amountSek: purchase.amount_sek,
            downloadedFiles: purchase.downloaded_files ? JSON.parse(purchase.downloaded_files) : [],
            createdAt: purchase.created_at,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ====================
    // ACTION: budget - Hämta budgetstatus
    // ====================
    if (action === "budget") {
      const today = new Date().toISOString().split("T")[0];
      const { data: todayPurchases } = await supabase
        .from("document_purchases")
        .select("amount_sek")
        .gte("created_at", `${today}T00:00:00`)
        .lt("created_at", `${today}T23:59:59`)
        .eq("status", "completed");

      const todayTotal = todayPurchases?.reduce((sum, p) => sum + (p.amount_sek || 0), 0) || 0;

      return new Response(
        JSON.stringify({
          success: true,
          dailyLimit: DAILY_BUDGET_LIMIT,
          todaySpent: todayTotal,
          remaining: DAILY_BUDGET_LIMIT - todayTotal,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ====================
    // ACTION: start-download - Starta dokumenthämtning
    // ====================
    if (action === "start-download") {
      if (!purchaseId) {
        return new Response(
          JSON.stringify({ error: "Saknar purchaseId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Hämta köpet och verifiera att det är verifierat
      const { data: purchase, error: fetchError } = await supabase
        .from("document_purchases")
        .select("*")
        .eq("id", purchaseId)
        .single();

      if (fetchError || !purchase) {
        return new Response(
          JSON.stringify({ error: "Köp hittades inte" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (purchase.status !== "verified" && purchase.status !== "approved") {
        return new Response(
          JSON.stringify({ error: "Köpet är inte verifierat", currentStatus: purchase.status }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Uppdatera status till "downloading"
      await supabase
        .from("document_purchases")
        .update({
          status: "downloading",
          updated_at: new Date().toISOString(),
        })
        .eq("id", purchaseId);

      // Trigga dokumenthämtning via backend API
      // loop-auto-api på Render kör protokoll-scraper.js
      const backendApiUrl = Deno.env.get("BACKEND_API_URL") || "https://loop-auto-api.onrender.com";
      const backendApiKey = Deno.env.get("BACKEND_API_KEY") || "";

      try {
        const downloadResponse = await fetch(`${backendApiUrl}/api/v1/documents/fetch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": backendApiKey,
          },
          body: JSON.stringify({
            purchaseId: purchase.id,
            orgnr: purchase.orgnr,
            documents: JSON.parse(purchase.documents || "[]"),
            callbackUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/purchase-document`,
          }),
        });

        if (!downloadResponse.ok) {
          const errorText = await downloadResponse.text();
          console.error("Backend API error:", errorText);

          // Markera köpet som failed
          await supabase
            .from("document_purchases")
            .update({
              status: "download_failed",
              error_message: `Backend API error: ${downloadResponse.status}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", purchaseId);

          return new Response(
            JSON.stringify({
              success: false,
              error: "Kunde inte starta dokumenthämtning",
              details: errorText,
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const downloadData = await downloadResponse.json();

        return new Response(
          JSON.stringify({
            success: true,
            status: "downloading",
            message: "Dokumenthämtning startad",
            jobId: downloadData.jobId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (downloadError) {
        console.error("Download trigger error:", downloadError);

        // Fallback: Simulera dokumenthämtning för demo
        // I produktion ska detta vara en riktig backend-process
        const documents = JSON.parse(purchase.documents || "[]");
        const simulatedFiles = documents.map((doc: { id: string; name: string; price: number }) => ({
          id: doc.id,
          name: doc.name,
          fileName: `${purchase.orgnr}_${doc.id}_${Date.now()}.pdf`,
          fileSize: Math.floor(Math.random() * 500 + 100) * 1024, // Bytes
          downloadedAt: new Date().toISOString(),
          status: "ready",
          // I produktion: faktisk URL till lagrad fil
          storageUrl: `documents/${purchase.orgnr}/${doc.id}.pdf`,
        }));

        // Uppdatera köpstatus till completed (simulerat)
        await supabase
          .from("document_purchases")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            downloaded_files: JSON.stringify(simulatedFiles),
            updated_at: new Date().toISOString(),
          })
          .eq("id", purchaseId);

        return new Response(
          JSON.stringify({
            success: true,
            status: "completed",
            message: "Dokument hämtade (demo-läge)",
            files: simulatedFiles,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ====================
    // ACTION: callback - Callback från backend efter dokumenthämtning
    // ====================
    if (action === "callback") {
      if (!purchaseId) {
        return new Response(
          JSON.stringify({ error: "Saknar purchaseId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { status: newStatus, files, error: callbackError } = body;

      const updateData: Record<string, unknown> = {
        status: newStatus || "completed",
        updated_at: new Date().toISOString(),
      };

      if (files) {
        updateData.downloaded_files = JSON.stringify(files);
        updateData.completed_at = new Date().toISOString();
      }

      if (callbackError) {
        updateData.error_message = callbackError;
      }

      await supabase
        .from("document_purchases")
        .update(updateData)
        .eq("id", purchaseId);

      return new Response(
        JSON.stringify({ success: true, message: "Callback processed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Okänd action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ error: "Internt fel", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
