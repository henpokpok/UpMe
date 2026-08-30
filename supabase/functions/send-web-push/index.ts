import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "BCKyt1Zaqd4A2WUFCxedHrZCQXSTlOP2EJo9dYTuaOzzJ0suZmAPZkCLEUkggxsQXuDShNwxo2SQzuHQMyfBTjs";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "GnqgoKl1WVzWicq8zCwjlV8O5k1e6xFMLXv6Q4Ttwuk";
const VAPID_SUBJECT = "https://upmee.vercel.app";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log("Webhook payload received:", payload);
    const newRecord = payload.record || payload;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch active device push subscriptions from database
    const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
    if (error || !subs || subs.length === 0) {
      console.log("No push subscriptions found in DB");
      return new Response(JSON.stringify({ message: "No active push subscriptions found" }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log(`Sending Web Push to ${subs.length} registered devices...`);

    const isEncrypted = typeof newRecord.content === 'string' && (
      newRecord.content.startsWith('{"v":1,"e2ee":true') ||
      newRecord.file_name === '[E2EE Encrypted File]'
    );
    let bodyText = 'มีรายการใหม่ฝากไว้บน UpMee';
    if (isEncrypted) {
      bodyText = '🔒 ได้รับรายการใหม่ (เข้ารหัส E2EE)';
    } else if (newRecord.file_name) {
      bodyText = `ไฟล์ใหม่: ${newRecord.file_name}`;
    } else if (newRecord.content) {
      bodyText = `ข้อความใหม่: ${newRecord.content.substring(0, 40)}`;
    }

    const pushPayload = JSON.stringify({
      title: "UpMee 🐰 มีไฟล์/ข้อความใหม่!",
      body: bodyText,
      icon: "/bunny_mascot.png",
      url: "/"
    });

    const sendPromises = subs.map(async (sub) => {
      try {
        const res = await webpush.sendNotification(sub.subscription, pushPayload);
        console.log("Push delivered successfully:", res.statusCode);
      } catch (err: any) {
        console.warn("Apple APNs / Google FCM Push error:", err.statusCode, err.body || err.message);
        // Clean up expired tokens (410 Gone / 404 Not Found)
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    });

    await Promise.all(sendPromises);
    return new Response(JSON.stringify({ success: true, count: subs.length }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err: any) {
    console.error("Edge Function exception:", err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
