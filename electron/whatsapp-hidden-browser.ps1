[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$BrowserPath,
    [Parameter(Mandatory=$true)][string]$UserDataDir,
    [Parameter(Mandatory=$true)][string]$StopFile,
    [int]$ParentPid = 0,
    [int]$WaitForDevToolsSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-BrowserPath([string]$ExplicitPath) {
    if ($ExplicitPath) {
        if (Test-Path -LiteralPath $ExplicitPath -PathType Leaf) { return (Resolve-Path -LiteralPath $ExplicitPath).Path }
        throw "Navegador não encontrado em: $ExplicitPath"
    }
    $candidates = @()
    if ($env:PROGRAMFILES) {
        $candidates += (Join-Path $env:PROGRAMFILES 'Google\Chrome\Application\chrome.exe')
        $candidates += (Join-Path $env:PROGRAMFILES 'Microsoft\Edge\Application\msedge.exe')
    }
    if (${env:PROGRAMFILES(X86)}) {
        $candidates += (Join-Path ${env:PROGRAMFILES(X86)} 'Google\Chrome\Application\chrome.exe')
        $candidates += (Join-Path ${env:PROGRAMFILES(X86)} 'Microsoft\Edge\Application\msedge.exe')
    }
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
        $candidates += (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'Google Chrome ou Microsoft Edge não foi encontrado.'
}

function Quote-Arg([string]$Value) {
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Stop-BrowserTree([int]$ProcessId) {
    if ($ProcessId -le 0) { return }
    try { & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null } catch {
        try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
}

function Get-ValidatedDevToolsEndpoint([int]$Port, [string]$ExpectedPath, [int]$TimeoutMs = 1800) {
    if ($Port -le 0 -or -not $ExpectedPath) { return $null }
    $response = $null
    $reader = $null
    $socket = $null
    $cts = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/json/version")
        $request.Method = 'GET'
        $request.Timeout = [Math]::Max(500, $TimeoutMs)
        $request.ReadWriteTimeout = [Math]::Max(500, $TimeoutMs)
        $request.Proxy = $null
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $payload = ($reader.ReadToEnd() | ConvertFrom-Json)
        $endpoint = [string]$payload.webSocketDebuggerUrl
        if (-not $endpoint) { return $null }
        $uri = [Uri]$endpoint
        if ($uri.Scheme -ne 'ws' -or $uri.Host -notin @('127.0.0.1', 'localhost') -or $uri.Port -ne $Port) { return $null }
        if ($uri.AbsolutePath -ne $ExpectedPath) { return $null }

        # A listening TCP socket is not sufficient: prove that Chromium's browser
        # WebSocket accepts a real CDP handshake before Node receives the endpoint.
        $socket = New-Object System.Net.WebSockets.ClientWebSocket
        $cts = New-Object System.Threading.CancellationTokenSource
        $cts.CancelAfter([Math]::Max(700, $TimeoutMs))
        $null = $socket.ConnectAsync($uri, $cts.Token).GetAwaiter().GetResult()
        if ($socket.State -ne [System.Net.WebSockets.WebSocketState]::Open) { return $null }
        return $endpoint
    }
    catch { return $null }
    finally {
        try { if ($socket) { $socket.Dispose() } } catch {}
        try { if ($cts) { $cts.Dispose() } } catch {}
        try { if ($reader) { $reader.Dispose() } } catch {}
        try { if ($response) { $response.Dispose() } } catch {}
    }
}

if (-not ('VyziumHiddenChromeV3.Native' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace VyziumHiddenChromeV3 {
    public sealed class LaunchInfo {
        public int ProcessId;
        public IntPtr ProcessHandle;
        public IntPtr ThreadHandle;
    }

    public static class Native {
        const uint CREATE_SUSPENDED = 0x00000004;
        const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
        const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        const uint STARTF_USESHOWWINDOW = 0x00000001;
        const short SW_HIDE = 0;
        const int SW_SHOWNOACTIVATE = 4;

        const uint EVENT_OBJECT_CREATE = 0x8000;
        const uint EVENT_OBJECT_SHOW = 0x8002;
        const uint WINEVENT_OUTOFCONTEXT = 0x0000;
        const uint WINEVENT_SKIPOWNPROCESS = 0x0002;
        const int OBJID_WINDOW = 0;
        const int CHILDID_SELF = 0;

        const int GWL_EXSTYLE = -20;
        const int GWLP_HWNDPARENT = -8;
        const long WS_EX_TOOLWINDOW = 0x00000080L;
        const long WS_EX_APPWINDOW = 0x00040000L;
        const long WS_EX_NOACTIVATE = 0x08000000L;
        const uint WS_POPUP = 0x80000000;

        const uint SWP_NOSIZE = 0x0001;
        const uint SWP_NOZORDER = 0x0004;
        const uint SWP_NOACTIVATE = 0x0010;
        const uint SWP_FRAMECHANGED = 0x0020;

        const uint TH32CS_SNAPPROCESS = 0x00000002;
        static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct STARTUPINFO {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct PROCESS_INFORMATION {
            public IntPtr hProcess;
            public IntPtr hThread;
            public uint dwProcessId;
            public uint dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct PROCESSENTRY32 {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
        }

        delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
            int idObject, int idChild, uint idEventThread, uint dwmsEventTime);
        delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
        static extern bool CreateProcessW(string lpApplicationName, StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles,
            uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr hThread);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr hObject);
        [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
        [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate callback, uint idProcess, uint idThread, uint flags);
        [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hWinEventHook);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
        [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
        [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr value);
        [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong32(IntPtr hwnd, int index);
        [DllImport("user32.dll", EntryPoint="SetWindowLongW")] static extern int SetWindowLong32(IntPtr hwnd, int index, int value);
        [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
        [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern sbyte GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
        [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
        [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
        [DllImport("user32.dll")] static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

        [StructLayout(LayoutKind.Sequential)] struct POINT { public int x; public int y; }
        [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

        [ComImport, Guid("56FDF342-FD6D-11d0-958A-006097C9A090"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface ITaskbarList {
            void HrInit();
            void AddTab(IntPtr hwnd);
            void DeleteTab(IntPtr hwnd);
            void ActivateTab(IntPtr hwnd);
            void SetActiveAlt(IntPtr hwnd);
        }
        [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090"), ClassInterface(ClassInterfaceType.None)]
        class CTaskbarList { }

        static int rootPid;
        static IntPtr ownerWindow = IntPtr.Zero;
        static IntPtr createHook = IntPtr.Zero;
        static IntPtr showHook = IntPtr.Zero;
        static WinEventDelegate callback;
        static Thread monitorThread;
        static Timer sweepTimer;
        static readonly ManualResetEventSlim monitorReady = new ManualResetEventSlim(false);
        static uint monitorThreadId;
        static volatile bool stopping;
        static ITaskbarList taskbar;
        static readonly object targetLock = new object();
        static HashSet<uint> targetPids = new HashSet<uint>();

        static IntPtr GetExStyle(IntPtr hwnd) {
            return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, GWL_EXSTYLE) : new IntPtr(GetWindowLong32(hwnd, GWL_EXSTYLE));
        }
        static void SetExStyle(IntPtr hwnd, IntPtr value) {
            if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, GWL_EXSTYLE, value);
            else SetWindowLong32(hwnd, GWL_EXSTYLE, value.ToInt32());
        }
        static void SetOwner(IntPtr hwnd, IntPtr owner) {
            if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, GWLP_HWNDPARENT, owner);
            else SetWindowLong32(hwnd, GWLP_HWNDPARENT, owner.ToInt32());
        }

        static HashSet<uint> BuildTargetPidSet() {
            var parents = new Dictionary<uint,uint>();
            IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snap == INVALID_HANDLE_VALUE) return new HashSet<uint>();
            try {
                PROCESSENTRY32 e = new PROCESSENTRY32();
                e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (Process32FirstW(snap, ref e)) {
                    do { parents[e.th32ProcessID] = e.th32ParentProcessID; e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32)); }
                    while (Process32NextW(snap, ref e));
                }
            } finally { CloseHandle(snap); }

            var targets = new HashSet<uint>();
            targets.Add((uint)rootPid);
            foreach (var pid in parents.Keys) {
                uint cur = pid;
                var seen = new HashSet<uint>();
                while (cur != 0 && seen.Add(cur)) {
                    if (cur == (uint)rootPid) { targets.Add(pid); break; }
                    uint parent;
                    if (!parents.TryGetValue(cur, out parent)) break;
                    cur = parent;
                }
            }
            return targets;
        }

        static void RefreshTargetPidSet() {
            var fresh = BuildTargetPidSet();
            lock (targetLock) targetPids = fresh;
        }

        static bool IsTargetWindow(IntPtr hwnd) {
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            lock (targetLock) return targetPids.Contains(pid);
        }

        public static int[] TargetProcessIds() {
            RefreshTargetPidSet();
            lock (targetLock) {
                var result = new int[targetPids.Count];
                int i = 0;
                foreach (uint pid in targetPids) result[i++] = unchecked((int)pid);
                return result;
            }
        }

        public static bool HasLiveTargetProcess() {
            RefreshTargetPidSet();
            uint[] snapshot;
            lock (targetLock) {
                snapshot = new uint[targetPids.Count];
                targetPids.CopyTo(snapshot);
            }
            foreach (uint pid in snapshot) {
                try { using (var p = Process.GetProcessById(unchecked((int)pid))) { if (!p.HasExited) return true; } }
                catch { }
            }
            return false;
        }

        static void NormalizeWindow(IntPtr hwnd) {
            try {
                if (!IsTargetWindow(hwnd)) return;

                // Microsoft recomenda esconder antes de mudar dinamicamente o estilo de taskbar.
                bool wasVisible = IsWindowVisible(hwnd);
                if (wasVisible) ShowWindow(hwnd, SW_HIDE);

                long style = GetExStyle(hwnd).ToInt64();
                style |= WS_EX_TOOLWINDOW;
                style &= ~WS_EX_APPWINDOW;
                // Não adicionamos WS_EX_NOACTIVATE: queremos alterar o mínimo possível do comportamento do Chrome.
                SetExStyle(hwnd, new IntPtr(style));

                if (ownerWindow != IntPtr.Zero) SetOwner(hwnd, ownerWindow);

                // Mantém a janela real/headful, apenas totalmente fora da área visível.
                SetWindowPos(hwnd, IntPtr.Zero, -30000, -30000, 0, 0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);

                try { if (taskbar != null) taskbar.DeleteTab(hwnd); } catch { }

                // Mostra novamente fora da tela para preservar o comportamento headful/renderizado.
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                try { if (taskbar != null) taskbar.DeleteTab(hwnd); } catch { }
            } catch { }
        }

        static void SweepWindows(object ignored) {
            if (stopping) return;
            try {
                RefreshTargetPidSet();
                EnumWindows((hwnd, lp) => { NormalizeWindow(hwnd); return true; }, IntPtr.Zero);
            } catch { }
        }

        static void OnWinEvent(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint eventThread, uint eventTime) {
            if (stopping || hwnd == IntPtr.Zero) return;
            if (idObject != OBJID_WINDOW || idChild != CHILDID_SELF) return;
            RefreshTargetPidSet();
            NormalizeWindow(hwnd);
        }

        public static LaunchInfo LaunchSuspended(string app, string commandLine, string workingDirectory) {
            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.lpDesktop = "winsta0\\default";
            si.dwFlags = (int)STARTF_USESHOWWINDOW;
            si.wShowWindow = SW_HIDE;
            PROCESS_INFORMATION pi;
            var cmd = new StringBuilder(commandLine);
            bool ok = CreateProcessW(app, cmd, IntPtr.Zero, IntPtr.Zero, false,
                CREATE_SUSPENDED | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT,
                IntPtr.Zero, workingDirectory, ref si, out pi);
            if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessW falhou");
            return new LaunchInfo { ProcessId = unchecked((int)pi.dwProcessId), ProcessHandle = pi.hProcess, ThreadHandle = pi.hThread };
        }

        public static void StartGuard(int processId) {
            rootPid = processId;
            stopping = false;
            monitorReady.Reset();
            callback = OnWinEvent;
            monitorThread = new Thread(() => {
                monitorThreadId = GetCurrentThreadId();
                try {
                    ownerWindow = CreateWindowExW((uint)WS_EX_TOOLWINDOW, "STATIC", "VyziumHiddenOwner", WS_POPUP,
                        -32000, -32000, 1, 1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                    try { taskbar = (ITaskbarList)new CTaskbarList(); taskbar.HrInit(); } catch { taskbar = null; }
                    createHook = SetWinEventHook(EVENT_OBJECT_CREATE, EVENT_OBJECT_CREATE, IntPtr.Zero, callback, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
                    showHook = SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW, IntPtr.Zero, callback, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
                    RefreshTargetPidSet();
                    sweepTimer = new Timer(SweepWindows, null, 0, 200);
                    monitorReady.Set();
                    MSG msg;
                    while (!stopping && GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
                        TranslateMessage(ref msg);
                        DispatchMessage(ref msg);
                    }
                } finally {
                    try { if (sweepTimer != null) sweepTimer.Dispose(); } catch { }
                    try { if (createHook != IntPtr.Zero) UnhookWinEvent(createHook); } catch { }
                    try { if (showHook != IntPtr.Zero) UnhookWinEvent(showHook); } catch { }
                    try { if (ownerWindow != IntPtr.Zero) DestroyWindow(ownerWindow); } catch { }
                    ownerWindow = IntPtr.Zero;
                    try { if (taskbar != null && Marshal.IsComObject(taskbar)) Marshal.FinalReleaseComObject(taskbar); } catch { }
                    taskbar = null;
                }
            });
            monitorThread.IsBackground = true;
            monitorThread.SetApartmentState(ApartmentState.STA);
            monitorThread.Start();
            if (!monitorReady.Wait(5000)) throw new Exception("O guardião Win32 não inicializou em 5 segundos.");
            if (createHook == IntPtr.Zero || showHook == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "SetWinEventHook falhou");
        }

        public static void Resume(LaunchInfo info) {
            uint result = ResumeThread(info.ThreadHandle);
            if (result == 0xFFFFFFFF) throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread falhou");
            CloseHandle(info.ThreadHandle);
            info.ThreadHandle = IntPtr.Zero;
        }

        public static void StopGuard() {
            stopping = true;
            if (monitorThreadId != 0) PostThreadMessage(monitorThreadId, 0x0012, IntPtr.Zero, IntPtr.Zero); // WM_QUIT
            try { if (monitorThread != null) monitorThread.Join(2500); } catch { }
        }

        public static void CloseProcessHandle(LaunchInfo info) {
            if (info != null && info.ProcessHandle != IntPtr.Zero) {
                CloseHandle(info.ProcessHandle);
                info.ProcessHandle = IntPtr.Zero;
            }
        }
    }
}
'@
}

$browser = Resolve-BrowserPath $BrowserPath
$profile = [IO.Path]::GetFullPath($UserDataDir)
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$stopPath = [IO.Path]::GetFullPath($StopFile)
$stopParent = Split-Path -Parent $stopPath
if ($stopParent) { New-Item -ItemType Directory -Path $stopParent -Force | Out-Null }
# The unique stop flag is created by Node; never erase a cancellation that
# arrived while PowerShell was compiling the Win32 helper.

# A reutilização de um perfil LocalAuth deixa DevToolsActivePort no disco em
# algumas versões do Chromium. Nunca aceite esse arquivo de uma execução anterior:
# ele contém uma porta já fechada e resulta exatamente em ECONNREFUSED 127.0.0.1.
$devToolsFile = Join-Path $profile 'DevToolsActivePort'
Remove-Item -LiteralPath $devToolsFile -Force -ErrorAction SilentlyContinue

$argsList = @(
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    ('--user-data-dir=' + $profile),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-blink-features=AutomationControlled',
    # Mantém uma janela headful real para o Chromium/CDP (mais confiável que
    # --no-startup-window), mas ela já nasce fora da área visível. O guardião
    # Win32 é instalado antes de ResumeThread e remove sua presença da taskbar.
    '--window-position=-30000,-30000',
    '--window-size=900,700',
    '--new-window',
    'about:blank'
)
$cmdLine = (Quote-Arg $browser) + ' ' + (($argsList | ForEach-Object { Quote-Arg ([string]$_) }) -join ' ')
$working = Split-Path -Parent $browser
$launch = $null
$exitCode = 0

try {
    if (Test-Path -LiteralPath $stopPath) { throw "Inicialização cancelada pelo Vyzium." }
    $launch = [VyziumHiddenChromeV3.Native]::LaunchSuspended($browser, $cmdLine, $working)
    [VyziumHiddenChromeV3.Native]::StartGuard($launch.ProcessId)
    [VyziumHiddenChromeV3.Native]::Resume($launch)

    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(8, $WaitForDevToolsSeconds))
    $endpoint = $null
    $port = 0

    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $stopPath) { throw "Inicialização cancelada pelo Vyzium." }
        if (Test-Path -LiteralPath $devToolsFile -PathType Leaf) {
            try {
                $lines = @(Get-Content -LiteralPath $devToolsFile -ErrorAction Stop)
                if ($lines.Count -ge 2 -and $lines[0] -match '^\d+$' -and $lines[1] -match '^/devtools/browser/') {
                    $candidatePort = [int]$lines[0]
                    $candidateValues = @(Get-ValidatedDevToolsEndpoint $candidatePort ([string]$lines[1]) 1800)
                    if ($candidateValues.Count -eq 1) {
                        $candidateEndpoint = [string]$candidateValues[0]
                        if ($candidateEndpoint -match '^wss?://(?:127\.0\.0\.1|localhost|\[::1\]):\d+/devtools/browser/[^/]+$') {
                            $port = $candidatePort
                            $endpoint = $candidateEndpoint
                            break
                        }
                    }
                }
            } catch {}
        }
        if (-not [VyziumHiddenChromeV3.Native]::HasLiveTargetProcess()) {
            throw "O Chrome encerrou antes de expor o DevTools. PID inicial: $($launch.ProcessId)"
        }
        if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
            throw "O processo principal do Vyzium encerrou durante a inicialização."
        }
        Start-Sleep -Milliseconds 120
    }

    if (-not $endpoint) {
        throw "O Chrome não expôs o DevTools em $WaitForDevToolsSeconds segundos. PID: $($launch.ProcessId)"
    }

    $payload = [ordered]@{
        ok = $true
        pid = $launch.ProcessId
        headless = $false
        endpoint = $endpoint
        profile = $profile
    }
    [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
    [Console]::Out.Flush()

    # Keep the guard alive for the complete lifetime of this exact browser.
    while ($true) {
        if (Test-Path -LiteralPath $stopPath) { break }
        if (-not [VyziumHiddenChromeV3.Native]::HasLiveTargetProcess()) { break }
        if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 500
    }
}
catch {
    $exitCode = 1
    $message = $_.Exception.Message
    try { [Console]::Error.WriteLine("VYZIUM_HIDDEN_BROWSER_ERROR: $message") } catch {}
}
finally {
    if ($launch) {
        try {
            $targetPids = @([VyziumHiddenChromeV3.Native]::TargetProcessIds()) | Sort-Object -Descending -Unique
            foreach ($targetPid in $targetPids) { Stop-BrowserTree ([int]$targetPid) }
        } catch { try { Stop-BrowserTree $launch.ProcessId } catch {} }
        try { [VyziumHiddenChromeV3.Native]::StopGuard() } catch {}
        try { [VyziumHiddenChromeV3.Native]::CloseProcessHandle($launch) } catch {}
    }
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
}
exit $exitCode
