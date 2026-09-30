using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal sealed class KLauncherContext : ApplicationContext
{
    private const int Port = 47831;
    private const string CandidateDirectory = ".runtime\\isolation-pilot\\sandboxie-candidate-3b6c43ee";
    private const string StateChild = "private-state";
    private const string NodeExecutable = @"C:\Program Files\nodejs\node.exe";
    private readonly string root;
    private readonly string logPath;
    private readonly NotifyIcon tray;
    private readonly System.Windows.Forms.Timer timer;
    private readonly EventWaitHandle openSignal;
    private readonly Control uiDispatcher;
    private Process supervisor;
    private readonly object supervisorSync = new object();
    private bool pendingOpen;
    private int startupTicks;
    private bool supervisorReady;
    private bool closeConfirmed;
    private bool closeBlocked;
    private bool closeFailed;

    public KLauncherContext(EventWaitHandle signal)
    {
        openSignal = signal;
        root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        logPath = Path.Combine(root, ".runtime", "desktop-logs", "launcher.log");
        Directory.CreateDirectory(Path.GetDirectoryName(logPath));
        uiDispatcher = new Control();
        uiDispatcher.CreateControl();

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
        if (supervisor != null && !HasExited(supervisor)) {
            if (supervisorReady) SendCommand("open");
            else { pendingOpen = true; Notify("K 正在啟動", "隔離服務仍在準備中。", ToolTipIcon.Info); }
            return;
        }
        if (IsPortOpen()) {
            string message = IsKReady()
                ? "K 已在執行，但沒有目前啟動器的記憶體控制通道；未接管服務。請先確認原啟動器狀態。"
                : "連接埠 47831 已被非本啟動器的 K 或其他程式使用；未啟動、停止或接管該服務。";
            MessageBox.Show(message, "K 啟動失敗", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        string candidate = Path.GetFullPath(Path.Combine(root, CandidateDirectory));
        string trustedRuntime = Path.Combine(candidate, "trusted-runtime");
        string script = Path.Combine(trustedRuntime, "src", "electron-isolated-launcher.mjs");
        string node = NodeExecutable;
        if (!File.Exists(script) || !File.Exists(node)) {
            MessageBox.Show("找不到K 啟動程式或 Node 執行檔；未改用一般 K 啟動。", "K 啟動失敗", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        try {
            var start = new ProcessStartInfo {
                FileName = node,
                Arguments = "\"" + script + "\"",
                WorkingDirectory = trustedRuntime,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            var child = new Process();
            child.StartInfo = start;
            child.EnableRaisingEvents = true;
            child.OutputDataReceived += OnSupervisorOutput;
            child.ErrorDataReceived += OnSupervisorError;
            child.Exited += delegate { OnSupervisorExited(child); };
            Log("starting isolated K supervisor");
            lock (supervisorSync) { supervisor = child; supervisorReady = false; closeConfirmed = false; closeBlocked = false; closeFailed = false; }
            child.Start();
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            startupTicks = 0;
            pendingOpen = true;
            Notify("K 正在啟動", "隔離工作區正在準備；完成後會安全開啟。", ToolTipIcon.Info);
        } catch (Exception error) {
            lock (supervisorSync) { if (supervisor != null && HasExited(supervisor)) supervisor = null; supervisorReady = false; }
            Log("start failed: " + error.Message);
            MessageBox.Show("無法啟動K；未改用一般 K。\n" + error.Message, "K 啟動失敗", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void OnSupervisorOutput(object sender, DataReceivedEventArgs eventArgs)
    {
        string line = eventArgs.Data;
        if (String.IsNullOrWhiteSpace(line)) return;
        string type = JsonString(line, "type");
        Process child = sender as Process;
        if (type == "ready" || type == "open") {
            string origin = JsonString(line, "origin");
            string presentation = JsonString(line, "presentation");
            int nativePid;
            if (presentation == "native") {
                if (child == null || !Int32.TryParse(JsonNumber(line, "pid"), out nativePid) || nativePid != child.Id ||
                    origin != "http://127.0.0.1:" + Port || !IsKReady()) {
                    Log("native isolated supervisor event rejected (identity/origin/health validation failed)");
                    lock (supervisorSync) supervisorReady = false;
                    pendingOpen = false;
                    ShowOnUi(delegate { Notify("K 啟動未完成", "原生視窗身分或健康狀態無法確認；沒有接管服務。", ToolTipIcon.Error); });
                    return;
                }
                lock (supervisorSync) supervisorReady = true;
                pendingOpen = false;
                Log(type == "ready" ? "native isolated workbench ready" : "native isolated workbench opened");
                ShowOnUi(delegate { Notify("K 已就緒", "工作台已在原生視窗中開啟。", ToolTipIcon.Info); });
                return;
            }
            string launchUrl = JsonString(line, "launchUrl");
            int pid;
            Uri uri;
            if (child == null || !Int32.TryParse(JsonNumber(line, "pid"), out pid) || pid != child.Id ||
                origin != "http://127.0.0.1:" + Port || !ValidLaunchUrl(launchUrl, origin, out uri) || !IsKReady()) {
                Log("isolated supervisor event rejected (identity/health/token validation failed)");
                lock (supervisorSync) supervisorReady = false;
                pendingOpen = false;
                ShowOnUi(delegate { Notify("K 啟動未完成", "隔離服務身分或健康狀態無法確認；沒有開啟或接管服務。", ToolTipIcon.Error); });
                return;
            }
            lock (supervisorSync) supervisorReady = true;
            Log("isolated supervisor ready; one-use URL received (redacted)");
            bool open = true; // ready auto-opens once; each explicit open reply opens its one-use URL.
            pendingOpen = false;
            if (open) {
                try { OpenUrl(uri.AbsoluteUri); ShowOnUi(delegate { Notify("K 已就緒", "已安全開啟 K 執行中樞。", ToolTipIcon.Info); }); }
                catch (Exception) { Log("browser open failed (bootstrap URL redacted)"); ShowOnUi(delegate { MessageBox.Show("無法開啟 K 視窗；隔離服務仍在執行。", "K", MessageBoxButtons.OK, MessageBoxIcon.Error); }); }
            }
            return;
        }
        if (type == "error") {
            string code = JsonString(line, "code");
            if (code == "active-work") { lock (supervisorSync) closeBlocked = true; Log("stop refused because work or approval is active"); }
            else Log("isolated supervisor returned error code: " + (String.IsNullOrEmpty(code) ? "unknown" : code));
            return;
        }
        if (type == "closed") {
            bool confirmed = Regex.IsMatch(line, "\"confirmed\"\\s*:\\s*true");
            lock (supervisorSync) { closeConfirmed = confirmed; closeFailed = !confirmed; }
            Log(confirmed ? "isolated supervisor confirmed close" : "isolated supervisor could not confirm close");
            return;
        }
        Log("unrecognized supervisor output omitted");
    }

    private void OnSupervisorError(object sender, DataReceivedEventArgs eventArgs)
    {
        if (!String.IsNullOrWhiteSpace(eventArgs.Data)) Log("isolated supervisor stderr omitted (see process status)");
    }

    private void OnSupervisorExited(Process child)
    {
        string exitCode = SafeExitCode(child);
        bool expected;
        lock (supervisorSync) {
            expected = closeConfirmed;
            if (supervisor == child) { supervisor = null; supervisorReady = false; }
        }
        pendingOpen = false;
        Log((expected ? "isolated supervisor exited after confirmed close: " : "isolated supervisor exited unexpectedly: ") + exitCode);
        if (!expected) ShowOnUi(delegate { Notify("K 服務已中斷", "隔離啟動程序已結束；未改用一般 K。", ToolTipIcon.Warning); });
    }

    private void OnTimer(object sender, EventArgs eventArgs)
    {
        if (openSignal.WaitOne(0)) OpenK();
        if (!pendingOpen) return;
        if (IsKReady()) return; // Only the supervisor's in-memory capability may open the app.
        startupTicks++;
        if (startupTicks == 120) Notify("K 仍在啟動", "啟動超過 30 秒，請從系統匣選單查看紀錄。", ToolTipIcon.Warning);
    }

    private void OpenK()
    {
        Process current;
        bool ready;
        lock (supervisorSync) { current = supervisor; ready = supervisorReady; }
        if (current != null && !HasExited(current)) {
            if (ready) {
                try { SendCommand("open"); }
                catch { MessageBox.Show("無法聯絡隔離啟動程序；未改用一般 K 或直接開啟服務。", "K", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            }
            else pendingOpen = true;
            return;
        }
        StartK();
    }

    private void RestartK()
    {
        Process current;
        lock (supervisorSync) current = supervisor;
        if (current == null || HasExited(current)) {
            if (IsPortOpen()) {
                MessageBox.Show(IsKReady() ? "隔離 K 沒有目前啟動器的安全控制通道，未接管或重啟。" : "連接埠 47831 由其他服務使用，未停止或重啟。", "K", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            StartK();
            return;
        }
        if (!StopK(false)) return;
        for (int attempt = 0; attempt < 50 && IsPortOpen(); attempt++) Thread.Sleep(100);
        if (IsPortOpen()) {
            MessageBox.Show("K 未確認完全停止；沒有強制終止，也未啟動新服務。", "K", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        StartK();
    }

    private void StopK() { StopK(true); }

    private bool StopK(bool notify)
    {
        pendingOpen = false;
        Process current;
        lock (supervisorSync) current = supervisor;
        if (current == null || HasExited(current)) {
            if (IsPortOpen()) {
                if (notify) MessageBox.Show(IsKReady() ? "隔離 K 沒有目前啟動器的控制通道；未透過 HTTP 或程序終止接管。" : "連接埠 47831 不是可管理的 K 服務；未停止。", "K", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (notify) Notify("K 未在執行", "目前沒有可停止的 K 服務。", ToolTipIcon.Info);
            return true;
        }
        try {
            lock (supervisorSync) { closeConfirmed = false; closeBlocked = false; closeFailed = false; }
            SendCommand("close");
            for (int attempt = 0; attempt < 150; attempt++) {
                bool confirmed, blocked, failed;
                lock (supervisorSync) { confirmed = closeConfirmed; blocked = closeBlocked; failed = closeFailed; }
                if (confirmed || blocked || failed || HasExited(current)) break;
                Thread.Sleep(100);
            }
            bool closed;
            bool refused;
            bool failedClose;
            lock (supervisorSync) { closed = closeConfirmed; refused = closeBlocked; failedClose = closeFailed; }
            if (!closed) return ForceStop(current, refused ? "仍有工作或待核准事項" : failedClose ? "服務回報關閉失敗" : "等候逾時或無法確認");
            for (int attempt = 0; attempt < 50 && IsPortOpen(); attempt++) Thread.Sleep(100);
            if (IsPortOpen()) {
                return ForceStop(current, "服務回報關閉，但連接埠尚未釋放");
            }
            Log("isolated K stopped by owner supervisor");
            if (notify) Notify("K 已停止", "隔離服務已確認安全關閉。", ToolTipIcon.Info);
            return true;
        } catch (Exception error) {
            Log("isolated K stop command failed: " + error.Message);
            return ForceStop(current, error.Message);
        }
    }

    private bool ForceStop(Process current, string reason)
    {
        // Never find a process by name or port: only the child owned by this launcher.
        if (HasExited(current)) { Log("force stop unavailable: owner already exited"); return false; }
        if (MessageBox.Show("K 無法正常關閉（" + reason + "）。要強制結束嗎？\n還在跑的工作可能中斷，之後需要查看狀態。", "K 強制結束", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) {
            Log("force stop declined: " + reason); return false;
        }
        lock (supervisorSync) { if (supervisor != current || HasExited(current)) return false; }
        try {
            Log("force stop confirmed for owned supervisor PID " + current.Id + ": " + reason);
            using (var killer = Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "taskkill.exe"), "/PID " + current.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true })) {
                if (!killer.WaitForExit(5000) || killer.ExitCode != 0 || !current.WaitForExit(5000)) throw new InvalidOperationException("程序樹結束未確認");
            }
            lock (supervisorSync) { if (supervisor == current) supervisor = null; supervisorReady = false; closeConfirmed = true; }
            Log("owned supervisor process tree forcibly stopped"); return true;
        } catch (Exception error) {
            Log("force stop failed: " + error.Message);
            MessageBox.Show("強制結束未確認：" + error.Message, "K 尚未停止", MessageBoxButtons.OK, MessageBoxIcon.Error); return false;
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
                string candidate = Path.GetFullPath(Path.Combine(root, CandidateDirectory));
                string stateRoot = Path.Combine(candidate, "vault", StateChild);
                return HealthResponseMatchesIsolatedDeployment(body, stateRoot);
            }
        } catch { return false; }
    }

    internal static bool HealthResponseMatchesIsolatedDeployment(string body, string expectedStateRoot)
    {
        if (!Regex.IsMatch(body, "\"app\"\\s*:\\s*\"k-harness-desktop\"")) return false;
        string deployment = JsonString(body, "deployment");
        string workspace = JsonString(body, "workspace");
        if (deployment != "native" || String.IsNullOrEmpty(workspace)) return false;
        try {
            return String.Equals(Path.GetFullPath(workspace).TrimEnd('\\', '/'), Path.GetFullPath(expectedStateRoot).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase);
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

    private void SendCommand(string command)
    {
        Process current;
        lock (supervisorSync) current = supervisor;
        if (current == null || HasExited(current)) throw new InvalidOperationException("隔離啟動程序已結束。");
        current.StandardInput.WriteLine(command);
        current.StandardInput.Flush();
    }

    private void ShowOnUi(Action action)
    {
        try { if (uiDispatcher.InvokeRequired) uiDispatcher.BeginInvoke(action); else action(); }
        catch { }
    }

    private static bool HasExited(Process process) { try { return process == null || process.HasExited; } catch { return true; } }

    private static string JsonString(string json, string key)
    {
        Match match = Regex.Match(json ?? "", "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        if (!match.Success) return null;
        try { return Regex.Unescape(match.Groups[1].Value); } catch { return null; }
    }

    private static string JsonNumber(string json, string key)
    {
        Match match = Regex.Match(json ?? "", "\"" + Regex.Escape(key) + "\"\\s*:\\s*([0-9]+)");
        return match.Success ? match.Groups[1].Value : null;
    }

    private static bool ValidLaunchUrl(string value, string expectedOrigin, out Uri uri)
    {
        uri = null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttp ||
            uri.Host != "127.0.0.1" || uri.Port != Port || uri.AbsolutePath != "/bootstrap" ||
            uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || uri.GetLeftPart(UriPartial.Authority) != expectedOrigin) return false;
        return Regex.IsMatch(uri.Query, "^\\?token=[a-fA-F0-9]{64}$");
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
        if (!StopK(false)) return;
        tray.Visible = false;
        tray.Dispose();
        timer.Stop();
        uiDispatcher.Dispose();
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
