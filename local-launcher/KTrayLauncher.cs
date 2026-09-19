using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal sealed class KLauncherContext : ApplicationContext
{
    private const int Port = 47831;
    private readonly string root;
    private readonly string logPath;
    private readonly NotifyIcon tray;
    private readonly System.Windows.Forms.Timer timer;
    private readonly EventWaitHandle openSignal;
    private Process starter;
    private bool pendingOpen;
    private int startupTicks;

    public KLauncherContext(EventWaitHandle signal)
    {
        openSignal = signal;
        root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        logPath = Path.Combine(root, ".runtime", "desktop-logs", "launcher.log");
        Directory.CreateDirectory(Path.GetDirectoryName(logPath));

        var menu = new ContextMenuStrip();
        menu.Items.Add(Item("開啟 K 執行中樞", OpenK));
        menu.Items.Add(Item("重新啟動 K", RestartK));
        menu.Items.Add(Item("停止 K", StopK));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(Item("查看啟動紀錄", OpenLog));
        menu.Items.Add(Item("離開並停止 K", ExitLauncher));

        tray = new NotifyIcon();
        tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        tray.Text = "K 執行中樞";
        tray.ContextMenuStrip = menu;
        tray.Visible = true;
        tray.DoubleClick += delegate { OpenK(); };

        timer = new System.Windows.Forms.Timer();
        timer.Interval = 250;
        timer.Tick += OnTimer;
        timer.Start();
        StartK();
    }

    private ToolStripMenuItem Item(string text, Action action)
    {
        var item = new ToolStripMenuItem(text);
        item.Click += delegate { action(); };
        return item;
    }

    private void StartK()
    {
        if (IsKReady()) {
            pendingOpen = true;
            Notify("K 已在執行", "已連接目前的 K 服務。右鍵系統匣圖示可管理。", ToolTipIcon.Info);
            return;
        }
        if (IsPortOpen()) {
            MessageBox.Show("連接埠 47831 已被其他程式使用，K 沒有啟動，也沒有停止該程式。", "K 啟動失敗", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        string script = Path.Combine(root, "Start-K-Desktop.ps1");
        if (!File.Exists(script)) {
            MessageBox.Show("找不到 K 背景啟動程式。", "K 啟動失敗", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        try {
            var start = new ProcessStartInfo {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -NoBrowser",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            starter = new Process();
            starter.StartInfo = start;
            starter.EnableRaisingEvents = true;
            starter.OutputDataReceived += OnStarterOutput;
            starter.ErrorDataReceived += OnStarterOutput;
            starter.Exited += delegate { Log("background starter exited with code " + SafeExitCode(starter)); };
            Log("starting K from " + root);
            starter.Start();
            starter.BeginOutputReadLine();
            starter.BeginErrorReadLine();
            startupTicks = 0;
            pendingOpen = true;
            Notify("K 正在啟動", "後端正在背景準備，完成後會自動開啟。", ToolTipIcon.Info);
        } catch (Exception error) {
            Log("start failed: " + error.Message);
            MessageBox.Show("無法啟動 K：" + error.Message, "K 啟動失敗", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void OnStarterOutput(object sender, DataReceivedEventArgs eventArgs)
    {
        if (!String.IsNullOrWhiteSpace(eventArgs.Data)) Log(eventArgs.Data);
    }

    private void OnTimer(object sender, EventArgs eventArgs)
    {
        if (openSignal.WaitOne(0)) OpenK();
        if (!pendingOpen) return;
        if (IsKReady()) {
            pendingOpen = false;
            OpenAppWindow();
            Notify("K 已就緒", "已開啟 K 執行中樞。關閉視窗後仍會在系統匣執行。", ToolTipIcon.Info);
            return;
        }
        startupTicks++;
        if (startupTicks == 120) Notify("K 仍在啟動", "啟動超過 30 秒，請從系統匣選單查看紀錄。", ToolTipIcon.Warning);
    }

    private void OpenK()
    {
        if (IsKReady()) { OpenAppWindow(); return; }
        StartK();
    }

    private void RestartK()
    {
        if (IsPortOpen() && !IsKReady()) {
            MessageBox.Show("連接埠 47831 不是目前工作區的 K 服務，未執行停止或重啟。", "K", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        StopK(false);
        for (int attempt = 0; attempt < 50 && IsPortOpen(); attempt++) Thread.Sleep(100);
        StartK();
    }

    private void StopK() { StopK(true); }

    private void StopK(bool notify)
    {
        pendingOpen = false;
        if (!IsKReady()) {
            if (notify) Notify("K 未在執行", "目前沒有可停止的 K 服務。", ToolTipIcon.Info);
            return;
        }
        try {
            var cookies = new CookieContainer();
            var open = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/");
            open.CookieContainer = cookies;
            open.Timeout = 3000;
            using (var response = (HttpWebResponse)open.GetResponse()) { }

            var shutdown = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/api/shutdown");
            shutdown.CookieContainer = cookies;
            shutdown.Method = "POST";
            shutdown.ContentType = "application/json";
            shutdown.Headers.Add("X-K-Request", "1");
            shutdown.Timeout = 15000;
            byte[] body = Encoding.UTF8.GetBytes("{}");
            shutdown.ContentLength = body.Length;
            using (var stream = shutdown.GetRequestStream()) stream.Write(body, 0, body.Length);
            using (var response = (HttpWebResponse)shutdown.GetResponse()) { }
            Log("K stopped by launcher");
            if (notify) Notify("K 已停止", "後端已完成正常停止。", ToolTipIcon.Info);
        } catch (Exception error) {
            Log("stop failed: " + error.Message);
            MessageBox.Show("K 無法確認正常停止：" + error.Message, "K", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private bool IsKReady()
    {
        try {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/health");
            request.Timeout = 500;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) {
                string body = reader.ReadToEnd();
                string escapedRoot = root.Replace("\\", "\\\\").TrimEnd('\\', '/');
                return body.Contains("\"app\":\"k-harness-desktop\"") && body.Contains(escapedRoot);
            }
        } catch { return false; }
    }

    private static bool IsPortOpen()
    {
        try {
            using (var client = new TcpClient()) {
                var result = client.BeginConnect("127.0.0.1", Port, null, null);
                bool connected = result.AsyncWaitHandle.WaitOne(150);
                if (connected) client.EndConnect(result);
                return connected;
            }
        } catch { return false; }
    }

    private void OpenAppWindow()
    {
        try { OpenUrl("http://127.0.0.1:" + Port + "/"); }
        catch (Exception error) {
            Log("browser open failed: " + error.Message);
            MessageBox.Show("無法開啟 K 視窗：" + error.Message, "K", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    internal static void OpenUrl(string url)
    {
        string browser = BrowserPath();
        if (browser != null) Process.Start(new ProcessStartInfo { FileName = browser, Arguments = "--app=\"" + url + "\" --start-maximized", UseShellExecute = true });
        else Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
    }

    private static string BrowserPath()
    {
        string[] paths = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe")
        };
        foreach (string candidate in paths) if (File.Exists(candidate)) return candidate;
        return null;
    }

    private void OpenLog()
    {
        if (!File.Exists(logPath)) File.WriteAllText(logPath, "尚無啟動紀錄。\r\n", Encoding.UTF8);
        Process.Start(new ProcessStartInfo { FileName = "notepad.exe", Arguments = "\"" + logPath + "\"", UseShellExecute = true });
    }

    private void ExitLauncher()
    {
        StopK(false);
        tray.Visible = false;
        tray.Dispose();
        timer.Stop();
        ExitThread();
    }

    private void Notify(string title, string message, ToolTipIcon icon)
    {
        tray.BalloonTipTitle = title;
        tray.BalloonTipText = message;
        tray.BalloonTipIcon = icon;
        tray.ShowBalloonTip(3000);
    }

    private void Log(string message)
    {
        try { File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine, Encoding.UTF8); } catch { }
    }

    private static string SafeExitCode(Process process) { try { return process.ExitCode.ToString(); } catch { return "unknown"; } }
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        bool created;
        using (var mutex = new Mutex(true, "Local\\KHarnessTrayLauncher", out created)) {
            using (var openSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\KHarnessTrayOpen")) {
                if (!created) { openSignal.Set(); return; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new KLauncherContext(openSignal));
                GC.KeepAlive(mutex);
            }
        }
    }
}
