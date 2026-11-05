using System;
using System.Runtime.InteropServices;
using System.Threading;

class ScreenOff {
    private const int HWND_BROADCAST = 0xFFFF;
    private const int WM_SYSCOMMAND = 0x0112;
    private const int SC_MONITORPOWER = 0xF170;
    private const int MONITOR_OFF = 2;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

    static void Main() {
        Thread.Sleep(200);
        SendMessage(new IntPtr(HWND_BROADCAST), WM_SYSCOMMAND, new IntPtr(SC_MONITORPOWER), new IntPtr(MONITOR_OFF));
    }
}
