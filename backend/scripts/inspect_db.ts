import "dotenv/config";
import { getSupabase } from "../src/supabase.js";

async function main() {
  const sb = getSupabase();
  const { data } = await sb.from("cases").select("id, nomination_id, block_id, project_name, historical_award").eq("source","sm2025_import").limit(5);
  console.log("Sample rows:");
  console.log(JSON.stringify(data, null, 2));

  // Count by nomination_id for our targets
  for (const nid of ["1038","1047","1050","1052","D01","D10","D13","D15"]) {
    const { count } = await sb.from("cases").select("id", { count: "exact", head: true }).eq("source","sm2025_import").eq("nomination_id", nid);
    console.log(`  nomination_id="${nid}": count=${count}`);
  }
}
main().catch(console.error);
