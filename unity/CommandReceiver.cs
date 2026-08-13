// CommandReceiver.cs — Unity 命令接收脚本（本地测试版）
// ============================================================
// 用法：
//   1. 把这个脚本放进 Unity 项目的 Assets 目录
//   2. 在场景里新建一个空物体 GameObject，把脚本拖上去
//   3. 在 sceneMap 里配置「场景 ID ↔ 你的场景/程序名」
//   4. 在 Unity 编辑器里点 Play 运行
//   5. 浏览器打开 http://localhost:3000 点「启动」→ 控制台会打印切换日志
//
// 端口约定：8765（与 local-client.js 的 UNITY_URL 保持一致）
// 请求格式：POST http://127.0.0.1:8765/scene/{id}
// ============================================================
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Threading;
using UnityEngine;

public class CommandReceiver : MonoBehaviour
{
    [Header("监听配置")]
    public int port = 8765;

    [Header("场景清单（ID ↔ 说明，启动命令对应这个 ID）")]
    // 注意：这里只做日志展示和示例切换，实际切换逻辑按你的项目结构在 OnSceneCommand 里实现
    public List<SceneEntry> sceneMap = new List<SceneEntry>()
    {
        new SceneEntry("1", "互动投影 A"),
        new SceneEntry("2", "灯光秀 B"),
        new SceneEntry("3", "粒子互动 C"),
    };

    [Serializable]
    public class SceneEntry
    {
        public string id;
        public string name;

        public SceneEntry(string id, string name)
        {
            this.id = id;
            this.name = name;
        }
    }

    private HttpListener listener;
    private Thread listenThread;
    private static readonly ConcurrentQueue<Action> mainThreadQueue = new ConcurrentQueue<Action>();
    private readonly Dictionary<string, string> sceneLookup = new Dictionary<string, string>();

    void Awake()
    {
        foreach (var e in sceneMap)
        {
            if (!sceneLookup.ContainsKey(e.id)) sceneLookup.Add(e.id, e.name);
        }
    }

    void Start()
    {
        try
        {
            listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/");
            listener.Start();
            listenThread = new Thread(ListenLoop) { IsBackground = true };
            listenThread.Start();
            Debug.Log($"[CommandReceiver] 已监听 http://127.0.0.1:{port} ，等待启动命令...");
        }
        catch (Exception e)
        {
            Debug.LogError($"[CommandReceiver] 启动失败：{e.Message}（请确认端口 {port} 未被占用）");
        }
    }

    void ListenLoop()
    {
        while (listener != null && listener.IsListening)
        {
            try
            {
                var ctx = listener.GetContext();
                var path = ctx.Request.Url.AbsolutePath.Trim('/');

                if (path.StartsWith("scene/"))
                {
                    var sceneId = path.Substring("scene/".Length);
                    // 派发到主线程执行，避免跨线程操作 Unity API
                    mainThreadQueue.Enqueue(() => OnSceneCommand(sceneId));
                    ctx.Response.StatusCode = 200;
                    ctx.Response.ContentType = "text/plain; charset=utf-8";
                    var bytes = System.Text.Encoding.UTF8.GetBytes($"ok scene {sceneId}");
                    ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                }
                else
                {
                    ctx.Response.StatusCode = 404;
                }
                ctx.Response.Close();
            }
            catch (Exception e)
            {
                Debug.LogError("[CommandReceiver] " + e.Message);
            }
        }
    }

    /// <summary>收到启动命令（主线程）。在这里实现你的场景切换逻辑。</summary>
    void OnSceneCommand(string sceneId)
    {
        if (sceneLookup.TryGetValue(sceneId, out var sceneName))
        {
            Debug.Log($"[CommandReceiver] ✅ 收到启动命令 sceneId={sceneId}（{sceneName}）");
            // TODO: 在这里调用你的场景切换逻辑，例如：
            //   UnityEngine.SceneManagement.SceneManager.LoadScene(sceneName);
            // 如果你的项目是"多个子场景共存"的结构，就改成激活/隐藏对应对象。
        }
        else
        {
            Debug.LogWarning($"[CommandReceiver] 收到未知场景 ID：{sceneId}（请检查 sceneMap 是否已配置）");
        }
    }

    void Update()
    {
        // 把 HTTP 线程的请求在主线程里逐个执行
        while (mainThreadQueue.TryDequeue(out var action))
        {
            action?.Invoke();
        }
    }

    void OnDestroy()
    {
        if (listener != null)
        {
            listener.Stop();
            listener.Close();
        }
    }
}
