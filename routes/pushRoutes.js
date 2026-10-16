// routes/pushRoutes.js
import express from "express";
import { webpush } from "../config/pushConfig.js";
import { subscriptions } from "../subscriptions.js";

const router = express.Router();

router.post("/subscribe", (req, res) => {
  subscriptions.push(req.body);
  res.status(201).json({ message: "Subscribed" });
});

router.post("/send-push", async (req, res) => {
  const payload = JSON.stringify({
    title: "Test Push",
    body: "Push working 🚀",
  });

  try {
    await Promise.all(
      subscriptions.map(sub =>
        webpush.sendNotification(sub, payload)
      )
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;