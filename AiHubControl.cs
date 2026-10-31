using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    internal static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    internal static readonly string Server = Path.Combine(Root, "ai-hub-web", "server.js");
    internal static readonly string Logs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ai-hub", "logs");
    internal static readonly string ThemeFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ai-hub", "theme.txt");
    internal static readonly string ServerLogFile = Path.Combine(Logs, "server.log");

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern uint GetExtendedTcpTable(IntPtr pTcpTable, ref int pdwSize, bool bOrder, int ulAf, int tableClass, uint reserved);

    [StructLayout(LayoutKind.Sequential)]
    private struct MIB_TCPROW_OWNER_PID
    {
        public uint state;
        public uint localAddr;
        public byte localPort1;
        public byte localPort2;
        public byte localPort3;
        public byte localPort4;
        public uint remoteAddr;
        public uint remotePort;
        public int owningPid;
    }

    internal static int cachedServerPid = 0;

    internal static int GetPidOnPort(int port)
    {
        int size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, 2, 5, 0);
        if (size <= 0) return 0;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            if (GetExtendedTcpTable(buffer, ref size, false, 2, 5, 0) == 0)
            {
                int count = Marshal.ReadInt32(buffer);
                IntPtr rowPtr = (IntPtr)((long)buffer + 4);
                int rowSize = Marshal.SizeOf(typeof(MIB_TCPROW_OWNER_PID));
                for (int i = 0; i < count; i++)
                {
                    var row = (MIB_TCPROW_OWNER_PID)Marshal.PtrToStructure(rowPtr, typeof(MIB_TCPROW_OWNER_PID));
                    int rowPort = (row.localPort1 << 8) + row.localPort2;
                    if (rowPort == port && row.state == 2)
                    {
                        return row.owningPid;
                    }
                    rowPtr = (IntPtr)((long)rowPtr + rowSize);
                }
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
        return 0;
    }

    internal static string FindNodeExe()
    {
        string[] candidates = new string[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "node", "node.exe")
        };
        foreach (var c in candidates)
        {
            if (File.Exists(c)) return c;
        }
        return "node.exe";
    }

    internal static Dictionary<string, string> LoadConfig()
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        map["PORT"] = "20130";
        map["NINE_ROUTER_IP"] = "127.0.0.1";
        map["NINE_ROUTER_PORT"] = "20128";
        map["NINE_ROUTER_KEY"] = "";
        map["GOOSE_PATH"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "goose.exe");
        map["OPENAI_HOST"] = "http://127.0.0.1:20128";
        map["OPENAI_BASE_URL"] = "http://127.0.0.1:20128/v1";
        map["OPENAI_API_BASE"] = "http://127.0.0.1:20128/v1";
        map["OPENAI_API_KEY"] = "";
        map["AI_HUB_HOST"] = "0.0.0.0";

        string batPath = Path.Combine(Root, "start-web.bat");
        if (File.Exists(batPath))
        {
            try
            {
                foreach (string rawLine in File.ReadAllLines(batPath))
                {
                    string line = rawLine.Trim();
                    if (line.StartsWith("set ", StringComparison.OrdinalIgnoreCase))
                    {
                        string expr = line.Substring(4).Trim();
                        if (expr.StartsWith("\"") && expr.EndsWith("\"") && expr.Length >= 2)
                            expr = expr.Substring(1, expr.Length - 2);
                        int eq = expr.IndexOf('=');
                        if (eq > 0)
                        {
                            string k = expr.Substring(0, eq).Trim();
                            string v = expr.Substring(eq + 1).Trim();
                            map[k] = v;
                        }
                    }
                }
                var keys = new List<string>(map.Keys);
                foreach (var k in keys)
                {
                    string val = map[k];
                    foreach (var sub in keys)
                    {
                        if (val.IndexOf("%" + sub + "%", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            val = val.Replace("%" + sub + "%", map[sub]);
                        }
                    }
                    map[k] = val;
                }
            }
            catch { }
        }
        return map;
    }

    internal static int[] ServerIds()
    {
        if (cachedServerPid > 0)
        {
            try
            {
                var p = Process.GetProcessById(cachedServerPid);
                if (!p.HasExited && p.ProcessName.IndexOf("node", StringComparison.OrdinalIgnoreCase) >= 0)
                    return new int[] { cachedServerPid };
            }
            catch { cachedServerPid = 0; }
        }

        int portPid = GetPidOnPort(20130);
        if (portPid > 0)
        {
            try
            {
                var p = Process.GetProcessById(portPid);
                if (!p.HasExited && p.ProcessName.IndexOf("node", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    cachedServerPid = portPid;
                    return new int[] { portPid };
                }
            }
            catch { }
        }

        string pidFile = Path.Combine(Logs, "server.pid");
        if (File.Exists(pidFile))
        {
            int filePid;
            if (int.TryParse(File.ReadAllText(pidFile).Trim(), out filePid) && filePid > 0)
            {
                try
                {
                    var p = Process.GetProcessById(filePid);
                    if (!p.HasExited && p.ProcessName.IndexOf("node", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        cachedServerPid = filePid;
                        return new int[] { filePid };
                    }
                }
                catch { }
            }
        }

        var ids = new List<int>();
        try
        {
            using (var query = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'"))
            using (var results = query.Get())
            {
                foreach (ManagementObject item in results)
                {
                    using (item)
                    {
                        string command = Convert.ToString(item["CommandLine"]);
                        if (!string.IsNullOrEmpty(command) &&
                            (command.IndexOf("\"" + Server + "\"", StringComparison.OrdinalIgnoreCase) >= 0 ||
                             command.EndsWith(" " + Server, StringComparison.OrdinalIgnoreCase)))
                        {
                            int pid = Convert.ToInt32(item["ProcessId"]);
                            ids.Add(pid);
                            cachedServerPid = pid;
                        }
                    }
                }
            }
        }
        catch { }
        return ids.ToArray();
    }

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--self-test")
        {
            Directory.CreateDirectory(Logs);
            using (var icon = new Icon(Path.Combine(Root, "ai-hub-web", "public", "ai-hub-cube.ico")))
                File.WriteAllText(Path.Combine(Logs, "control-self-test.log"), "Icon OK; server PIDs: " + string.Join(",", ServerIds()));
            return;
        }

        bool first;
        using (var mutex = new Mutex(true, "Local\\AIHubControlPanel", out first))
        {
            if (!first)
            {
                try
                {
                    using (var signal = EventWaitHandle.OpenExisting("Local\\AIHubControlShow"))
                        signal.Set();
                }
                catch { }
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ControlPanel(args.Length > 0 && args[0] == "--startup"));
        }
    }
}

internal static class DwmHelper
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    public static void ApplyTheme(IntPtr hwnd, AppTheme theme, Color bg, Color text)
    {
        try
        {
            int darkMode = (theme == AppTheme.Dark) ? 1 : 0;
            DwmSetWindowAttribute(hwnd, 20, ref darkMode, sizeof(int)); // DWMWA_USE_IMMERSIVE_DARK_MODE

            int corner = 2; // DWMWCP_ROUND
            DwmSetWindowAttribute(hwnd, 33, ref corner, sizeof(int)); // DWMWA_WINDOW_CORNER_PREFERENCE

            int colorRef = (bg.B << 16) | (bg.G << 8) | bg.R;
            DwmSetWindowAttribute(hwnd, 35, ref colorRef, sizeof(int)); // DWMWA_CAPTION_COLOR

            int textRef = (text.B << 16) | (text.G << 8) | text.R;
            DwmSetWindowAttribute(hwnd, 36, ref textRef, sizeof(int)); // DWMWA_TEXT_COLOR
        }
        catch { }
    }
}

internal enum AppTheme { Dark, Light, Warm }

internal sealed class ThemeColors
{
    public Color BgBase;
    public Color BgCard;
    public Color CardBorder;
    public Color BorderSubtle;
    public Color TextMain;
    public Color TextMuted;
    public Color TextSub;

    public Color PrimaryTop;
    public Color PrimaryBot;
    public Color PrimaryTopHover;
    public Color PrimaryBotHover;
    public Color PrimaryBorder;
    public Color PrimaryText;

    public Color SecBg;
    public Color SecBgHover;
    public Color SecBorder;
    public Color SecText;

    public Color DangerBg;
    public Color DangerBgHover;
    public Color DangerBorder;
    public Color DangerText;

    public Color OnlinePillBg;
    public Color OnlinePillBorder;
    public Color OnlinePillText;
    public Color OnlineDot;

    public Color OfflinePillBg;
    public Color OfflinePillBorder;
    public Color OfflinePillText;
    public Color OfflineDot;

    public Color UrlBarBg;
    public Color UrlBarBorder;
    public Color UrlText;

    public Color MetricBg;
    public Color MetricBorder;
    public Color CodeBg;
    public Color CodeText;

    public static ThemeColors Create(AppTheme theme)
    {
        var t = new ThemeColors();
        if (theme == AppTheme.Light)
        {
            t.BgBase = Color.FromArgb(248, 250, 252);
            t.BgCard = Color.FromArgb(255, 255, 255);
            t.CardBorder = Color.FromArgb(226, 232, 240);
            t.BorderSubtle = Color.FromArgb(241, 245, 249);
            t.TextMain = Color.FromArgb(15, 23, 42);
            t.TextMuted = Color.FromArgb(51, 65, 85);
            t.TextSub = Color.FromArgb(100, 116, 139);

            t.PrimaryTop = Color.FromArgb(37, 99, 235);
            t.PrimaryBot = Color.FromArgb(29, 78, 216);
            t.PrimaryTopHover = Color.FromArgb(59, 130, 246);
            t.PrimaryBotHover = Color.FromArgb(37, 99, 235);
            t.PrimaryBorder = Color.FromArgb(37, 99, 235);
            t.PrimaryText = Color.White;

            t.SecBg = Color.FromArgb(241, 245, 249);
            t.SecBgHover = Color.FromArgb(226, 232, 240);
            t.SecBorder = Color.FromArgb(203, 213, 225);
            t.SecText = Color.FromArgb(30, 41, 59);

            t.DangerBg = Color.FromArgb(254, 242, 242);
            t.DangerBgHover = Color.FromArgb(254, 226, 226);
            t.DangerBorder = Color.FromArgb(252, 165, 165);
            t.DangerText = Color.FromArgb(220, 38, 38);

            t.OnlinePillBg = Color.FromArgb(236, 253, 245);
            t.OnlinePillBorder = Color.FromArgb(167, 243, 208);
            t.OnlinePillText = Color.FromArgb(6, 95, 70);
            t.OnlineDot = Color.FromArgb(16, 185, 129);

            t.OfflinePillBg = Color.FromArgb(241, 245, 249);
            t.OfflinePillBorder = Color.FromArgb(226, 232, 240);
            t.OfflinePillText = Color.FromArgb(100, 116, 139);
            t.OfflineDot = Color.FromArgb(148, 163, 184);

            t.UrlBarBg = Color.FromArgb(248, 250, 252);
            t.UrlBarBorder = Color.FromArgb(226, 232, 240);
            t.UrlText = Color.FromArgb(2, 132, 199);

            t.MetricBg = Color.FromArgb(248, 250, 252);
            t.MetricBorder = Color.FromArgb(226, 232, 240);
            t.CodeBg = Color.FromArgb(241, 245, 249);
            t.CodeText = Color.FromArgb(30, 41, 59);
        }
        else if (theme == AppTheme.Warm)
        {
            t.BgBase = Color.FromArgb(250, 247, 242);
            t.BgCard = Color.FromArgb(255, 255, 255);
            t.CardBorder = Color.FromArgb(226, 215, 199);
            t.BorderSubtle = Color.FromArgb(237, 229, 216);
            t.TextMain = Color.FromArgb(38, 32, 27);
            t.TextMuted = Color.FromArgb(82, 66, 53);
            t.TextSub = Color.FromArgb(140, 122, 107);

            t.PrimaryTop = Color.FromArgb(82, 66, 53);
            t.PrimaryBot = Color.FromArgb(61, 49, 39);
            t.PrimaryTopHover = Color.FromArgb(105, 85, 68);
            t.PrimaryBotHover = Color.FromArgb(82, 66, 53);
            t.PrimaryBorder = Color.FromArgb(82, 66, 53);
            t.PrimaryText = Color.White;

            t.SecBg = Color.FromArgb(244, 239, 230);
            t.SecBgHover = Color.FromArgb(236, 229, 218);
            t.SecBorder = Color.FromArgb(214, 200, 182);
            t.SecText = Color.FromArgb(38, 32, 27);

            t.DangerBg = Color.FromArgb(253, 242, 242);
            t.DangerBgHover = Color.FromArgb(254, 226, 226);
            t.DangerBorder = Color.FromArgb(245, 198, 198);
            t.DangerText = Color.FromArgb(185, 28, 28);

            t.OnlinePillBg = Color.FromArgb(237, 247, 237);
            t.OnlinePillBorder = Color.FromArgb(200, 230, 201);
            t.OnlinePillText = Color.FromArgb(30, 70, 32);
            t.OnlineDot = Color.FromArgb(46, 125, 50);

            t.OfflinePillBg = Color.FromArgb(244, 239, 230);
            t.OfflinePillBorder = Color.FromArgb(226, 215, 199);
            t.OfflinePillText = Color.FromArgb(140, 122, 107);
            t.OfflineDot = Color.FromArgb(176, 160, 144);

            t.UrlBarBg = Color.FromArgb(247, 243, 236);
            t.UrlBarBorder = Color.FromArgb(226, 215, 199);
            t.UrlText = Color.FromArgb(133, 77, 14);

            t.MetricBg = Color.FromArgb(247, 243, 236);
            t.MetricBorder = Color.FromArgb(226, 215, 199);
            t.CodeBg = Color.FromArgb(244, 239, 230);
            t.CodeText = Color.FromArgb(61, 49, 39);
        }
        else // Dark (Obsidian)
        {
            t.BgBase = Color.FromArgb(9, 9, 11);
            t.BgCard = Color.FromArgb(20, 20, 25);
            t.CardBorder = Color.FromArgb(39, 39, 51);
            t.BorderSubtle = Color.FromArgb(30, 30, 40);
            t.TextMain = Color.FromArgb(252, 252, 252);
            t.TextMuted = Color.FromArgb(161, 161, 170);
            t.TextSub = Color.FromArgb(113, 113, 122);

            t.PrimaryTop = Color.FromArgb(59, 130, 246);
            t.PrimaryBot = Color.FromArgb(37, 99, 235);
            t.PrimaryTopHover = Color.FromArgb(96, 165, 250);
            t.PrimaryBotHover = Color.FromArgb(59, 130, 246);
            t.PrimaryBorder = Color.FromArgb(59, 130, 246);
            t.PrimaryText = Color.White;

            t.SecBg = Color.FromArgb(30, 30, 39);
            t.SecBgHover = Color.FromArgb(42, 42, 54);
            t.SecBorder = Color.FromArgb(45, 45, 58);
            t.SecText = Color.FromArgb(228, 228, 231);

            t.DangerBg = Color.FromArgb(42, 18, 21);
            t.DangerBgHover = Color.FromArgb(64, 24, 29);
            t.DangerBorder = Color.FromArgb(92, 29, 36);
            t.DangerText = Color.FromArgb(248, 113, 113);

            t.OnlinePillBg = Color.FromArgb(6, 78, 59);
            t.OnlinePillBorder = Color.FromArgb(5, 150, 105);
            t.OnlinePillText = Color.FromArgb(110, 231, 183);
            t.OnlineDot = Color.FromArgb(52, 211, 153);

            t.OfflinePillBg = Color.FromArgb(39, 39, 42);
            t.OfflinePillBorder = Color.FromArgb(63, 63, 70);
            t.OfflinePillText = Color.FromArgb(161, 161, 170);
            t.OfflineDot = Color.FromArgb(113, 113, 122);

            t.UrlBarBg = Color.FromArgb(13, 13, 18);
            t.UrlBarBorder = Color.FromArgb(34, 34, 45);
            t.UrlText = Color.FromArgb(56, 189, 248);

            t.MetricBg = Color.FromArgb(15, 15, 20);
            t.MetricBorder = Color.FromArgb(32, 32, 42);
            t.CodeBg = Color.FromArgb(12, 12, 16);
            t.CodeText = Color.FromArgb(209, 213, 219);
        }
        return t;
    }
}

internal static class DrawingHelper
{
    public static GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        var path = new GraphicsPath();
        if (radius <= 0) { path.AddRectangle(r); return path; }
        int d = radius * 2;
        if (d > r.Width) d = r.Width;
        if (d > r.Height) d = r.Height;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    public static Font ModernFont(string family, float size, FontStyle style)
    {
        try
        {
            using (var test = new FontFamily(family))
                return new Font(family, size, style);
        }
        catch
        {
            return new Font("Segoe UI", size, style);
        }
    }
}

internal sealed class ModernCard : Panel
{
    public Color CardBackground { get; set; }
    public Color BorderColor { get; set; }
    public int Radius { get; set; }

    public ModernCard()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw, true);
        Radius = 8;
        BackColor = Color.Transparent;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DrawingHelper.RoundedRect(rect, Radius))
        {
            using (var brush = new SolidBrush(CardBackground))
                e.Graphics.FillPath(brush, path);
            using (var pen = new Pen(BorderColor, 1))
                e.Graphics.DrawPath(pen, path);
        }
    }
}

internal sealed class ModernButton : Control
{
    private Color normalBg;
    public Color NormalBg
    {
        get { return normalBg; }
        set { if (normalBg != value) { normalBg = value; Invalidate(); } }
    }
    private Color hoverBg;
    public Color HoverBg
    {
        get { return hoverBg; }
        set { if (hoverBg != value) { hoverBg = value; Invalidate(); } }
    }
    private Color pressedBg;
    public Color PressedBg
    {
        get { return pressedBg; }
        set { if (pressedBg != value) { pressedBg = value; Invalidate(); } }
    }
    private Color disabledBg;
    public Color DisabledBg
    {
        get { return disabledBg; }
        set { if (disabledBg != value) { disabledBg = value; Invalidate(); } }
    }
    private Color normalBorder;
    public Color NormalBorder
    {
        get { return normalBorder; }
        set { if (normalBorder != value) { normalBorder = value; Invalidate(); } }
    }
    private Color hoverBorder;
    public Color HoverBorder
    {
        get { return hoverBorder; }
        set { if (hoverBorder != value) { hoverBorder = value; Invalidate(); } }
    }
    private Color disabledBorder;
    public Color DisabledBorder
    {
        get { return disabledBorder; }
        set { if (disabledBorder != value) { disabledBorder = value; Invalidate(); } }
    }
    private Color normalText;
    public Color NormalText
    {
        get { return normalText; }
        set { if (normalText != value) { normalText = value; Invalidate(); } }
    }
    private Color disabledText;
    public Color DisabledText
    {
        get { return disabledText; }
        set { if (disabledText != value) { disabledText = value; Invalidate(); } }
    }
    private bool isGradient;
    public bool IsGradient
    {
        get { return isGradient; }
        set { if (isGradient != value) { isGradient = value; Invalidate(); } }
    }
    private Color gradientTop;
    public Color GradientTop
    {
        get { return gradientTop; }
        set { if (gradientTop != value) { gradientTop = value; Invalidate(); } }
    }
    private Color gradientBottom;
    public Color GradientBottom
    {
        get { return gradientBottom; }
        set { if (gradientBottom != value) { gradientBottom = value; Invalidate(); } }
    }
    private Color gradientTopHover;
    public Color GradientTopHover
    {
        get { return gradientTopHover; }
        set { if (gradientTopHover != value) { gradientTopHover = value; Invalidate(); } }
    }
    private Color gradientBottomHover;
    public Color GradientBottomHover
    {
        get { return gradientBottomHover; }
        set { if (gradientBottomHover != value) { gradientBottomHover = value; Invalidate(); } }
    }
    private int radius = 6;
    public int Radius
    {
        get { return radius; }
        set { if (radius != value) { radius = value; Invalidate(); } }
    }

    private bool isHovered, isPressed;

    public ModernButton()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw |
                 ControlStyles.SupportsTransparentBackColor, true);
        Cursor = Cursors.Hand;
        Radius = 6;
        Font = DrawingHelper.ModernFont("Segoe UI", 9f, FontStyle.Bold);
    }

    protected override void OnTextChanged(EventArgs e)
    {
        base.OnTextChanged(e);
        Invalidate();
    }

    protected override void OnMouseEnter(EventArgs e) { isHovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { isHovered = false; isPressed = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { isPressed = true; Invalidate(); } base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { isPressed = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnEnabledChanged(EventArgs e) { Cursor = Enabled ? Cursors.Hand : Cursors.Default; Invalidate(); base.OnEnabledChanged(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);

        using (var path = DrawingHelper.RoundedRect(rect, Radius))
        {
            if (!Enabled)
            {
                Color dbg = DisabledBg.IsEmpty ? (NormalBg.IsEmpty ? Color.FromArgb(40, 128, 128, 128) : Color.FromArgb(160, NormalBg)) : DisabledBg;
                Color dborder = DisabledBorder.IsEmpty ? NormalBorder : DisabledBorder;
                using (var brush = new SolidBrush(dbg)) e.Graphics.FillPath(brush, path);
                if (!dborder.IsEmpty)
                    using (var pen = new Pen(dborder, 1)) e.Graphics.DrawPath(pen, path);
            }
            else if (IsGradient)
            {
                Color top = isHovered ? GradientTopHover : GradientTop;
                Color bot = isHovered ? GradientBottomHover : GradientBottom;
                if (isPressed) { top = GradientBottom; bot = GradientBottom; }
                using (var brush = new LinearGradientBrush(rect, top, bot, LinearGradientMode.Vertical))
                    e.Graphics.FillPath(brush, path);
                using (var pen = new Pen(isHovered ? HoverBorder : NormalBorder, 1))
                    e.Graphics.DrawPath(pen, path);
            }
            else
            {
                Color bg = isPressed ? PressedBg : (isHovered ? HoverBg : NormalBg);
                using (var brush = new SolidBrush(bg)) e.Graphics.FillPath(brush, path);
                using (var pen = new Pen(isHovered ? HoverBorder : NormalBorder, 1))
                    e.Graphics.DrawPath(pen, path);
            }
        }

        Color textColor = Enabled ? NormalText : DisabledText;
        if (textColor.IsEmpty)
            textColor = Enabled ? ForeColor : Color.FromArgb(140, NormalText.IsEmpty ? ForeColor : NormalText);
        var flags = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
        TextRenderer.DrawText(e.Graphics, Text ?? string.Empty, Font, new Rectangle(0, 0, Width, Height), textColor, flags);
    }
}

internal sealed class StatusPill : Control
{
    public enum StateMode { Online, Offline, Busy }
    private StateMode mode = StateMode.Offline;
    private ThemeColors themeColors;

    public StateMode Mode
    {
        get { return mode; }
        set { mode = value; Invalidate(); }
    }

    public void ApplyTheme(ThemeColors colors)
    {
        themeColors = colors;
        Invalidate();
    }

    public StatusPill()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw, true);
        Size = new Size(122, 24);
        Font = DrawingHelper.ModernFont("Segoe UI", 8.5f, FontStyle.Bold);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        if (themeColors == null) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

        Color bg, border, dotColor, textCol;
        string label;

        if (mode == StateMode.Online)
        {
            bg = themeColors.OnlinePillBg;
            border = themeColors.OnlinePillBorder;
            dotColor = themeColors.OnlineDot;
            textCol = themeColors.OnlinePillText;
            label = "ĐANG CHẠY";
        }
        else if (mode == StateMode.Busy)
        {
            bg = Color.FromArgb(224, 242, 254);
            border = Color.FromArgb(56, 189, 248);
            dotColor = Color.FromArgb(2, 132, 199);
            textCol = Color.FromArgb(3, 105, 161);
            label = "ĐANG XỬ LÝ";
        }
        else
        {
            bg = themeColors.OfflinePillBg;
            border = themeColors.OfflinePillBorder;
            dotColor = themeColors.OfflineDot;
            textCol = themeColors.OfflinePillText;
            label = "ĐÃ TẮT";
        }

        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DrawingHelper.RoundedRect(rect, Height / 2))
        {
            using (var b = new SolidBrush(bg)) e.Graphics.FillPath(b, path);
            using (var p = new Pen(border, 1)) e.Graphics.DrawPath(p, path);
        }

        int dotSize = 7;
        int dotX = 10;
        int dotY = (Height - dotSize) / 2;

        if (mode == StateMode.Online)
        {
            // Subtle glowing halo ring around online dot
            using (var bHalo = new SolidBrush(Color.FromArgb(55, dotColor)))
                e.Graphics.FillEllipse(bHalo, dotX - 2, dotY - 2, dotSize + 4, dotSize + 4);
        }

        using (var bDot = new SolidBrush(dotColor))
            e.Graphics.FillEllipse(bDot, dotX, dotY, dotSize, dotSize);

        var textRect = new Rectangle(dotX + dotSize + 6, 0, Width - dotX - dotSize - 8, Height);
        var flags = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine;
        TextRenderer.DrawText(e.Graphics, label, Font, textRect, textCol, flags);
    }
}

internal sealed class ThemeSegmentControl : Control
{
    private AppTheme selectedTheme = AppTheme.Warm;
    private ThemeColors colors;
    private int hoveredSegment = -1;

    public AppTheme SelectedTheme
    {
        get { return selectedTheme; }
        set { selectedTheme = value; Invalidate(); }
    }

    public event EventHandler ThemeChanged;

    public void ApplyTheme(ThemeColors c)
    {
        colors = c;
        Invalidate();
    }

    public ThemeSegmentControl()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw, true);
        Size = new Size(166, 28);
        Cursor = Cursors.Hand;
        Font = DrawingHelper.ModernFont("Segoe UI", 8.5f, FontStyle.Bold);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        int seg = Math.Min(2, Math.Max(0, e.X / (Width / 3)));
        if (seg != hoveredSegment) { hoveredSegment = seg; Invalidate(); }
        base.OnMouseMove(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        hoveredSegment = -1;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnClick(EventArgs e)
    {
        var p = PointToClient(Cursor.Position);
        int seg = Math.Min(2, Math.Max(0, p.X / (Width / 3)));
        AppTheme newTheme = AppTheme.Dark;
        if (seg == 1) newTheme = AppTheme.Light;
        else if (seg == 2) newTheme = AppTheme.Warm;

        if (newTheme != selectedTheme)
        {
            selectedTheme = newTheme;
            Invalidate();
            if (ThemeChanged != null) ThemeChanged(this, EventArgs.Empty);
        }
        base.OnClick(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        if (colors == null) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

        var fullRect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DrawingHelper.RoundedRect(fullRect, 6))
        {
            using (var b = new SolidBrush(colors.SecBg)) e.Graphics.FillPath(b, path);
            using (var p = new Pen(colors.CardBorder, 1)) e.Graphics.DrawPath(p, path);
        }

        string[] labels = { "Tối", "Sáng", "Ấm" };
        int segW = Width / 3;

        for (int i = 0; i < 3; i++)
        {
            var segRect = new Rectangle(i * segW + 2, 2, segW - 4, Height - 4);
            bool isCurrent = (int)selectedTheme == i;

            if (isCurrent)
            {
                using (var path = DrawingHelper.RoundedRect(segRect, 5))
                {
                    using (var b = new SolidBrush(colors.BgCard)) e.Graphics.FillPath(b, path);
                    using (var p = new Pen(colors.CardBorder, 1)) e.Graphics.DrawPath(p, path);
                }
            }

            Color textColor = isCurrent ? colors.TextMain : colors.TextSub;

            // Draw vector icon + text
            int iconX = segRect.X + 6;
            int iconY = segRect.Y + (segRect.Height - 10) / 2;

            if (i == 0) // Dark: Moon
            {
                using (var moonPath = new GraphicsPath())
                {
                    moonPath.AddArc(iconX, iconY, 10, 10, -75, 250);
                    moonPath.AddArc(iconX + 3, iconY + 1, 7, 7, 160, -210);
                    moonPath.CloseFigure();
                    using (var b = new SolidBrush(textColor))
                        e.Graphics.FillPath(b, moonPath);
                }
            }
            else if (i == 1) // Light: Sun
            {
                int cx = iconX + 5;
                int cy = iconY + 5;
                using (var b = new SolidBrush(textColor))
                    e.Graphics.FillEllipse(b, cx - 2, cy - 2, 5, 5);
                using (var p = new Pen(textColor, 1.2f))
                {
                    e.Graphics.DrawLine(p, cx, cy - 4, cx, cy - 5);
                    e.Graphics.DrawLine(p, cx, cy + 4, cx, cy + 5);
                    e.Graphics.DrawLine(p, cx - 4, cy, cx - 5, cy);
                    e.Graphics.DrawLine(p, cx + 4, cy, cx + 5, cy);
                }
            }
            else // Warm: Coffee Cup
            {
                using (var cup = new GraphicsPath())
                {
                    cup.AddLine(iconX, iconY + 3, iconX + 8, iconY + 3);
                    cup.AddLine(iconX + 7, iconY + 8, iconX + 1, iconY + 8);
                    cup.CloseFigure();
                    using (var b = new SolidBrush(textColor))
                        e.Graphics.FillPath(b, cup);
                }
                using (var p = new Pen(textColor, 1.1f))
                {
                    e.Graphics.DrawArc(p, iconX + 6, iconY + 3, 3, 3, -90, 180);
                    e.Graphics.DrawLine(p, iconX + 2, iconY + 1, iconX + 2, iconY - 1);
                    e.Graphics.DrawLine(p, iconX + 5, iconY + 1, iconX + 5, iconY - 1);
                }
            }

            var textRect = new Rectangle(iconX + 13, segRect.Y, segRect.Width - 19, segRect.Height);
            var flags = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine;
            TextRenderer.DrawText(e.Graphics, labels[i], Font, textRect, textColor, flags);
        }
    }
}

internal sealed class MetricChip : Control
{
    private string title = "";
    private string valueText = "";
    private ThemeColors colors;

    public string Title
    {
        get { return title; }
        set { title = value; Invalidate(); }
    }

    public string ValueText
    {
        get { return valueText; }
        set { valueText = value; Invalidate(); }
    }

    public void ApplyTheme(ThemeColors c)
    {
        colors = c;
        Invalidate();
    }

    public MetricChip()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw, true);
        Size = new Size(114, 46);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        if (colors == null) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DrawingHelper.RoundedRect(rect, 6))
        {
            using (var b = new SolidBrush(colors.MetricBg)) e.Graphics.FillPath(b, path);
            using (var p = new Pen(colors.MetricBorder, 1)) e.Graphics.DrawPath(p, path);
        }

        using (var fTitle = DrawingHelper.ModernFont("Segoe UI", 7f, FontStyle.Bold))
        {
            var rTitle = new Rectangle(8, 4, Width - 16, 14);
            TextRenderer.DrawText(e.Graphics, title.ToUpperInvariant(), fTitle, rTitle, colors.TextSub, TextFormatFlags.Left | TextFormatFlags.SingleLine);
        }

        using (var fVal = DrawingHelper.ModernFont("Segoe UI", 8.5f, FontStyle.Bold))
        {
            var rVal = new Rectangle(8, 20, Width - 16, 20);
            TextRenderer.DrawText(e.Graphics, valueText, fVal, rVal, colors.TextMain, TextFormatFlags.Left | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
        }
    }
}

internal sealed class ModernCheckBox : Control
{
    private bool isChecked;
    private bool isHovered;
    private ThemeColors colors;
    public string Subtitle { get; set; }

    public bool Checked
    {
        get { return isChecked; }
        set { if (isChecked != value) { isChecked = value; Invalidate(); OnCheckedChanged(EventArgs.Empty); } }
    }

    public event EventHandler CheckedChanged;
    private void OnCheckedChanged(EventArgs e) { if (CheckedChanged != null) CheckedChanged(this, e); }

    public void ApplyTheme(ThemeColors c)
    {
        colors = c;
        Invalidate();
    }

    public ModernCheckBox()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw, true);
        Cursor = Cursors.Hand;
        Size = new Size(390, 36);
        Font = DrawingHelper.ModernFont("Segoe UI", 9f, FontStyle.Bold);
        Subtitle = "";
    }

    protected override void OnMouseEnter(EventArgs e) { isHovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { isHovered = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnClick(EventArgs e) { Checked = !Checked; base.OnClick(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        if (colors == null) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

        int boxSize = 18;
        int boxX = 2;
        int boxY = 9;
        var boxRect = new Rectangle(boxX, boxY, boxSize, boxSize);

        using (var path = DrawingHelper.RoundedRect(boxRect, 4))
        {
            if (isChecked)
            {
                using (var b = new SolidBrush(colors.PrimaryTop)) e.Graphics.FillPath(b, path);
                using (var p = new Pen(colors.PrimaryBorder, 1)) e.Graphics.DrawPath(p, path);

                using (var pCheck = new Pen(Color.White, 2f))
                {
                    pCheck.StartCap = LineCap.Round;
                    pCheck.EndCap = LineCap.Round;
                    e.Graphics.DrawLine(pCheck, boxX + 4, boxY + 9, boxX + 7, boxY + 13);
                    e.Graphics.DrawLine(pCheck, boxX + 7, boxY + 13, boxX + 14, boxY + 5);
                }
            }
            else
            {
                using (var b = new SolidBrush(isHovered ? colors.SecBgHover : colors.SecBg)) e.Graphics.FillPath(b, path);
                using (var p = new Pen(colors.CardBorder, 1)) e.Graphics.DrawPath(p, path);
            }
        }

        int textX = boxX + boxSize + 10;
        var rTitle = new Rectangle(textX, 1, Width - textX, 17);
        TextRenderer.DrawText(e.Graphics, Text, Font, rTitle, colors.TextMain, TextFormatFlags.Left | TextFormatFlags.SingleLine);

        if (!string.IsNullOrEmpty(Subtitle))
        {
            using (var fSub = new Font("Segoe UI", 8f))
            {
                var rSub = new Rectangle(textX, 19, Width - textX, 16);
                TextRenderer.DrawText(e.Graphics, Subtitle, fSub, rSub, colors.TextSub, TextFormatFlags.Left | TextFormatFlags.SingleLine);
            }
        }
    }
}

internal sealed class ModernMenuRenderer : ToolStripProfessionalRenderer
{
    private ThemeColors colors;
    public ModernMenuRenderer(ThemeColors c) : base(new ModernColorTable(c))
    {
        colors = c;
    }
    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
    {
        if (e.Item.Selected)
        {
            using (var b = new SolidBrush(colors.SecBgHover))
                e.Graphics.FillRectangle(b, new Rectangle(Point.Empty, e.Item.Size));
        }
        else
        {
            using (var b = new SolidBrush(colors.BgCard))
                e.Graphics.FillRectangle(b, new Rectangle(Point.Empty, e.Item.Size));
        }
    }
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = colors.TextMain;
        base.OnRenderItemText(e);
    }
    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        using (var p = new Pen(colors.CardBorder))
        {
            int y = e.Item.Height / 2;
            e.Graphics.DrawLine(p, 4, y, e.Item.Width - 4, y);
        }
    }
}

internal sealed class ModernColorTable : ProfessionalColorTable
{
    private ThemeColors colors;
    public ModernColorTable(ThemeColors c) { colors = c; }
    public override Color ToolStripDropDownBackground { get { return colors.BgCard; } }
    public override Color MenuBorder { get { return colors.CardBorder; } }
    public override Color MenuItemBorder { get { return Color.Transparent; } }
    public override Color ImageMarginGradientBegin { get { return colors.BgCard; } }
    public override Color ImageMarginGradientMiddle { get { return colors.BgCard; } }
    public override Color ImageMarginGradientEnd { get { return colors.BgCard; } }
}

internal sealed class ControlPanel : Form
{
    private AppTheme currentTheme = AppTheme.Warm;
    private ThemeColors colors;

    // Header
    private readonly PictureBox logoBox = new PictureBox();
    private readonly Label lblAppTitle = new Label();
    private readonly Label lblPort = new Label();
    private readonly ThemeSegmentControl themeSwitcher = new ThemeSegmentControl();

    // Status Card
    private readonly ModernCard statusCard = new ModernCard();
    private readonly Label lblStatusEyebrow = new Label();
    private readonly StatusPill statusPill = new StatusPill();
    private readonly Label lblStatusHeadline = new Label();
    private readonly ModernCard urlBar = new ModernCard();
    private readonly Label lblUrl = new Label();
    private readonly ModernButton btnCopyUrl = new ModernButton();
    private readonly ModernButton btnOpenUrl = new ModernButton();

    // 3 Metric Chips
    private readonly MetricChip chipPort = new MetricChip();
    private readonly MetricChip chipHttp = new MetricChip();
    private readonly MetricChip chipResource = new MetricChip();

    // Actions Card
    private readonly ModernCard actionCard = new ModernCard();
    private readonly ModernButton btnHero = new ModernButton();
    private readonly ModernButton btnSec1 = new ModernButton();
    private readonly ModernButton btnSec2 = new ModernButton();
    private readonly ModernButton btnSec3 = new ModernButton();

    // Options & Toggle
    private readonly ModernCheckBox autoStartCheck = new ModernCheckBox();
    private readonly Label lblToggleLog = new Label();

    // Expandable Live Log Drawer
    private readonly ModernCard logCard = new ModernCard();
    private readonly Label lblLogTitle = new Label();
    private readonly Label btnOpenLogsFolder = new Label();
    private readonly TextBox txtLogPreview = new TextBox();

    // Footer
    private readonly Label lblFooterNote = new Label();
    private readonly Label lblExitLink = new Label();

    // Tray & Signal
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip trayMenu = new ContextMenuStrip();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private readonly EventWaitHandle showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\AIHubControlShow");

    private bool busy, quitting, logExpanded;
    private int ticks;
    private string url = "http://127.0.0.1:20130";
    private string portNumber = "20130";

    internal ControlPanel(bool startup)
    {
        LoadConfigPort();
        LoadSavedTheme();

        Text = "AI Hub Control Panel";
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(430, 448);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        DoubleBuffered = true;
        KeyPreview = true;

        string iconPath = Path.Combine(Program.Root, "ai-hub-web", "public", "ai-hub-cube.ico");
        string pngPath = Path.Combine(Program.Root, "ai-hub-web", "public", "ai-hub-cube.png");
        if (File.Exists(iconPath)) Icon = new Icon(iconPath);

        // ================= HEADER =================
        logoBox.SizeMode = PictureBoxSizeMode.Zoom;
        logoBox.Left = 20;
        logoBox.Top = 16;
        logoBox.Width = 32;
        logoBox.Height = 32;
        logoBox.BackColor = Color.Transparent;
        if (File.Exists(pngPath)) logoBox.Image = Image.FromFile(pngPath);
        else if (Icon != null) logoBox.Image = Icon.ToBitmap();
        Controls.Add(logoBox);

        lblAppTitle.Text = "AI Hub";
        lblAppTitle.Left = 60;
        lblAppTitle.Top = 13;
        lblAppTitle.Width = 140;
        lblAppTitle.Height = 20;
        lblAppTitle.Font = DrawingHelper.ModernFont("Segoe UI", 12f, FontStyle.Bold);
        lblAppTitle.BackColor = Color.Transparent;
        Controls.Add(lblAppTitle);

        lblPort.Text = "Cổng dịch vụ: :" + portNumber;
        lblPort.Left = 60;
        lblPort.Top = 33;
        lblPort.Width = 150;
        lblPort.Height = 16;
        lblPort.Font = DrawingHelper.ModernFont("Segoe UI", 8f, FontStyle.Regular);
        lblPort.BackColor = Color.Transparent;
        Controls.Add(lblPort);

        themeSwitcher.Left = 244;
        themeSwitcher.Top = 18;
        themeSwitcher.SelectedTheme = currentTheme;
        themeSwitcher.ThemeChanged += delegate {
            currentTheme = themeSwitcher.SelectedTheme;
            SaveTheme(currentTheme);
            ApplyTheme();
        };
        Controls.Add(themeSwitcher);

        // ================= 1. STATUS CARD =================
        statusCard.Left = 20;
        statusCard.Top = 58;
        statusCard.Width = 390;
        statusCard.Height = 166;
        Controls.Add(statusCard);

        lblStatusEyebrow.Text = "MÁY CHỦ NỘI BỘ";
        lblStatusEyebrow.Left = 14;
        lblStatusEyebrow.Top = 11;
        lblStatusEyebrow.Width = 150;
        lblStatusEyebrow.Height = 16;
        lblStatusEyebrow.Font = DrawingHelper.ModernFont("Segoe UI", 7.5f, FontStyle.Bold);
        lblStatusEyebrow.BackColor = Color.Transparent;
        statusCard.Controls.Add(lblStatusEyebrow);

        statusPill.Left = 254;
        statusPill.Top = 8;
        statusCard.Controls.Add(statusPill);

        lblStatusHeadline.Text = "Đang kiểm tra trạng thái...";
        lblStatusHeadline.Left = 14;
        lblStatusHeadline.Top = 33;
        lblStatusHeadline.Width = 362;
        lblStatusHeadline.Height = 22;
        lblStatusHeadline.Font = DrawingHelper.ModernFont("Segoe UI", 11.5f, FontStyle.Bold);
        lblStatusHeadline.BackColor = Color.Transparent;
        statusCard.Controls.Add(lblStatusHeadline);

        // URL Bar
        urlBar.Left = 14;
        urlBar.Top = 60;
        urlBar.Width = 362;
        urlBar.Height = 34;
        urlBar.Radius = 6;
        statusCard.Controls.Add(urlBar);

        lblUrl.Text = url;
        lblUrl.Left = 10;
        lblUrl.Top = 1;
        lblUrl.Width = 232;
        lblUrl.Height = 32;
        lblUrl.Font = DrawingHelper.ModernFont("Segoe UI", 9f, FontStyle.Bold);
        lblUrl.BackColor = Color.Transparent;
        lblUrl.TextAlign = ContentAlignment.MiddleLeft;
        lblUrl.Cursor = Cursors.Hand;
        lblUrl.Click += delegate { OpenWeb(); };
        urlBar.Controls.Add(lblUrl);

        btnCopyUrl.Text = "Sao chép";
        btnCopyUrl.Left = 246;
        btnCopyUrl.Top = 4;
        btnCopyUrl.Width = 60;
        btnCopyUrl.Height = 26;
        btnCopyUrl.Radius = 4;
        btnCopyUrl.Font = DrawingHelper.ModernFont("Segoe UI", 7.5f, FontStyle.Bold);
        btnCopyUrl.Click += async delegate { await CopyUrlAction(); };
        urlBar.Controls.Add(btnCopyUrl);

        btnOpenUrl.Text = "Mở Web";
        btnOpenUrl.Left = 310;
        btnOpenUrl.Top = 4;
        btnOpenUrl.Width = 48;
        btnOpenUrl.Height = 26;
        btnOpenUrl.Radius = 4;
        btnOpenUrl.Font = DrawingHelper.ModernFont("Segoe UI", 7.5f, FontStyle.Bold);
        btnOpenUrl.Click += delegate { OpenWeb(); };
        urlBar.Controls.Add(btnOpenUrl);

        // 3 Metric Chips
        chipPort.Left = 14;
        chipPort.Top = 104;
        chipPort.Width = 114;
        chipPort.Height = 48;
        chipPort.Title = "CỔNG DỊCH VỤ";
        chipPort.ValueText = portNumber;
        statusCard.Controls.Add(chipPort);

        chipHttp.Left = 138;
        chipHttp.Top = 104;
        chipHttp.Width = 114;
        chipHttp.Height = 48;
        chipHttp.Title = "PHẢN HỒI HTTP";
        chipHttp.ValueText = "Đang kiểm tra...";
        statusCard.Controls.Add(chipHttp);

        chipResource.Left = 262;
        chipResource.Top = 104;
        chipResource.Width = 114;
        chipResource.Height = 48;
        chipResource.Title = "TIẾN TRÌNH";
        chipResource.ValueText = "Đang quét...";
        statusCard.Controls.Add(chipResource);

        // ================= 2. ACTIONS CARD =================
        actionCard.Left = 20;
        actionCard.Top = 234;
        actionCard.Width = 390;
        actionCard.Height = 112;
        Controls.Add(actionCard);

        // HERO BUTTON & SECONDARY BUTTONS INITIAL STATE
        int[] initialServerIds = Program.ServerIds();
        bool initialServerRunning = initialServerIds.Length > 0;

        btnHero.Text = initialServerRunning ? "MỞ GIAO DIỆN WEB" : "BẬT MÁY CHỦ AI HUB";
        btnHero.Left = 14;
        btnHero.Top = 14;
        btnHero.Width = 362;
        btnHero.Height = 42;
        btnHero.Radius = 6;
        btnHero.IsGradient = true;
        btnHero.Font = DrawingHelper.ModernFont("Segoe UI", 10f, FontStyle.Bold);
        btnHero.Click += async delegate {
            int[] ids = Program.ServerIds();
            if (ids.Length > 0) OpenWeb();
            else await StartServer();
        };
        actionCard.Controls.Add(btnHero);

        // 3 SECONDARY BUTTONS (Width: 115, Gap: 8)
        btnSec1.Left = 14;
        btnSec1.Top = 66;
        btnSec1.Width = 115;
        btnSec1.Height = 32;
        btnSec1.Radius = 5;
        btnSec1.Font = DrawingHelper.ModernFont("Segoe UI", 8.5f, FontStyle.Regular);
        btnSec1.Text = initialServerRunning ? "Khởi động lại" : "Mở Web";
        if (initialServerRunning) btnSec1.Click += OnRestartServerClick;
        else btnSec1.Click += OnOpenWebClick;
        actionCard.Controls.Add(btnSec1);

        btnSec2.Left = 137;
        btnSec2.Top = 66;
        btnSec2.Width = 115;
        btnSec2.Height = 32;
        btnSec2.Radius = 5;
        btnSec2.Font = DrawingHelper.ModernFont("Segoe UI", 8.5f, FontStyle.Regular);
        btnSec2.Text = initialServerRunning ? "Tắt máy chủ" : "Kiểm tra cổng";
        if (initialServerRunning) btnSec2.Click += OnStopServerClick;
        else btnSec2.Click += OnTestPingClick;
        actionCard.Controls.Add(btnSec2);

        btnSec3.Left = 260;
        btnSec3.Top = 66;
        btnSec3.Width = 116;
        btnSec3.Height = 32;
        btnSec3.Radius = 5;
        btnSec3.Font = DrawingHelper.ModernFont("Segoe UI", 8.5f, FontStyle.Regular);
        btnSec3.Text = "Thư mục Logs";
        btnSec3.Click += delegate {
            try {
                Directory.CreateDirectory(Program.Logs);
                Process.Start("explorer.exe", "\"" + Program.Logs + "\"");
            } catch (Exception ex) { Error(ex); }
        };
        actionCard.Controls.Add(btnSec3);

        // ================= 3. OPTIONS & TOGGLE =================
        autoStartCheck.Left = 20;
        autoStartCheck.Top = 356;
        autoStartCheck.Width = 250;
        autoStartCheck.Height = 36;
        autoStartCheck.Text = "Khởi động cùng Windows";
        autoStartCheck.Subtitle = "Tự động chạy ngầm trong khay hệ thống.";

        using (var key = Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run"))
            autoStartCheck.Checked = (key != null && key.GetValue("AIHub") != null);

        autoStartCheck.CheckedChanged += delegate {
            try
            {
                using (var key = Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run"))
                {
                    if (autoStartCheck.Checked)
                        key.SetValue("AIHub", "\"" + Application.ExecutablePath + "\" --startup");
                    else
                        key.DeleteValue("AIHub", false);
                }
            }
            catch (Exception ex) { Error(ex); }
        };
        Controls.Add(autoStartCheck);

        lblToggleLog.Text = "▶ Xem nhật ký live";
        lblToggleLog.Left = 276;
        lblToggleLog.Top = 364;
        lblToggleLog.Width = 134;
        lblToggleLog.Height = 20;
        lblToggleLog.Font = DrawingHelper.ModernFont("Segoe UI", 8f, FontStyle.Bold);
        lblToggleLog.TextAlign = ContentAlignment.MiddleRight;
        lblToggleLog.Cursor = Cursors.Hand;
        lblToggleLog.Click += delegate { ToggleLogDrawer(); };
        Controls.Add(lblToggleLog);

        // ================= EXPANDABLE LOG DRAWER =================
        logCard.Left = 20;
        logCard.Top = 400;
        logCard.Width = 390;
        logCard.Height = 96;
        logCard.Radius = 6;
        logCard.Visible = false;
        Controls.Add(logCard);

        lblLogTitle.Text = "NHẬT KÝ MÁY CHỦ (GẦN NHẤT)";
        lblLogTitle.Left = 12;
        lblLogTitle.Top = 6;
        lblLogTitle.Width = 200;
        lblLogTitle.Height = 14;
        lblLogTitle.Font = DrawingHelper.ModernFont("Segoe UI", 7f, FontStyle.Bold);
        lblLogTitle.BackColor = Color.Transparent;
        logCard.Controls.Add(lblLogTitle);

        btnOpenLogsFolder.Text = "Mở thư mục ↗";
        btnOpenLogsFolder.Left = 290;
        btnOpenLogsFolder.Top = 6;
        btnOpenLogsFolder.Width = 90;
        btnOpenLogsFolder.Height = 14;
        btnOpenLogsFolder.Font = DrawingHelper.ModernFont("Segoe UI", 7.5f, FontStyle.Bold);
        btnOpenLogsFolder.TextAlign = ContentAlignment.TopRight;
        btnOpenLogsFolder.Cursor = Cursors.Hand;
        btnOpenLogsFolder.Click += delegate {
            try {
                Directory.CreateDirectory(Program.Logs);
                Process.Start("explorer.exe", "\"" + Program.Logs + "\"");
            } catch { }
        };
        logCard.Controls.Add(btnOpenLogsFolder);

        txtLogPreview.Left = 10;
        txtLogPreview.Top = 24;
        txtLogPreview.Width = 370;
        txtLogPreview.Height = 64;
        txtLogPreview.Multiline = true;
        txtLogPreview.ReadOnly = true;
        txtLogPreview.BorderStyle = BorderStyle.None;
        txtLogPreview.Font = DrawingHelper.ModernFont("Consolas", 8f, FontStyle.Regular);
        txtLogPreview.WordWrap = false;
        txtLogPreview.ScrollBars = ScrollBars.Vertical;
        logCard.Controls.Add(txtLogPreview);

        // ================= FOOTER =================
        lblFooterNote.Text = "Thu nhỏ xuống khay hệ thống khi đóng.";
        lblFooterNote.Left = 22;
        lblFooterNote.Top = 412;
        lblFooterNote.Width = 260;
        lblFooterNote.Height = 18;
        lblFooterNote.Font = DrawingHelper.ModernFont("Segoe UI", 8f, FontStyle.Regular);
        lblFooterNote.BackColor = Color.Transparent;
        Controls.Add(lblFooterNote);

        lblExitLink.Text = "Thoát ứng dụng";
        lblExitLink.Left = 288;
        lblExitLink.Top = 412;
        lblExitLink.Width = 122;
        lblExitLink.Height = 18;
        lblExitLink.Font = DrawingHelper.ModernFont("Segoe UI", 8f, FontStyle.Bold);
        lblExitLink.TextAlign = ContentAlignment.TopRight;
        lblExitLink.Cursor = Cursors.Hand;
        lblExitLink.Click += async delegate { await ExitApp(); };
        Controls.Add(lblExitLink);

        // ================= TRAY MENU =================
        trayMenu.ShowImageMargin = false;
        trayMenu.Items.Add("Bảng điều khiển", null, delegate { Reveal(); });
        trayMenu.Items.Add("Mở giao diện web", null, delegate { OpenWeb(); });
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add("Bật máy chủ", null, async delegate { await StartServer(); });
        trayMenu.Items.Add("Tắt máy chủ", null, async delegate { await StopServer(); });
        trayMenu.Items.Add("Khởi động lại", null, async delegate { await RestartServer(); });
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add("Thư mục Logs", null, delegate {
            try {
                Directory.CreateDirectory(Program.Logs);
                Process.Start("explorer.exe", "\"" + Program.Logs + "\"");
            } catch { }
        });
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add("Thoát hoàn toàn", null, async delegate { await ExitApp(); });

        tray = new NotifyIcon
        {
            Icon = Icon,
            Text = "AI Hub",
            ContextMenuStrip = trayMenu,
            Visible = true
        };
        tray.DoubleClick += delegate { Reveal(); };

        FormClosing += delegate(object sender, FormClosingEventArgs e)
        {
            if (!quitting)
            {
                e.Cancel = true;
                Hide();
                tray.ShowBalloonTip(1500, "AI Hub", "Ứng dụng tiếp tục chạy ngầm trong khay hệ thống.", ToolTipIcon.Info);
            }
        };

        Resize += delegate { if (WindowState == FormWindowState.Minimized) Hide(); };

        // Handle Keyboard Shortcuts
        KeyDown += delegate(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape)
            {
                Hide();
                e.Handled = true;
            }
            else if (e.Control && e.KeyCode == Keys.O)
            {
                OpenWeb();
                e.Handled = true;
            }
            else if (e.Control && e.KeyCode == Keys.R)
            {
                Task.Run(async () => await RestartServer());
                e.Handled = true;
            }
            else if (e.Control && e.KeyCode == Keys.L)
            {
                try { Process.Start("explorer.exe", "\"" + Program.Logs + "\""); } catch { }
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.F1)
            {
                themeSwitcher.SelectedTheme = AppTheme.Dark;
                currentTheme = AppTheme.Dark;
                SaveTheme(currentTheme);
                ApplyTheme();
            }
            else if (e.KeyCode == Keys.F2)
            {
                themeSwitcher.SelectedTheme = AppTheme.Light;
                currentTheme = AppTheme.Light;
                SaveTheme(currentTheme);
                ApplyTheme();
            }
            else if (e.KeyCode == Keys.F3)
            {
                themeSwitcher.SelectedTheme = AppTheme.Warm;
                currentTheme = AppTheme.Warm;
                SaveTheme(currentTheme);
                ApplyTheme();
            }
        };

        // Apply Theme initially
        ApplyTheme();

        // ================= TIMER =================
        timer.Interval = 1200;
        timer.Tick += async delegate
        {
            if (showSignal.WaitOne(0)) Reveal();
            if (++ticks % (Visible ? 2 : 8) == 0 && !busy)
                await RefreshStatus();
        };
        timer.Start();

        Shown += async delegate
        {
            if (startup)
            {
                Hide();
                await StartServer();
            }
            else
            {
                await RefreshStatus();
            }
        };
    }

    private void ToggleLogDrawer()
    {
        logExpanded = !logExpanded;
        logCard.Visible = logExpanded;
        lblToggleLog.Text = logExpanded ? "▼ Ẩn nhật ký live" : "▶ Xem nhật ký live";

        if (logExpanded)
        {
            ClientSize = new Size(430, 546);
            lblFooterNote.Top = 508;
            lblExitLink.Top = 508;
            ReadLatestLogs();
        }
        else
        {
            ClientSize = new Size(430, 448);
            lblFooterNote.Top = 412;
            lblExitLink.Top = 412;
        }
    }

    private void ReadLatestLogs()
    {
        try
        {
            if (File.Exists(Program.ServerLogFile))
            {
                var lines = File.ReadAllLines(Program.ServerLogFile);
                int count = Math.Min( lines.Length, 8 );
                var tail = new List<string>();
                for (int i = lines.Length - count; i < lines.Length; i++)
                {
                    if (i >= 0 && !string.IsNullOrEmpty(lines[i]))
                        tail.Add(lines[i]);
                }
                txtLogPreview.Text = string.Join(Environment.NewLine, tail.ToArray());
                txtLogPreview.SelectionStart = txtLogPreview.Text.Length;
                txtLogPreview.ScrollToCaret();
            }
            else
            {
                txtLogPreview.Text = "(Chưa có tệp nhật ký server.log)";
            }
        }
        catch (Exception ex)
        {
            txtLogPreview.Text = "(Lỗi đọc logs: " + ex.Message + ")";
        }
    }

    private void ApplyTheme()
    {
        colors = ThemeColors.Create(currentTheme);

        BackColor = colors.BgBase;
        ForeColor = colors.TextMain;

        lblAppTitle.ForeColor = colors.TextMain;
        lblPort.ForeColor = colors.TextSub;
        themeSwitcher.ApplyTheme(colors);

        // Status Card
        statusCard.CardBackground = colors.BgCard;
        statusCard.BorderColor = colors.CardBorder;
        lblStatusEyebrow.ForeColor = colors.TextSub;
        statusPill.ApplyTheme(colors);
        lblStatusHeadline.ForeColor = colors.TextMain;

        urlBar.CardBackground = colors.UrlBarBg;
        urlBar.BorderColor = colors.UrlBarBorder;
        lblUrl.ForeColor = colors.UrlText;

        btnCopyUrl.NormalBg = colors.SecBg;
        btnCopyUrl.HoverBg = colors.SecBgHover;
        btnCopyUrl.NormalBorder = colors.SecBorder;
        btnCopyUrl.NormalText = colors.SecText;

        btnOpenUrl.NormalBg = colors.SecBg;
        btnOpenUrl.HoverBg = colors.SecBgHover;
        btnOpenUrl.NormalBorder = colors.SecBorder;
        btnOpenUrl.NormalText = colors.SecText;

        // Metric Chips
        chipPort.ApplyTheme(colors);
        chipHttp.ApplyTheme(colors);
        chipResource.ApplyTheme(colors);

        // Action Card
        actionCard.CardBackground = colors.BgCard;
        actionCard.BorderColor = colors.CardBorder;

        btnHero.GradientTop = colors.PrimaryTop;
        btnHero.GradientBottom = colors.PrimaryBot;
        btnHero.GradientTopHover = colors.PrimaryTopHover;
        btnHero.GradientBottomHover = colors.PrimaryBotHover;
        btnHero.NormalBorder = colors.PrimaryBorder;
        btnHero.NormalText = colors.PrimaryText;

        btnSec1.NormalBg = colors.SecBg;
        btnSec1.HoverBg = colors.SecBgHover;
        btnSec1.NormalBorder = colors.SecBorder;
        btnSec1.NormalText = colors.SecText;

        btnSec2.NormalBg = colors.SecBg;
        btnSec2.HoverBg = colors.SecBgHover;
        btnSec2.NormalBorder = colors.SecBorder;
        btnSec2.NormalText = colors.SecText;

        btnSec3.NormalBg = colors.SecBg;
        btnSec3.HoverBg = colors.SecBgHover;
        btnSec3.NormalBorder = colors.SecBorder;
        btnSec3.NormalText = colors.SecText;

        autoStartCheck.ApplyTheme(colors);
        lblToggleLog.ForeColor = colors.UrlText;

        // Log Card
        logCard.CardBackground = colors.CodeBg;
        logCard.BorderColor = colors.CardBorder;
        lblLogTitle.ForeColor = colors.TextSub;
        btnOpenLogsFolder.ForeColor = colors.UrlText;
        txtLogPreview.BackColor = colors.CodeBg;
        txtLogPreview.ForeColor = colors.CodeText;

        lblFooterNote.ForeColor = colors.TextSub;
        lblExitLink.ForeColor = colors.DangerText;

        // Tray menu theme
        trayMenu.Renderer = new ModernMenuRenderer(colors);

        // Windows 11 Native Immersive Title Bar & Window Chrome
        DwmHelper.ApplyTheme(Handle, currentTheme, colors.BgBase, colors.TextMain);

        Invalidate(true);
    }

    private void LoadSavedTheme()
    {
        try
        {
            if (File.Exists(Program.ThemeFile))
            {
                string t = File.ReadAllText(Program.ThemeFile).Trim().ToLowerInvariant();
                if (t == "dark") currentTheme = AppTheme.Dark;
                else if (t == "light") currentTheme = AppTheme.Light;
                else if (t == "warm") currentTheme = AppTheme.Warm;
            }
        }
        catch { }
    }

    private void SaveTheme(AppTheme theme)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Program.ThemeFile));
            File.WriteAllText(Program.ThemeFile, theme.ToString().ToLowerInvariant());
        }
        catch { }
    }

    private void LoadConfigPort()
    {
        try
        {
            string configPath = Path.Combine(Program.Root, "start-web.bat");
            if (File.Exists(configPath))
            {
                foreach (string rawLine in File.ReadAllLines(configPath))
                {
                    string line = rawLine.Trim();
                    if (line.StartsWith("set PORT=", StringComparison.OrdinalIgnoreCase) ||
                        line.StartsWith("set \"PORT=", StringComparison.OrdinalIgnoreCase))
                    {
                        int eq = line.IndexOf('=');
                        if (eq > 0)
                        {
                            string p = line.Substring(eq + 1).Trim('"', ' ', '\r', '\n');
                            if (!string.IsNullOrEmpty(p))
                            {
                                portNumber = p;
                                url = "http://127.0.0.1:" + portNumber;
                                break;
                            }
                        }
                    }
                }
            }
        }
        catch { }
    }

    private void Reveal()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
        DwmHelper.ApplyTheme(Handle, currentTheme, colors.BgBase, colors.TextMain);
    }

    private void OpenWeb()
    {
        try
        {
            int[] ids = Program.ServerIds();
            if (ids.Length == 0)
            {
                var ask = MessageBox.Show(this,
                    "Máy chủ đang tạm dừng.\nBạn có muốn khởi động máy chủ và mở Web ngay không?",
                    "Mở AI Hub",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);
                if (ask == DialogResult.Yes)
                {
                    Task.Run(async () =>
                    {
                        await StartServer();
                        if (Program.ServerIds().Length > 0)
                            Process.Start(url);
                    });
                }
                return;
            }
            Process.Start(url);
        }
        catch (Exception ex) { Error(ex); }
    }

    private async Task CopyUrlAction()
    {
        try
        {
            Clipboard.SetText(url);
            btnCopyUrl.Text = "Đã chép ✓";
            btnCopyUrl.NormalText = Color.FromArgb(16, 185, 129);
            btnCopyUrl.Invalidate();
            await Task.Delay(1800);
            btnCopyUrl.Text = "Sao chép";
            btnCopyUrl.NormalText = colors.SecText;
            btnCopyUrl.Invalidate();
        }
        catch { }
    }

    private void Error(Exception e)
    {
        MessageBox.Show(this, e.Message, "AI Hub", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private void SetBusy(bool isBusy, string message)
    {
        busy = isBusy;
        if (isBusy)
        {
            statusPill.Mode = StatusPill.StateMode.Busy;
            lblStatusHeadline.Text = message;
            chipHttp.ValueText = "Đang xử lý...";
            btnHero.Enabled = false;
            btnSec1.Enabled = false;
            btnSec2.Enabled = false;
        }
    }

    private async Task RefreshStatus()
    {
        try
        {
            int[] ids = await Task.Run(() => Program.ServerIds());
            long totalBytes = 0;
            foreach (int id in ids)
            {
                try
                {
                    using (var p = Process.GetProcessById(id))
                        totalBytes += p.WorkingSet64;
                }
                catch (ArgumentException) { }
            }

            bool isRunning = ids.Length > 0;
            long latencyMs = -1;
            bool httpOk = false;

            if (isRunning)
            {
                // Ping local server
                try
                {
                    var sw = Stopwatch.StartNew();
                    httpOk = await Task.Run(() =>
                    {
                        try
                        {
                            var req = (HttpWebRequest)WebRequest.Create(url);
                            req.Proxy = null;
                            req.Timeout = 800;
                            using (var resp = (HttpWebResponse)req.GetResponse())
                                return (int)resp.StatusCode == 200;
                        }
                        catch { return false; }
                    });
                    sw.Stop();
                    if (httpOk) latencyMs = sw.ElapsedMilliseconds;
                }
                catch { }
            }

            if (!busy)
            {
                statusPill.Mode = isRunning ? StatusPill.StateMode.Online : StatusPill.StateMode.Offline;

                chipPort.ValueText = portNumber;

                if (isRunning)
                {
                    lblStatusHeadline.Text = "Máy chủ AI Hub sẵn sàng";
                    chipHttp.ValueText = httpOk ? ("200 OK (" + latencyMs + "ms)") : "Đang khởi động...";
                    chipResource.ValueText = "Node (" + (totalBytes / 1048576) + " MB)";

                    btnHero.Text = "MỞ GIAO DIỆN WEB";
                    btnHero.Click -= OnStartServerClick;
                    btnHero.Click -= OnOpenWebClick;
                    btnHero.Click += OnOpenWebClick;

                    btnSec1.Text = "Khởi động lại";
                    btnSec1.NormalBg = colors.SecBg;
                    btnSec1.HoverBg = colors.SecBgHover;
                    btnSec1.NormalBorder = colors.SecBorder;
                    btnSec1.NormalText = colors.SecText;
                    btnSec1.Click -= OnStopServerClick;
                    btnSec1.Click -= OnOpenWebClick;
                    btnSec1.Click -= OnRestartServerClick;
                    btnSec1.Click += OnRestartServerClick;

                    btnSec2.Text = "Tắt máy chủ";
                    btnSec2.NormalBg = colors.DangerBg;
                    btnSec2.HoverBg = colors.DangerBgHover;
                    btnSec2.NormalBorder = colors.DangerBorder;
                    btnSec2.NormalText = colors.DangerText;
                    btnSec2.Click -= OnStartServerClick;
                    btnSec2.Click -= OnTestPingClick;
                    btnSec2.Click -= OnStopServerClick;
                    btnSec2.Click += OnStopServerClick;
                }
                else
                {
                    lblStatusHeadline.Text = "Máy chủ đang tạm dừng";
                    chipHttp.ValueText = "Tạm dừng";
                    chipResource.ValueText = "Đã dừng";

                    btnHero.Text = "BẬT MÁY CHỦ AI HUB";
                    btnHero.Click -= OnOpenWebClick;
                    btnHero.Click -= OnStartServerClick;
                    btnHero.Click += OnStartServerClick;

                    btnSec1.Text = "Mở Web";
                    btnSec1.NormalBg = colors.SecBg;
                    btnSec1.HoverBg = colors.SecBgHover;
                    btnSec1.NormalBorder = colors.SecBorder;
                    btnSec1.NormalText = colors.SecText;
                    btnSec1.Click -= OnStopServerClick;
                    btnSec1.Click -= OnRestartServerClick;
                    btnSec1.Click -= OnOpenWebClick;
                    btnSec1.Click += OnOpenWebClick;

                    btnSec2.Text = "Kiểm tra cổng";
                    btnSec2.NormalBg = colors.SecBg;
                    btnSec2.HoverBg = colors.SecBgHover;
                    btnSec2.NormalBorder = colors.SecBorder;
                    btnSec2.NormalText = colors.SecText;
                    btnSec2.Click -= OnRestartServerClick;
                    btnSec2.Click -= OnStopServerClick;
                    btnSec2.Click -= OnTestPingClick;
                    btnSec2.Click += OnTestPingClick;
                }

                btnHero.Enabled = true;
                btnSec1.Enabled = true;
                btnSec2.Enabled = true;

                btnHero.Invalidate();
                btnSec1.Invalidate();
                btnSec2.Invalidate();
            }

            if (logExpanded)
            {
                ReadLatestLogs();
            }

            tray.Text = isRunning ? ("AI Hub - Đang chạy (:" + portNumber + ")") : "AI Hub - Đã tắt";
        }
        catch (Exception ex)
        {
            lblStatusHeadline.Text = "Lỗi trạng thái: " + ex.Message;
        }
    }

    private void OnOpenWebClick(object sender, EventArgs e) { OpenWeb(); }
    private async void OnStartServerClick(object sender, EventArgs e) { await StartServer(); }
    private async void OnStopServerClick(object sender, EventArgs e) { await StopServer(); }
    private async void OnRestartServerClick(object sender, EventArgs e) { await RestartServer(); }
    private async void OnTestPingClick(object sender, EventArgs e) { await PingServer(); }

    private async Task StartServer()
    {
        if (busy) return;
        SetBusy(true, "Đang khởi động máy chủ...");
        try
        {
            await Task.Run(() =>
            {
                var env = Program.LoadConfig();
                var psi = new ProcessStartInfo();
                psi.FileName = Program.FindNodeExe();
                psi.Arguments = "\"" + Program.Server + "\"";
                psi.WorkingDirectory = Program.Root;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                foreach (var kv in env)
                {
                    psi.EnvironmentVariables[kv.Key] = kv.Value;
                }

                Process proc = Process.Start(psi);
                if (proc != null)
                {
                    Program.cachedServerPid = proc.Id;
                    try
                    {
                        Directory.CreateDirectory(Program.Logs);
                        File.WriteAllText(Path.Combine(Program.Logs, "server.pid"), proc.Id.ToString());
                    }
                    catch { }
                }
            });

            for (int i = 0; i < 30; i++)
            {
                await Task.Delay(50);
                if (Program.GetPidOnPort(20130) > 0)
                    break;
            }
        }
        catch (Exception ex)
        {
            Error(ex);
        }
        finally
        {
            busy = false;
        }
        await RefreshStatus();
    }

    private async Task StopServer()
    {
        if (busy) return;
        var confirm = MessageBox.Show(this,
            "Tắt máy chủ AI Hub? Tác vụ đang xử lý có thể bị dừng.",
            "Xác nhận",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);

        if (confirm != DialogResult.Yes) return;

        SetBusy(true, "Đang tắt máy chủ...");
        try
        {
            await Task.Run(() =>
            {
                foreach (int id in Program.ServerIds())
                {
                    try
                    {
                        using (var p = Process.GetProcessById(id))
                        {
                            p.Kill();
                            p.WaitForExit(3000);
                        }
                    }
                    catch (ArgumentException) { }
                }
                Program.cachedServerPid = 0;
                try
                {
                    string pidFile = Path.Combine(Program.Logs, "server.pid");
                    if (File.Exists(pidFile)) File.Delete(pidFile);
                }
                catch { }
            });
        }
        catch (Exception ex)
        {
            Error(ex);
        }
        finally
        {
            busy = false;
        }
        await RefreshStatus();
    }

    private async Task RestartServer()
    {
        if (busy) return;
        SetBusy(true, "Đang khởi động lại...");
        try
        {
            await Task.Run(() =>
            {
                foreach (int id in Program.ServerIds())
                {
                    try
                    {
                        using (var p = Process.GetProcessById(id))
                        {
                            p.Kill();
                            p.WaitForExit(3000);
                        }
                    }
                    catch (ArgumentException) { }
                }
                Program.cachedServerPid = 0;
            });

            await Task.Delay(200);

            await Task.Run(() =>
            {
                var env = Program.LoadConfig();
                var psi = new ProcessStartInfo();
                psi.FileName = Program.FindNodeExe();
                psi.Arguments = "\"" + Program.Server + "\"";
                psi.WorkingDirectory = Program.Root;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                foreach (var kv in env)
                {
                    psi.EnvironmentVariables[kv.Key] = kv.Value;
                }

                Process proc = Process.Start(psi);
                if (proc != null)
                {
                    Program.cachedServerPid = proc.Id;
                    try
                    {
                        Directory.CreateDirectory(Program.Logs);
                        File.WriteAllText(Path.Combine(Program.Logs, "server.pid"), proc.Id.ToString());
                    }
                    catch { }
                }
            });

            for (int i = 0; i < 30; i++)
            {
                await Task.Delay(50);
                if (Program.GetPidOnPort(20130) > 0)
                    break;
            }
        }
        catch (Exception ex)
        {
            Error(ex);
        }
        finally
        {
            busy = false;
        }
        await RefreshStatus();
    }

    private async Task PingServer()
    {
        chipHttp.ValueText = "Đang ping...";
        try
        {
            var sw = Stopwatch.StartNew();
            bool ok = await Task.Run(() =>
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(url);
                    req.Proxy = null;
                    req.Timeout = 1500;
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    {
                        return (int)resp.StatusCode == 200;
                    }
                }
                catch { return false; }
            });
            sw.Stop();

            if (ok)
                chipHttp.ValueText = "200 OK (" + sw.ElapsedMilliseconds + "ms)";
            else
                chipHttp.ValueText = "Không phản hồi";
        }
        catch (Exception ex)
        {
            chipHttp.ValueText = "Lỗi ping";
            Error(ex);
        }
    }

    private async Task ExitApp()
    {
        if (busy) return;
        var choice = MessageBox.Show(this,
            "Bạn muốn tắt máy chủ trước khi thoát?\n\n• Yes: Tắt máy chủ và thoát hoàn toàn.\n• No: Giữ máy chủ chạy ngầm, chỉ đóng bảng điều khiển.\n• Cancel: Quay lại.",
            "Thoát AI Hub",
            MessageBoxButtons.YesNoCancel,
            MessageBoxIcon.Question);

        if (choice == DialogResult.Cancel) return;

        if (choice == DialogResult.Yes)
        {
            await StopServer();
            if (Program.ServerIds().Length > 0) return;
        }

        quitting = true;
        Close();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Dispose();
            if (tray != null)
            {
                tray.Visible = false;
                tray.Dispose();
            }
            showSignal.Dispose();
        }
        base.Dispose(disposing);
    }
}
