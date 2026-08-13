# 本地测试环境（不需要公众号/域名/服务器）

在电脑上先把核心链路跑通：**浏览器触发页 → 中继 → 本地客户端 → 启动/切换 exe**

## 架构（与最终"公众号方案"完全一致，只是全部跑在本机）

```
浏览器打开 http://localhost:3000  (H5 触发页)
   │  WS  ws://localhost:3001
   ▼
server.js  (中继服务，扮演"云服务器")
   │  WS 转发
   ▼
local-client.js  (本地客户端，扮演"现场电脑"上的客户端)
   │  读取 programs.json → 关闭当前 exe → 启动目标 exe
   ▼
Unity 打包的 exe 程序（互动投影 A / 灯光秀 B / ...）
```

> 本地测试用普通 WS / HTTP 即可。**微信专属限制**（HTTPS、WSS、ICP 备案、业务域名）只在真机微信环境才有，本地测试完全不需要。

## 接入你的 Unity 程序（4 步）

1. **打包**：每个互动程序在 Unity 里 Build 成独立 exe（File → Build Settings → Build，选 Windows x64）。
   记住 exe 的输出路径（打包完是"exe + 同名 Data 文件夹"）。
2. **配置**：编辑 `programs.json`，把每个程序的 ID 对应的 exe 路径填好（用正斜杠 `/` 或双反斜杠 `\\`）：

```json
{
  "1": { "name": "互动投影 A", "exe": "E:/unity案例/互动投影A/Builds/互动投影A.exe" },
  "2": { "name": "灯光秀 B",   "exe": "E:/unity案例/灯光秀B/Builds/灯光秀B.exe" }
}
```

3. **（可选）改页面名称**：`public/index.html` 的 `SCENES` 数组里的名字/描述/图标，改成你的程序名，与 programs.json 的 id 对应。
4. **启动测试**：双击 `start-all.bat` → 浏览器打开 http://localhost:3000 → 点「启动」。

> ⚠️ 第一次测试建议先用一个**假 exe** 验证流程（比如复制 `notepad.exe` 或 `mspaint.exe` 到测试目录，把它填进 programs.json）。确认能启动/切换/自动关闭后，再换成真 Unity 打包的 exe。

## 一键启动（推荐）

双击 **`start-all.bat`**，会自动打开 2 个黑色窗口并启动全部服务。

然后浏览器访问 **http://localhost:3000**，点「启动」按钮测试。

> 2 个窗口不要关，测试完一起关掉即可。

## 手动启动（两个命令，分 2 个终端）

```bash
# 终端 1：中继服务
node server.js

# 终端 2：本地客户端（负责启动/切换 exe）
node local-client.js
```

## 页面功能说明

- 每个程序卡片右下角显示 **运行中 / 未运行**（实时状态）
- 点「启动」→ 电脑自动**关闭当前程序**，再打开目标程序
- 启动失败（exe 路径不对/文件不存在）会在页面弹提示

## 端口约定

| 服务 | 端口 | 说明 |
|---|---|---|
| H5 页面 (server.js) | 3000 | 浏览器访问 |
| WS 中继 (server.js) | 3001 | 浏览器/客户端连接 |

## 依赖

- Node.js（本机使用托管版本 `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.12.0\`）
- `ws` 包（已安装到 `C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules`）

## 常见问题

- **点「启动」提示"设备离线"**：确认 `local-client.js` 窗口是否正常（显示"已上线"）
- **提示"exe 不存在"**：`programs.json` 里的路径填错了，或者还没打包/路径包含中文编码问题，用正斜杠 `E:/xx/yy.exe` 写
- **启动后程序打不开/黑屏**：确认 exe 旁边有它的 `Data` 文件夹，且程序是完整打包的 Build 输出
- **端口被占用**：先关掉旧的黑窗口再重新启动

## 旧文件说明（已不再使用）

- `mock-unity.js`：旧版"模拟 Unity 接收端"，程序启动器模式下**不再需要**
- `unity/CommandReceiver.cs`：旧版"Unity 内接收命令"脚本，程序启动器模式下**不再需要**（网页直接启动 exe）
