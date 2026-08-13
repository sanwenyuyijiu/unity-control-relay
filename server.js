/**
 * server.js — Unity 互动程序「云中继服务」
 *
 * 作用（本地测试时扮演最终架构里的云服务器；也可直接部署到 Render）：
 *   1. HTTP 服务：托管 H5 触发页 public/index.html
 *   2. WS 中继  ：接收浏览器发来的启动命令，转发给现场客户端
 *
 * 端口说明（兼容本地与云端）：
 *   - 本地：http://localhost:3000  + ws://localhost:3000/ws
 *   - 云端(Render)：Render 注入 process.env.PORT，且自动 HTTPS
 *                   → https://<你的服务>.onrender.com  + wss://<你的服务>.onrender.com/ws
 *   - HTTP 与 WS 共用同一个端口，WS 走 /ws 路径（Render 只暴露一个端口）
 *
 * 消息协议（与最终云方案一致，迁移无需改代码）：
 *   浏览器  --> server : { type:"start", deviceId:"1", sceneId:"1" }
 *   server  --> 客户端 : { type:"start", sceneId:"1" }
 *   客户端  --> server : { type:"hello", role:"device", deviceId:"1" }
 *   客户端  --> server : { type:"ping" }   // 心跳，防 Render 免费版休眠
 *
 * 启动：node server.js   （或 npm start）
 * 依赖：npm install ws
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

// Render 注入 PORT；本地默认 3000（HTTP 与 WS 共用一个端口）
const PORT = process.env.PORT || 3000;
const WS_PATH = "/ws";
const PUBLIC_DIR = path.join(__dirname, "public");

// ---------- 1. HTTP 静态服务（同时承载 H5 页面与 WS 升级）----------
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];
  const filePath = path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

// ---------- 2. WS 中继（挂在同一 HTTP 服务上，路径 /ws）----------
const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
const deviceClients = new Set(); // 现场客户端连接
let currentProgram = null;       // 当前现场正在运行的程序 ID

wss.on("connection", (ws) => {
  ws.isDevice = false;

  // 新连接补发当前程序运行状态（浏览器用；设备端会忽略）
  if (currentProgram) {
    ws.send(JSON.stringify({ type: "programStatus", running: currentProgram }));
  }

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // 心跳：来自现场客户端或浏览器的 ping，仅用于保持 Render 不休眠，忽略即可
    if (msg.type === "ping") return;

    // 客户端注册为"现场设备"
    if (msg.type === "hello" && msg.role === "device") {
      ws.isDevice = true;
      ws.deviceId = msg.deviceId || "1";
      deviceClients.add(ws);
      console.log(`[WS] 现场客户端上线 deviceId=${ws.deviceId}，当前在线设备数=${deviceClients.size}`);
      broadcastToBrowsers({ type: "status", deviceOnline: true });
      return;
    }

    // 浏览器发起启动命令
    if (msg.type === "start") {
      console.log(`[WS] 收到启动命令 sceneId=${msg.sceneId} deviceId=${msg.deviceId}`);
      const target = msg.deviceId || "1";
      let sent = false;
      for (const c of deviceClients) {
        if (c.deviceId === target) {
          c.send(JSON.stringify({ type: "start", sceneId: msg.sceneId }));
          sent = true;
        }
      }
      // 回复浏览器：设备是否在线
      ws.send(JSON.stringify({ type: "ack", ok: sent, sceneId: msg.sceneId }));
      if (!sent) console.log("[WS] 警告：没有找到在线的现场客户端");
      return;
    }

    // 设备端上报程序运行状态 → 广播给所有浏览器
    if (msg.type === "programStatus") {
      currentProgram = msg.running || null;
      console.log(`[WS] 当前运行程序：${currentProgram || "（无）"}`);
      broadcastToBrowsers({ type: "programStatus", running: currentProgram });
      return;
    }

    // 设备端回执（可选，打印日志用）
    if (msg.type === "done") {
      if (msg.ok) {
        console.log(`[WS] 现场客户端已启动程序 ${msg.sceneId}`);
      } else {
        console.log(`[WS] 现场客户端启动程序 ${msg.sceneId} 失败：${msg.error || "未知原因"}`);
      }
      broadcastToBrowsers({ type: "done", sceneId: msg.sceneId, ok: msg.ok, error: msg.error });
    }
  });

  ws.on("close", () => {
    deviceClients.delete(ws);
    if (ws.isDevice) {
      console.log("[WS] 现场客户端离线");
      broadcastToBrowsers({ type: "status", deviceOnline: deviceClients.size > 0 });
    }
  });

  ws.on("error", () => {});
});

function broadcastToBrowsers(msg) {
  for (const c of wss.clients) {
    if (!c.isDevice && c.readyState === c.OPEN) {
      c.send(JSON.stringify(msg));
    }
  }
}

httpServer.listen(PORT, () => {
  const base = process.env.PORT ? `https://<你的服务>.onrender.com` : `http://localhost:${PORT}`;
  console.log(`[HTTP] H5 页面: ${base}`);
  console.log(`[WS]   中继地址: ${base}${WS_PATH}`);
});
