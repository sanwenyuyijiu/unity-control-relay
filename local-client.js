/**
 * local-client.js — 现场本地客户端（程序启动器版）
 *
 * 作用（扮演最终架构里"现场电脑"上的客户端）：
 *   1. 长连接中继 ws://localhost:3001，注册为设备
 *   2. 收到「启动」命令后，读取 programs.json，自动关闭当前运行的程序，
 *      然后启动对应的 exe（Unity 打包产物）
 *   3. 程序运行状态实时上报，网页上显示"运行中/未运行"
 *
 * 启动：node local-client.js
 * 依赖：同目录下的 programs.json（程序 ID ↔ exe 路径）
 */
const WebSocket = require("ws");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// 中继地址：默认连本机单端口 /ws；部署到 Render 后用环境变量覆盖，
// 例如：RELAY_URL=wss://你的服务.onrender.com/ws node local-client.js
const RELAY_URL = process.env.RELAY_URL || "ws://localhost:3000/ws";
const DEVICE_ID = "1";                       // 设备 ID
const PROGRAMS_FILE = path.join(__dirname, "programs.json");

// 读取程序配置
let PROGRAMS = {};
try {
  PROGRAMS = JSON.parse(fs.readFileSync(PROGRAMS_FILE, "utf-8"));
  // 去掉"说明"这种非程序字段
  for (const k of Object.keys(PROGRAMS)) {
    if (!PROGRAMS[k] || typeof PROGRAMS[k] !== "object" || !PROGRAMS[k].exe) delete PROGRAMS[k];
  }
  console.log(`[client] 已加载 ${Object.keys(PROGRAMS).length} 个程序配置：`);
  for (const [id, p] of Object.entries(PROGRAMS)) {
    console.log(`[client]   ${id}. ${p.name} → ${p.exe}`);
  }
} catch (e) {
  console.error(`[client] ❌ 读取 ${PROGRAMS_FILE} 失败：${e.message}`);
  console.error("[client] 请检查 programs.json 格式是否正确。");
}

// ========== 进程管理 ==========
let current = null; // { id, child }

// 强杀进程树（taskkill /T 连子进程一起杀）
function killTree(pid) {
  return new Promise((resolve) => {
    const t = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    const timer = setTimeout(() => resolve(), 3000); // 超时兜底
    t.on("exit", () => { clearTimeout(timer); resolve(); });
    t.on("error", () => { clearTimeout(timer); resolve(); });
  });
}

// 关闭当前运行的程序
async function stopCurrent() {
  if (!current) return;
  const { id, child } = current;
  console.log(`[client] 正在关闭当前程序 ${id}（PID ${child.pid}）...`);
  current = null;
  try { child.kill(); } catch {}
  await killTree(child.pid);
  console.log(`[client] 已关闭程序 ${id}`);
}

// 启动目标程序
async function startProgram(id) {
  const cfg = PROGRAMS[id];
  if (!cfg) {
    return { ok: false, error: `程序 ${id} 未在 programs.json 中配置` };
  }
  if (!fs.existsSync(cfg.exe)) {
    return { ok: false, error: `exe 不存在：${cfg.exe}\n请确认 Unity 已打包且 programs.json 路径正确` };
  }

  await stopCurrent(); // 自动关闭上一个

  try {
    const child = spawn(cfg.exe, [], {
      cwd: path.dirname(cfg.exe), // 重要：Unity exe 依赖旁边的 Data 文件夹，必须在它自己的目录里启动
      windowsHide: false,
    });

    current = { id, child };
    console.log(`[client] 🚀 已启动「${cfg.name}」（PID ${child.pid}）`);

    child.on("error", (e) => {
      console.error(`[client] ❌ 启动失败：${e.message}`);
      if (current && current.child === child) current = null;
    });

    child.on("exit", (code) => {
      console.log(`[client] 程序「${cfg.name}」已退出（code=${code}）`);
      if (current && current.child === child) {
        current = null;
        sendToRelay({ type: "programStatus", running: null });
      }
    });

    return { ok: true, pid: child.pid };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ========== 中继连接 ==========
let ws = null;
let heartbeat = null; // 心跳定时器（防 Render 免费版休眠）

function sendToRelay(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  console.log(`[client] 连接中继 ${RELAY_URL} ...`);
  ws = new WebSocket(RELAY_URL);

  ws.on("open", () => {
    sendToRelay({ type: "hello", role: "device", deviceId: DEVICE_ID });
    console.log(`[client] 已上线，设备 ID=${DEVICE_ID}，等待启动命令...`);
    // 上报当前是否有程序在运行
    sendToRelay({ type: "programStatus", running: current ? current.id : null });

    // 心跳保活：Render 免费版 15 分钟无入站流量会休眠，定时发 ping 防止被回收
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(() => sendToRelay({ type: "ping" }), 10 * 60 * 1000);
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch { return; }

    if (msg.type === "start") {
      console.log(`[client] 收到启动命令 sceneId=${msg.sceneId}`);
      const r = await startProgram(msg.sceneId);
      if (r.ok) {
        sendToRelay({ type: "programStatus", running: msg.sceneId });
        sendToRelay({ type: "done", sceneId: msg.sceneId, ok: true });
      } else {
        console.log(`[client] ❌ ${r.error}`);
        sendToRelay({ type: "done", sceneId: msg.sceneId, ok: false, error: r.error });
      }
    }
  });

  ws.on("close", () => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    console.log("[client] 连接断开，3 秒后重连...");
    setTimeout(connect, 3000);
  });

  ws.on("error", (e) => {
    console.log(`[client] 连接错误：${e.message}（如果中继未启动，请先运行 node server.js）`);
    ws.close();
  });
}

connect();
