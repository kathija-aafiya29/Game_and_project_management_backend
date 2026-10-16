import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import { createServer } from "http";
import webpush from "web-push";
import cron from "node-cron";
import { logoutAllUsers } from "./services/keycloack.service.js";
import { keycloak, memoryStore } from "./middleware/keycloak.js";
import authRoutes from "./routes/auth.js";
import s3Routes from "./routes/s3Routes.js";
import dbRoutes from "./routes/dbRoutes.js";
import timelineRoutes from "./routes/timeline.js";
import uploadRouter from "./routes/buildupload.js";
import testingSummaryRoutes from "./routes/testingSummary.js";
import historyRoutes from "./routes/history.js";
import lastIteration from "./routes/lastIteration.js";
import onHold from "./routes/onHold.js";
import fetchChecklist from "./routes/fetchChecklist.js";
import verifyChecklist from "./routes/verifyChecklist.js";
import updateTester from "./routes/updateTester.js";
import updatePhase from "./routes/updatePhase.js";
import updateCategory from "./routes/updateCategory.js";
import gameDetails from "./routes/gameDetails.js";
import gameDocumentsAPI from "./routes/gameDocumentsAPI.js";
import titleDataRoutes from "./routes/titledata.js";
import gameValidationRoute from "./routes/gameValidation.js";
import viewLogs from "./routes/viewLogs.js";
import ipAccess from "./routes/ipAccess.js";
import category from "./routes/category.js";
import truncate from "./routes/truncate.js";
import serverManagement from "./routes/serverManagement.js";
import notificationsAPI from "./routes/notifications-api.js";
import { initDB, getDB } from "./config/db.js"; // Use getDB instead of db
import pushRoutes from "./routes/pushRoutes.js";
import { loadSecrets } from "./config/config.js";
await loadSecrets();
// Import WebSocket server
// import { setupWebSocketServer } from "./routes/websocket-server.js";

// // kanban
// import kanbanSocket  from "./routes/kanban.socket.js";
import setupWebSocket from "./routes/index.js";
import bugRouter from "./routes/bugRoutes.js";
import { validateKeycloakToken } from "./services/keycloack.service.js";


const app = express();
const server = createServer(app);


await initDB();


// ✅ Configure Web Push VAPID Keys
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@utwebapps.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);


// ✅ FIXED CORS CONFIG
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:5000",
  "https://testing.portalapi.swwebapps.com",
  "https://main.d1zsecf52sr585.amplifyapp.com",
  "https://testing.d1zsecf52sr585.amplifyapp.com",
  "https://unityone.swwebapps.com",
  "https://testing.d1zsecf52sr585.amplifyapp.com",
  "https://dev.d1zsecf52sr585.amplifyapp.com",
  "ws://localhost:3000",
  "ws://localhost:5000",
  "ws://localhost:5173",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(
        new Error("❌ CORS blocked for origin: " + origin),
        false
      );
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(cors());

app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ extended: true, limit: "200mb" }));


app.use(
  session({
    secret: "super-secret-session-key",
    resave: false,
    saveUninitialized: true,
    store: memoryStore,
  })
);

app.use(keycloak.middleware());

// Public Route
app.get("/", (req, res) => {
  res.send("Backend running with S3 + DB + Keycloak + WebSocket + Push Notifications");
});

// Debug endpoints
// app.get("/api/debug/health", (req, res) => {
//   const dbStatus = db ? "connected" : "not connected";
//   res.json({
//     status: 'ok',
//     timestamp: new Date().toISOString(),
//     vapidConfigured: !!process.env.VAPID_PUBLIC_KEY,
//     dbStatus: dbStatus,
//     pushEnabled: true
//   });
// });

// app.get("/api/debug/db", async (req, res) => {
//   try {
//     const db = getDB();
//     const [result] = await db.query('SELECT 1 as test, NOW() as time');
//     res.json({
//       status: 'connected',
//       test: result[0].test,
//       time: result[0].time
//     });
//   } catch (error) {
//     res.json({
//       status: 'error',
//       error: error.message
//     });
//   }
// });

// app.get("/api/debug/vapid", (req, res) => {
//   res.json({
//     hasPublicKey: !!process.env.VAPID_PUBLIC_KEY,
//     hasPrivateKey: !!process.env.VAPID_PRIVATE_KEY,
//     publicKeyLength: process.env.VAPID_PUBLIC_KEY?.length || 0,
//     publicKeyPreview: process.env.VAPID_PUBLIC_KEY ? 
//       process.env.VAPID_PUBLIC_KEY.substring(0, 50) + '...' : 'Not set',
//     subject: process.env.VAPID_SUBJECT || 'Not set'
//   });
// });

// ✅ Get VAPID public key (for frontend)
// app.get("/api/push/vapid-public-key", (req, res) => {
//   if (!process.env.VAPID_PUBLIC_KEY) {
//     return res.status(500).json({ 
//       error: "VAPID public key not configured" 
//     });
//   }
//   res.json({ 
//     publicKey: process.env.VAPID_PUBLIC_KEY 
//   });
// });

// ✅ Function to send push notification
// async function sendPushNotification(email, notification) {
//   try {
//     if (!email || !notification) {
//       console.log('Missing parameters for push notification');
//       return;
//     }

//     const db = getDB();

//     // Create table if it doesn't exist
//     const createTableQuery = `
//       CREATE TABLE IF NOT EXISTS push_subscriptions (
//         id INT AUTO_INCREMENT PRIMARY KEY,
//         email VARCHAR(255) NOT NULL,
//         subscription_data JSON NOT NULL,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//         UNIQUE KEY unique_email (email)
//       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
//     `;

//     await db.query(createTableQuery);

//     const query = "SELECT subscription_data FROM push_subscriptions WHERE email = ?";
//     const [rows] = await db.query(query, [email]);

//     if (rows.length === 0) {
//       console.log(`📭 No push subscription found for: ${email}`);
//       return;
//     }

//     const subscription = JSON.parse(rows[0].subscription_data);

//     const payload = JSON.stringify({
//       title: notification.title || "New Notification",
//       body: notification.message || "You have a new notification",
//       icon: notification.icon || '/logo192.png',
//       badge: '/logo192.png',
//       data: {
//         url: notification.context?.document_url || '/',
//         notificationId: notification.id,
//         type: notification.type
//       }
//     });

//     await webpush.sendNotification(subscription, payload);
//     console.log(`✅ Push notification sent to: ${email}`);

//   } catch (error) {
//     console.error('❌ Push notification error:', error);

//     // Remove invalid subscription
//     if (error.statusCode === 410 || error.statusCode === 404) {
//       try {
//         const db = getDB();
//         await db.query("DELETE FROM push_subscriptions WHERE email = ?", [email]);
//         console.log(`🗑️ Removed invalid subscription for: ${email}`);
//       } catch (dbError) {
//         console.error('Failed to remove subscription:', dbError);
//       }
//     }
//   }
// }

// ✅ Push Notification Routes
app.post("/api/push/subscribe", keycloak.protect(), async (req, res) => {
  try {
    const { email, subscription } = req.body;

    if (!email || !subscription) {
      return res.status(400).json({
        success: false,
        error: "Email and subscription are required"
      });
    }

    console.log(`📝 Saving push subscription for: ${email}`);
    console.log('Subscription endpoint:', subscription.endpoint);

    const db = getDB();

    // Create table if it doesn't exist
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        subscription_data JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    await db.query(createTableQuery);
    console.log('✅ Table check/creation complete');

    // Store subscription in MySQL database
    const query = `
      INSERT INTO push_subscriptions (email, subscription_data, created_at, updated_at)
      VALUES (?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
      subscription_data = VALUES(subscription_data),
      updated_at = NOW()
    `;

    await db.query(query, [email, JSON.stringify(subscription)]);

    console.log(`✅ Push subscription saved for: ${email}`);
    res.json({ success: true });

  } catch (error) {
    console.error('❌ Subscription error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});


// Auth Route
app.use("/api/auth", authRoutes);
// app.use("/api", validateKeycloakToken);
app.use("/api/s3", s3Routes);
app.use("/api/db", dbRoutes);
app.use("/api", timelineRoutes);
app.use("/api", uploadRouter);
app.use("/api", testingSummaryRoutes);
app.use('/api', historyRoutes);
app.use('/api', lastIteration);
app.use('/api', onHold);
app.use('/api', fetchChecklist);
app.use('/api', verifyChecklist);
app.use('/api', updatePhase);
app.use('/api', updateTester);
app.use('/api', updateCategory);
app.use('/api', gameDetails);
app.use('/api', gameDocumentsAPI);
app.use("/api", titleDataRoutes);
app.use("/api", viewLogs);
app.use('/api/truncation', truncate);
app.use("/api/gamecategories", category);
app.use("/api/ip-access", ipAccess);
app.use("/api/game-validation", gameValidationRoute);
app.use("/api/servers", serverManagement);
app.use("/api", notificationsAPI);
app.use("/api", bugRouter);
app.use("/api", pushRoutes);

// ✅ Setup WebSocket server
// setupWebSocketServer(server);
//kanbanSocket(server);
setupWebSocket(server);



// Example protected route
app.get("/api/secure", keycloak.protect(), (req, res) => {
  res.json({ message: "You have accessed a protected route!" });
});

cron.schedule(
  "0 00 19 * * *",
  async () => {
    console.log("⏰ TEST CRON — Running Keycloak global logout job");

    try {
      await logoutAllUsers();
      console.log("✅ All users forced to logout successfully");
    } catch (err) {
      console.error("❌ Keycloak logout cron failed:", err.message);
    }
  },
  {
    timezone: "Asia/Kolkata",
  }
);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket available at: ws://localhost:${PORT}/ws`);
  console.log(`🔔 Push notifications enabled with VAPID`);
  console.log(`🔧 Debug endpoints:`);
  console.log(`   http://localhost:${PORT}/api/debug/health`);
  console.log(`   http://localhost:${PORT}/api/debug/db`);
  console.log(`   http://localhost:${PORT}/api/debug/vapid`);
  console.log(`   http://localhost:${PORT}/api/push/vapid-public-key`);
  console.log(`   http://localhost:${PORT}/api/push/test-simple (no auth)`);
});