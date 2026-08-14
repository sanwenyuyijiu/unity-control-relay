/**
 * server.js — 云端单端口中继（HTTP + WS 同端口，已加 HTTP 轮询兜底 API）
 *
 * 端口：process.env.PORT || 8080
 * WS   ：ws://<host>:<port>/ws
 * 静态 ：public/index.html 等
 * API  ：
 *   GET  /api/status        -> {"deviceOnline":bool,"running":"1"|null}
 *   POST /api/start         -> body {"deviceId":"1","sceneId":"1"} -> {"ok":bool,"error":...}
 *
 * 这样即使手机浏览器/网络不支持 WebSocket，也能用 HTTP 轮询保持在线与控制。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const deviceClients = new Set(); // 现场客户端 / ESP32 连接
let currentProgram = null;       // 当前现场正在运行的程序 ID

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];

  // ---------- API：状态查询（HTTP 轮询兜底）----------
  if (urlPath === "/api/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ deviceOnline: deviceClients.size > 0, running: currentProgram }));
    return;
  }

  // ---------- API：启动命令（HTTP 兜底）----------
  if (urlPath === "/api/start" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let msg;
      try { msg = JSON.parse(body); } catch { msg = {}; }
      const target = msg.deviceId || "1";
      let sent = false;
      for (const c of deviceClients) {
        if (c.deviceId === target) {
          c.send(JSON.stringify({ type: "start", sceneId: msg.sceneId }));
          sent = true;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: sent, error: sent ? null : "设备离线，命令未送达" }));
    });
    return;
  }

  // ---------- 静态文件 ----------
  const filePath = path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not Found"); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

// ---------- WS 中继（同端口，路径 /ws）----------
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.isDevice = false;

  // 新连接立即补发当前状态
  ws.send(JSON.stringify({ type: "programStatus", running: currentProgram }));
  if (deviceClients.size > 0) ws.send(JSON.stringify({ type: "status", deviceOnline: true }));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // 现场设备注册
    if (msg.type === "hello" && msg.role === "device") {
      ws.isDevice = true;
      ws.deviceId = msg.deviceId || "1";
      deviceClients.add(ws);
      console.log(`[WS] 现场客户端上线 deviceId=${ws.deviceId}，在线数=${deviceClients.size}`);
      broadcastToBrowsers({ type: "status", deviceOnline: true });
      ws.send(JSON.stringify({ type: "programStatus", running: currentProgram }));
      return;
    }

    // 浏览器启动命令
    if (msg.type === "start") {
      const target = msg.deviceId || "1";
      let sent = false;
      for (const c of deviceClients) {
        if (c.deviceId === target) {
          c.send(JSON.stringify({ type: "start", sceneId: msg.sceneId }));
          sent = true;
        }
      }
      ws.send(JSON.stringify({ type: "ack", ok: sent, sceneId: msg.sceneId }));
      if (!sent) console.log("[WS] 警告：没有在线的现场客户端");
      return;
    }

    // 设备上报运行状态
    if (msg.type === "programStatus") {
      currentProgram = msg.running || null;
      console.log(`[WS] 当前运行程序：${currentProgram || "（无）"}`);
      broadcastToBrowsers({ type: "programStatus", running: currentProgram });
      return;
    }

    // 设备回执
    if (msg.type === "done") {
      broadcastToBrowsers({ type: "done", sceneId: msg.sceneId, ok: msg.ok, error: msg.error });
    }
  });

  ws.on("close", () => {
    if (ws.isDevice) {
      deviceClients.delete(ws);
      console.log(`[WS] 现场客户端离线，在线数=${deviceClients.size}`);
      broadcastToBrowsers({ type: "status", deviceOnline: deviceClients.size > 0 });
    }
  });
  ws.on("error", () => {});
});

function broadcastToBrowsers(msg) {
  for (const c of wss.clients) {
    if (!c.isDevice && c.readyState === c.OPEN) c.send(JSON.stringify(msg));
  }
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[云中继] 已启动：http://0.0.0.0:${PORT}  （WebSocket 路径 /ws，状态API /api/status）`);
});
