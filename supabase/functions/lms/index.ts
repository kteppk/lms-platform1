import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import { createHandler } from "./api.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) throw new Error("Supabase server credentials are missing");

Deno.serve(createHandler(createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})));
