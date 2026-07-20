import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "BCKyt1Zaqd4A2WUFCxedHrZCQXSTlOP2EJo9dYTuaOzzJ0suZmAPZkCLEUkggxsQXuDShNwxo2SQzuHQMyfBTjs";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "GnqgoKl1WVzWicq8zCwjlV8O5k1e6xFMLXv6Q4Ttwuk";
const VAPID_SUBJECT = "mailto:admin@upmee.app";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

serve(async (req) => {
  try {
    const payload = await req.json();
    const newRecord = payload.record;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch active device push subscriptions from database
    const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
    if (error || !subs || subs.length === 0) {
      return new Response(JSON.stringify({ message: "No active push subscriptions found" }), { status: 200 });
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
        console.warn("Push delivery result:", err);
      })
    );

    await Promise.all(sendPromises);
    return new Response(JSON.stringify({ success: true, count: subs.length }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
