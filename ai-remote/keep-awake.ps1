# Giu may thuc N phut sau khi lich "Bat may" danh thuc (tranh may ngu lai ngay khi thuc day khong co nguoi dung).
# Duoc goi boi scheduled task BoTotRemoteWake (xem wake-task.ps1).
param([int]$Minutes = 20)

Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'

# ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x1)
[void][Win32.Power]::SetThreadExecutionState([uint32]2147483649)
Start-Sleep -Seconds ($Minutes * 60)
# ES_CONTINUOUS: tra lai che do binh thuong
[void][Win32.Power]::SetThreadExecutionState([uint32]2147483648)
