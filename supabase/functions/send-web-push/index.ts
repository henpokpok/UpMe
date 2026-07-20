import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.3";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvU2J6q1vJbWq6t2Wz1t5y9z2z-A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2W3X4Y5Z6";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "K8x9P0m1N2v3B4c5V6x7Z8a9S0d1F2g3H4j5K6l7M8n";
const VAPID_SUBJECT = "mailto:admin@upmee.app";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

serve(async (req) => {
  try {
    const payload = await req.json();
    const newRecord = payload.record;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch all device push subscriptions from database
    const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
    if (error || !subs || subs.length === 0) {
      return new Response(JSON.stringify({ message: "No active push subscriptions" }), { status: 200 });
    }

    const pushPayload = JSON.stringify({
      title: "UpMee 🐰 มีไฟล์/ข้อความใหม่!",
      body: newRecord.file_name ? `ไฟล์ใหม่: ${newRecord.file_name}` : `ข้อความใหม่: ${newRecord.content?.substring(0, 40)}`,
      icon: "/bunny_mascot.png",
      url: "/"
    });

    // Send native Web Push Notification to all devices via Apple APNs & Google FCM
    const sendPromises = subs.map((sub) =>
      webpush.sendNotification(sub.subscription, pushPayload).catch((err) => {
        console.warn("Push delivery error for sub:", err);
      })
    );

    await Promise.all(sendPromises);
    return new Response(JSON.stringify({ success: true, count: subs.length }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
