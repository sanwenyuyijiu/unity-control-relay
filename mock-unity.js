/**
 * mock-unity.js — 模拟 Unity 接收端
 *
 * 在没有打开 Unity 时，用它模拟 Unity 的本地 HTTP 接口，
 * 先验证"浏览器 → 中继 → 客户端 → Unity"整条链路是否通。
 *
 * 启动：node mock-unity.js
 * 之后在浏览器点「启动」，这里会打印对应的场景切换日志。
 */
const http = require("http");

const PORT = 8765;

const server = http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (path.startsWith("/scene/")) {
    const sceneId = path.substring("/scene/".length);
    console.log(`【模拟 Unity】接收到启动命令 → 切换到场景 ${sceneId}`);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`ok scene ${sceneId}`);
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`[mock-unity] 模拟 Unity 已监听 ${PORT} 端口，等待启动命令...`);
  console.log("[mock-unity] 在浏览器打开 http://localhost:3000 点击「启动」即可测试");
});
