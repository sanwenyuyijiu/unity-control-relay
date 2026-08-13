# 部署到 Render（云中继 + 任意网络远程控制）

本目录已改造成 **Render 兼容**：HTTP 与 WebSocket 共用一个端口、WS 走 `/ws` 路径、
网页 WS 地址自适应（本地 `ws://` / 云端 `wss://`）、现场客户端带心跳保活。
部署后，手机用**任意网络（含 4G/5G 流量）**打开网页即可控制现场电脑启动 Unity 程序。

> 核心认知：**只有"中继 + 网页"上云**，现场那台电脑仍要开机跑 `local-client.js`。
> 它主动连出云端（不需要公网 IP / 路由器端口映射），由云端把命令转给它去启动 exe。

---

## 一、本地先验证（推荐，5 分钟）

代码已兼容本地单端口，无需改任何东西：

```bash
cd E:\unity案例\微信扫码\local-test
npm install            # 安装 ws（如果还没装）
node server.js        # 终端1：中继 + 网页，默认 http://localhost:3000
node local-client.js  # 终端2：现场客户端，默认连 ws://localhost:3000/ws
```

浏览器打开 http://localhost:3000 ，点「互动A/B/C」应正常启动对应程序。
（macOS/Linux 把 `npm install` 换成 `npm install ws`；`local-client.js` 里用了 `taskkill` 关进程，仅 Windows 可执行，其他系统需改 `killTree` 为 `pkill`。）

---

## 二、推送到 GitHub

1. 在 https://github.com 新建一个**私有或公开**仓库，例如 `unity-control-relay`。
2. 在本目录初始化并提交（`.gitignore` 已排除 `node_modules`、`*.exe`、`programs/` 等）：

```bash
cd E:\unity案例\微信扫码\local-test
git init
git add .
git commit -m "Unity 互动程序云中继（Render 兼容）"
git remote add origin https://github.com/你的用户名/unity-control-relay.git
git branch -M main
git push -u origin main
```

推上去的应是：`server.js`、`public/`、`local-client.js`、`programs.json`、`package.json`、`.gitignore`、`README.md`、`DEPLOY.md`。

---

## 三、Render 新建 Web Service

1. 打开 https://dashboard.render.com → 注册/登录（可用 GitHub 登录，**免费版无需信用卡**）。
2. 点 **New + → Web Service**，连接刚才的 GitHub 仓库，授权。
3. 配置：
   - **Name**：任意，例如 `unity-control`
   - **Environment**：`Node`
   - **Region**：选 **Singapore（新加坡）**（离国内最近，延迟最低）
   - **Branch**：`main`
   - **Build Command**：`npm install`
   - **Start Command**：`npm start`
   - **Instance Type**：先选 **Free**（验证用），长期用选 **Basic $7/月**（不休眠）
4. 点 **Create Web Service**，等待 2~4 分钟构建完成。
5. 部署成功后会得到一个地址，形如：
   ```
   https://unity-control.onrender.com
   ```
   记下这个地址（下面称 `<你的域名>`）。

> 免费版注意：无流量 15 分钟会休眠，下次访问要等 30~60 秒冷启动。
> 现场客户端每 10 分钟发一次心跳（`ping`）保活，但只要现场电脑一直开着就没问题；
> 若连续 15 分钟现场电脑也关机，云端会休眠，重新连上即恢复。

---

## 四、现场电脑连接云端

在**运行 Unity 程序的现场电脑**上：

```bash
cd E:\unity案例\微信扫码\local-test
# 关键：把 RELAY_URL 指向你的 Render 地址（wss + /ws）
set RELAY_URL=wss://unity-control.onrender.com/ws
node local-client.js
```

- 确认 `programs.json` 里三个 exe 路径正确（现场电脑上的真实路径）。
- 看到 `[client] 已上线，设备 ID=1，等待启动命令...` 即代表连上云端。
- 建议开机自启：把上面两行写成 `start-client.bat`，放进「启动」文件夹
  （`shell:startup`），现场电脑一开机就自动连云端。

---

## 五、手机/任意网络远程控制

1. 手机连**任意网络**（同一 WiFi 或 4G/5G 流量都行）。
2. 浏览器打开：
   ```
   https://unity-control.onrender.com
   ```
3. 右上角显示「设备在线」→ 点「互动A/B/C」，现场电脑即启动对应程序。

至此，**不再受同一 WiFi 限制**，也不再需要记 `192.168.1.77` 内网地址。

---

## 六、与微信生态的关系（重要）

- 本部署用 Render 的 `onrender.com` 子域名，**浏览器直接访问免 ICP 备案**，适合快速验证远程控制。
- 但它**不是国内已备案域名**：
  - 服务器在美国，国内访问可能偶发偏慢；
  - **微信内置浏览器可能拦截/警告境外域名**，所以"公众号菜单跳转网页"这一步在 Render 上体验不稳。
- 若你最终要回到最初的"关注公众号 → 菜单跳转 → 远程控制"完整闭环，
  仍建议走 **国内云（腾讯云）+ 已备案域名** 方案（见《云端部署实施计划.md》），
  部署步骤完全一样，只是把 Render 换成国内服务器 + Nginx + 自有域名。

---

## 七、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 网页打开但「设备离线」 | 现场电脑没跑 `local-client.js`，或 `RELAY_URL` 写错。重跑第四步 |
| 点按钮没反应 / 报 exe 不存在 | `programs.json` 路径不对，或 Unity 还没打包。检查路径 |
| 免费版偶尔连不上（等几十秒恢复） | 云端休眠冷启动，属正常；长期用升级 Basic 付费版 |
| 手机在微信里打开被拦 | 换手机系统浏览器（Safari/Chrome）打开，或走国内备案域名方案 |
