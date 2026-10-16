import { WebSocketServer } from "ws";
import { setupWebSocketServer } from "./websocket-server.js";
import handleKanbanSocket from "./kanban.socket.js";

export default function setupWebSocket(server) {
  const wss = new WebSocketServer({
    server,
    perMessageDeflate: false, // 🚨 REQUIRED
  });

  console.log("✅ WebSocket server initialized");

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;

    const pathname = new URL(
      req.url,
      `http://${req.headers.host}`
    ).pathname;

    console.log("⬆️ WS upgrade:", pathname);

    if (pathname === "/ws") {
      setupWebSocketServer(ws, req);
    } 
    else if (pathname === "/ws/kanban") {
      handleKanbanSocket(ws);
    } 
    else {
      ws.close(1008, "Invalid WS path");
    }
  });

  // ❤️ HEARTBEAT
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => console.log("❌ WS server closed"));
}
