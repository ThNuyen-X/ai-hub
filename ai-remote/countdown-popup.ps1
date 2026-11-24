# Cua so dem nguoc toi gian, hien dai (WPF) tren laptop.
# Duoc goi boi server.cjs (showCountdownPopup). Chi chua ky tu ASCII;
# chuoi tieng Viet truyen qua bien moi truong POPUP_*.
param([int]$Port = 20139)

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$base = "http://127.0.0.1:$Port"
$titleText  = if ($env:POPUP_TITLE)  { $env:POPUP_TITLE }  else { 'Power Countdown' }
$noteText   = if ($env:POPUP_NOTE)   { $env:POPUP_NOTE }   else { '' }
$hintText   = if ($env:POPUP_HINT)   { $env:POPUP_HINT }   else { 'Esc' }
$cancelText = if ($env:POPUP_CANCEL) { $env:POPUP_CANCEL } else { 'Cancel' }
$actionType = if ($env:POPUP_TYPE)   { $env:POPUP_TYPE }   else { 'shutdown' }

$palette = @{
  shutdown  = @{ Accent = '#F87171'; Tint = '#231619'; Icon = 'M12,3 L12,12 M18.36,6.64 A9,9 0 1,1 5.64,6.64' }
  restart   = @{ Accent = '#FBBF24'; Tint = '#241E14'; Icon = 'M3,12 A9,9 0 0,1 18.36,5.64 L21,8 M21,3 L21,8 L16,8 M21,12 A9,9 0 0,1 5.64,18.36 L3,16 M3,21 L3,16 L8,16' }
  hibernate = @{ Accent = '#818CF8'; Tint = '#181A2B'; Icon = 'M12,3 L12,21 M5.64,5.64 L18.36,18.36 M3,12 L21,12 M18.36,5.64 L5.64,18.36' }
  sleep     = @{ Accent = '#38BDF8'; Tint = '#13202B'; Icon = 'M20.5,13 A8.5,8.5 0 1,1 11,3.5 A6.5,6.5 0 0,0 20.5,13 Z' }
}
$pal = if ($palette.ContainsKey($actionType)) { $palette[$actionType] } else { $palette['shutdown'] }

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="AI Hub Remote - Countdown"
        Width="388" SizeToContent="Height"
        WindowStartupLocation="CenterScreen"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="True" ResizeMode="NoResize"
        TextOptions.TextFormattingMode="Ideal" TextOptions.TextRenderingMode="ClearType">
  <Window.Resources>
    <Style x:Key="PrimaryBtn" TargetType="Button">
      <Setter Property="Background" Value="#F4F4F5"/>
      <Setter Property="Foreground" Value="#09090B"/>
      <Setter Property="FontFamily" Value="Segoe UI"/>
      <Setter Property="FontSize" Value="13.5"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Height" Value="40"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Bd" Background="{TemplateBinding Background}" CornerRadius="10">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Bd" Property="Background" Value="#FFFFFF"/>
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="Bd" Property="Opacity" Value="0.86"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>

  <Border Margin="22" Background="#14151A" BorderBrush="#262833" BorderThickness="1" CornerRadius="18">
    <Border.Effect>
      <DropShadowEffect Color="#000000" BlurRadius="32" ShadowDepth="10" Opacity="0.58"/>
    </Border.Effect>
    <StackPanel Margin="28,26,28,22">
      <!-- Subtle circular icon -->
      <Border Width="40" Height="40" CornerRadius="20" Background="$($pal.Tint)" HorizontalAlignment="Center" Margin="0,0,0,14">
        <Viewbox Width="18" Height="18" HorizontalAlignment="Center" VerticalAlignment="Center">
          <Canvas Width="24" Height="24">
            <Path Data="$($pal.Icon)" Stroke="$($pal.Accent)" StrokeThickness="2" StrokeStartLineCap="Round" StrokeEndLineCap="Round" StrokeLineJoin="Round"/>
          </Canvas>
        </Viewbox>
      </Border>

      <!-- Title & 1-line subtitle -->
      <TextBlock x:Name="TxtTitle" FontFamily="Segoe UI" FontSize="17" FontWeight="SemiBold" Foreground="#F4F4F5" HorizontalAlignment="Center" TextAlignment="Center"/>
      <TextBlock x:Name="TxtNote" FontFamily="Segoe UI" FontSize="12.5" Foreground="#8B8D98" HorizontalAlignment="Center" TextAlignment="Center" Margin="0,4,0,22"/>

      <!-- Clean minimal countdown -->
      <TextBlock x:Name="TxtTime" Text="--:--" FontFamily="Segoe UI Light, Segoe UI" FontSize="52" FontWeight="Light" Foreground="#FFFFFF" HorizontalAlignment="Center" Margin="0,0,0,18"/>

      <!-- Hairline progress bar -->
      <Border Height="3" Background="#232530" CornerRadius="1.5" Margin="0,0,0,22" ClipToBounds="True">
        <Border x:Name="BarFill" Height="3" Background="$($pal.Accent)" CornerRadius="1.5" HorizontalAlignment="Left" Width="286"/>
      </Border>

      <!-- Crisp neutral Cancel button -->
      <Button x:Name="BtnCancel" Style="{StaticResource PrimaryBtn}" IsCancel="True" IsDefault="True"/>

      <!-- Minimal footer hint -->
      <TextBlock x:Name="TxtHint" FontFamily="Segoe UI" FontSize="11" Foreground="#636675" HorizontalAlignment="Center" Margin="0,12,0,0" TextAlignment="Center"/>
    </StackPanel>
  </Border>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
$win = [Windows.Markup.XamlReader]::Load($reader)

$txtTitle  = $win.FindName('TxtTitle')
$txtNote   = $win.FindName('TxtNote')
$txtTime   = $win.FindName('TxtTime')
$txtHint   = $win.FindName('TxtHint')
$barFill   = $win.FindName('BarFill')
$btnCancel = $win.FindName('BtnCancel')

$txtTitle.Text = $titleText
$txtNote.Text  = $noteText
$txtHint.Text  = $hintText
$btnCancel.Content = $cancelText

$win.Add_MouseLeftButtonDown({ try { $win.DragMove() } catch {} })

$script:fails = 0
$script:maxSec = 0
$script:started = Get-Date

function Get-State {
  try { return Invoke-RestMethod -Uri "$base/api/shutdown-state" -TimeoutSec 2 } catch { return $null }
}

function Update-View {
  if (((Get-Date) - $script:started).TotalSeconds -gt 3700) { $win.Close(); return }
  $s = Get-State
  if ($null -eq $s) {
    $script:fails++
    if ($script:fails -ge 3) { $win.Close() }
    return
  }
  $script:fails = 0
  if (-not $s.active) { $win.Close(); return }
  $left = [int]$s.secondsLeft
  if ($left -lt 0) { $left = 0 }
  if ($left -gt $script:maxSec) { $script:maxSec = $left }
  $txtTime.Text = ('{0:00}:{1:00}' -f [math]::Floor($left / 60), ($left % 60))
  if ($script:maxSec -gt 0) {
    $ratio = [math]::Max(0.0, [math]::Min(1.0, ($left / [double]$script:maxSec)))
    $barFill.Width = [math]::Round(286.0 * $ratio)
  }
}

$btnCancel.Add_Click({
  try { Invoke-RestMethod -Uri "$base/api/system/abort-shutdown" -Method Post -TimeoutSec 5 | Out-Null } catch {}
  $win.Close()
})

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({ Update-View })

$win.Add_ContentRendered({
  $win.Topmost = $true
  $win.Activate() | Out-Null
  try { [System.Media.SystemSounds]::Exclamation.Play() } catch {}
  Update-View
  $timer.Start()
})

[void]$win.ShowDialog()
$timer.Stop()
