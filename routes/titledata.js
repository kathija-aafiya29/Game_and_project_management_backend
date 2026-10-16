import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

/* =========================================
   SUPABASE CONFIG
========================================= */

const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing in environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
};

/* =============================
   GET: Fetch All Title Data
============================= */
router.get("/titledata", async (req, res) => {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from("titledata")
      .select("id, key, value")
      .order("id", { ascending: false });

    if (error) throw error;

    res.json({ success: true, data: data });
  } catch (error) {
    console.error("Fetch Error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch data" });
  }
});

/* =============================
   POST: Add Title Data
============================= */
router.post("/titledata", async (req, res) => {
  const supabase = getSupabase();
  try {
    const { key, value, username, email } = req.body;
    if (!key || !value) {
      return res.json({ success: false, message: "Key & Value required" });
    }

    // Insert into titledata
    const { error: insertError } = await supabase
      .from("titledata")
      .insert([{ key, value }]);

    if (insertError) throw insertError;

    // Get current IST time
    const istTime = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    });
    const istDate = new Date(istTime).toISOString();

    // Insert into builduser
    const { error: buildError } = await supabase
      .from("builduser")
      .insert([{
        gamename: key,
        username: username,
        email: email,
        command: value,
        useraction: "Title Data Added",
        lastupdate: istDate
      }]);

    if (buildError) throw buildError;

    res.json({ success: true, message: "Title data added successfully" });
  } catch (error) {
    console.error("Add Error:", error);
    res.status(500).json({ success: false, message: "Failed to add title data" });
  }
});

/* =============================
   PUT: Update Title Data
============================= */
router.put("/titledata/:id", async (req, res) => {
  const supabase = getSupabase();
  try {
    const { id } = req.params;
    const { key, value, username, email } = req.body;

    // Update titledata
    const { error: updateError } = await supabase
      .from("titledata")
      .update({ key, value })
      .eq("id", id);

    if (updateError) throw updateError;

    // Get current IST time
    const istTime = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    });
    const istDate = new Date(istTime).toISOString();

    // Insert into builduser
    const { error: buildError } = await supabase
      .from("builduser")
      .insert([{
        gamename: key,
        username: username,
        email: email,
        command: value,
        useraction: "Title Data Updated",
        lastupdate: istDate
      }]);

    if (buildError) throw buildError;

    res.json({ success: true, message: "Title data updated successfully" });
  } catch (error) {
    console.error("Edit Error:", error);
    res.status(500).json({ success: false, message: "Update failed" });
  }
});

/* =============================
   DELETE: Remove Title Data
============================= */
router.delete("/titledata/:id", async (req, res) => {
  const supabase = getSupabase();
  try {
    const { id } = req.params;
    const { reason, key, username, email } = req.body;

    // Delete from titledata
    const { error: deleteError } = await supabase
      .from("titledata")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    // Get current IST time
    const istTime = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    });
    const istDate = new Date(istTime).toISOString();

    // Insert into builduser
    const { error: buildError } = await supabase
      .from("builduser")
      .insert([{
        gamename: key,
        username: username,
        email: email,
        command: reason,
        useraction: "Title Data Deleted",
        lastupdate: istDate
      }]);

    if (buildError) throw buildError;

    res.json({ success: true, message: "Title data deleted successfully" });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ success: false, message: "Deletion failed" });
  }
});

export default router;