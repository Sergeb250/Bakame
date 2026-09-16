using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.AccessControl;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using Microsoft.Win32;
using TimeoutException = System.TimeoutException;

[assembly: AssemblyTitle("bakame Desktop Service")]
[assembly: AssemblyCompany("Serge Benit")]
[assembly: AssemblyProduct("bakame")]
[assembly: AssemblyCopyright("Customized and enhanced by Serge Benit. Original OpenCluely by TechyCSR and contributors.")]
[assembly: AssemblyDescription("Starts bakame in its owner's signed-in Windows session")]
[assembly: AssemblyVersion("1.0.1.0")]

namespace Bakame.WindowsService {
    internal static class Program {
        internal const string Name = "BakameDesktopService";
        internal static string Executable { get { return Assembly.GetExecutingAssembly().Location; } }
        internal static string AppExecutable { get { return Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Executable), @"..\..\bakame.exe")); } }

        public static int Main(string[] args) {
            try {
                if (args.Length == 1 && args[0] == "--close-desktop") { AdaptiveLaunch.CloseDesktop(); return 0; }
                if (args.Length == 1 && args[0] == "--auto-launch") { return AdaptiveLaunch.Run(); }
                if (args.Length == 1 && args[0] == "--user-sid") { Console.WriteLine(WindowsIdentity.GetCurrent().User.Value); return 0; }
                if (args.Length == 1 && args[0] == "--launch-mode") { Console.WriteLine(AdaptiveLaunch.IsAdministrator ? "service" : "background"); return 0; }
                if (args.Length == 1 && args[0] == "--launch") { return Registration.Launch(); }
                if (args.Length == 1 && args[0] == "--status") { Registration.Status(); return 0; }
                if (args.Length == 1 && args[0] == "--self-test") { SelfTest.Run(); return 0; }
                if (args.Length == 2 && args[0] == "--job-test-child") {
                    using (var child = Process.Start(new ProcessStartInfo(Executable, "--job-test-grandchild") { UseShellExecute = false, CreateNoWindow = true })) {
                        File.WriteAllText(args[1], child.Id.ToString());
                        Thread.Sleep(60000);
                    }
                    return 0;
                }
                if (args.Length == 1 && args[0] == "--job-test-grandchild") { Thread.Sleep(60000); return 0; }
                if (args.Length == 1 && args[0] == "--install") { Registration.Install(); return 0; }
                if (args.Length == 1 && args[0] == "--stop") { Registration.Stop(); return 0; }
                if (args.Length == 1 && args[0] == "--uninstall") { Registration.Uninstall(); return 0; }
                if (args.Length == 3 && args[0] == "--service" && args[1] == "--owner-sid") {
                    var sid = new SecurityIdentifier(args[2]).Value;
                    ServiceBase.Run(new DesktopService(sid));
                    return 0;
                }
                Console.Error.WriteLine("Use the service installer, or --install, --stop, --uninstall, --self-test.");
                return 2;
            } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
        }

        // Windows command-line escaping; no shell is used for service commands.
        internal static string Quote(string value) {
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char character in value) {
                if (character == '\\') { slashes++; continue; }
                if (character == '"') result.Append('\\', slashes * 2 + 1);
                else result.Append('\\', slashes);
                result.Append(character); slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }
    }


    internal static class AdaptiveLaunch {
        internal static bool IsAdministrator { get { using (var identity = WindowsIdentity.GetCurrent()) return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator); } }
        private static string ProtectedRoot { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "bakame"); } }
        private static void EnsurePlainPath(string path) {
            for (var current = new DirectoryInfo(path); current != null; current = current.Parent)
                if (current.Exists && (current.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Service installation cannot use a linked directory: " + current.FullName);
        }
        private static void CopyPayload(string source, string destination) {
            EnsurePlainPath(source); EnsurePlainPath(destination);
            Directory.CreateDirectory(destination);
            var inherited = new DirectorySecurity();
            inherited.SetAccessRuleProtection(false, false);
            inherited.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
            if (!String.Equals(destination, ProtectedRoot, StringComparison.OrdinalIgnoreCase)) Directory.SetAccessControl(destination, inherited);
            foreach (string file in Directory.GetFiles(source)) {
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new IOException("Linked app files are not supported.");
                string target = Path.Combine(destination, Path.GetFileName(file));
                if (File.Exists(target) && (File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0) throw new IOException("Linked destination files are not supported.");
                File.Copy(file, target, true);
                var permissions = new FileSecurity();
                permissions.SetAccessRuleProtection(false, false);
                permissions.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
                File.SetAccessControl(target, permissions);
            }
            foreach (string folder in Directory.GetDirectories(source)) CopyPayload(folder, Path.Combine(destination, Path.GetFileName(folder)));
        }
        private static int RunHelper(string executable, string command) {
            using (var process = Process.Start(new ProcessStartInfo(executable, command) { UseShellExecute = false, CreateNoWindow = true })) {
                if (!process.WaitForExit(45000)) throw new TimeoutException("Service setup did not finish.");
                return process.ExitCode;
            }
        }
        internal static void CloseDesktop() {
            string sid = Native.SessionSid(Process.GetCurrentProcess().SessionId);
            if (String.IsNullOrEmpty(sid)) return;
            try { ControlPipe.Send(sid, "quit", 300); } catch (TimeoutException) { return; } catch (IOException) { return; }
            DateTime deadline = DateTime.UtcNow.AddSeconds(12);
            while (DateTime.UtcNow < deadline) {
                Thread.Sleep(200);
                try { ControlPipe.Send(sid, "status", 200); } catch (TimeoutException) { return; } catch (IOException) { return; }
            }
            throw new TimeoutException("Close the running Bakame app before switching startup mode.");
        }
        internal static int Run() {
            string sid = Native.SessionSid(Process.GetCurrentProcess().SessionId) ?? WindowsIdentity.GetCurrent().User.Value;
            using (var gate = new Mutex(false, @"Local\bakame-startup-" + sid)) {
                bool held = false;
                try {
                    try { held = gate.WaitOne(90000); } catch (AbandonedMutexException) { held = true; }
                    if (!held) throw new TimeoutException("Another startup is still in progress.");
                    return RunLocked();
                } finally { if (held) gate.ReleaseMutex(); }
            }
        }
        private static int RunLocked() {
            string root = ProtectedRoot;
            string installedHelper = Path.Combine(root, @"resources\service\bakame.Service.exe");
            string registered = (string)Registry.GetValue(@"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\" + Program.Name, "ImagePath", null);
            string owner = (string)Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\bakame", "OwnerSid", null);
            string sid = WindowsIdentity.GetCurrent().User.Value;
            if (!IsAdministrator) {
                // Normal launches run in this user's background process, including
                // after an administrator installation. Never request elevation.
                if (owner == sid && registered != null && File.Exists(installedHelper) && registered.StartsWith(Program.Quote(installedHelper) + " ", StringComparison.OrdinalIgnoreCase)) {
                    if (RunHelper(installedHelper, "--stop") != 0) return 1;
                }
                return 3;
            }
            if (registered != null && !registered.StartsWith(Program.Quote(installedHelper) + " ", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The existing service belongs to a different installation.");
            string sessionOwner = Native.SessionSid(Process.GetCurrentProcess().SessionId);
            if (registered != null && owner != sessionOwner) throw new UnauthorizedAccessException("The existing service belongs to a different desktop account.");
            bool inProtectedFolder = String.Equals(Path.GetDirectoryName(Program.AppExecutable), root, StringComparison.OrdinalIgnoreCase);
            if (inProtectedFolder && registered != null) {
                using (var service = new ServiceController(Program.Name)) {
                    if (service.Status == ServiceControllerStatus.Stopped) CloseDesktop();
                }
                return Registration.Launch();
            }
            if (registered != null && RunHelper(installedHelper, "--stop") != 0) return 1;
            // Let an already open background instance save its state before handoff.
            CloseDesktop();
            if (!inProtectedFolder) {
                EnsurePlainPath(root);
                Directory.CreateDirectory(root);
                // A SYSTEM service must never execute from a user-writable folder.
                var security = new DirectorySecurity();
                security.SetAccessRuleProtection(true, false);
                security.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
                var inheritance = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, inheritance, PropagationFlags.None, AccessControlType.Allow));
                Directory.SetAccessControl(root, security);
                CopyPayload(Path.GetDirectoryName(Program.AppExecutable), root);
            }
            return RunHelper(installedHelper, "--install");
        }
    }

    internal sealed class LaunchPolicy {
        private readonly Queue<DateTime> failures = new Queue<DateTime>();
        private DateTime nextStart = DateTime.MinValue;
        internal bool ShouldStop;
        internal bool CanStart(int session, DateTime now) { return !ShouldStop && session >= 0 && now >= nextStart; }
        internal void Exited(int session, uint exitCode, DateTime now) {
            if (exitCode == 0 || exitCode == 10) { ShouldStop = true; return; }
            Failed(now);
        }
        internal void Failed(DateTime now) {
            while (failures.Count > 0 && now - failures.Peek() >= TimeSpan.FromMinutes(1)) failures.Dequeue();
            failures.Enqueue(now);
            ShouldStop = failures.Count > 3;
            nextStart = now.AddSeconds(5);
        }
    }

    internal sealed class DesktopService : ServiceBase {
        private readonly string ownerSid;
        private readonly ManualResetEvent stopping = new ManualResetEvent(false);
        private Thread worker;
        internal DesktopService(string sid) {
            ownerSid = sid; ServiceName = Program.Name; CanStop = true; CanShutdown = true; AutoLog = true;
        }
        protected override void OnStart(string[] args) {
            if (!File.Exists(Program.AppExecutable)) throw new FileNotFoundException("bakame.exe is missing. Reinstall the app.");
            stopping.Reset();
            worker = new Thread(Watch) { IsBackground = true, Name = "Desktop session supervisor" };
            worker.Start();
        }
        private void Log(string message, EventLogEntryType type) {
            try { EventLog.WriteEntry(message, type); } catch { /* Logging must not interrupt supervision. */ }
        }
        private void StopAfterWorker() { ThreadPool.QueueUserWorkItem(_ => { try { Stop(); } catch (Exception error) { Log(error.Message, EventLogEntryType.Error); } }); }
        private void Watch() {
            var policy = new LaunchPolicy();
            OwnedProcess child = null;
            int childSession = -1;
            try {
                while (!stopping.WaitOne(1000)) {
                    try {
                        if (child != null) {
                            uint exitCode;
                            if (!child.TryExitCode(out exitCode)) continue;
                            policy.Exited(childSession, exitCode, DateTime.UtcNow);
                            child.Dispose(); child = null;
                            if (policy.ShouldStop) {
                                Log("Desktop app closed; stopping the service.", EventLogEntryType.Information);
                                StopAfterWorker(); return;
                            }
                            Log("Desktop app crashed; retrying in five seconds.", EventLogEntryType.Warning);
                        }
                        int session = Native.FindOwnerSession(ownerSid);
                        if (session < 0) { StopAfterWorker(); return; }
                        if (!policy.CanStart(session, DateTime.UtcNow)) continue;
                        child = OwnedProcess.Launch(Program.AppExecutable, new[] { "--bakame-service-managed=" + ownerSid }, session, ownerSid);
                        childSession = session;
                        Log("bakame started in desktop session " + session + ".", EventLogEntryType.Information);
                    } catch (Exception error) {
                        policy.Failed(DateTime.UtcNow);
                        Log("Could not start the desktop app: " + error.Message, EventLogEntryType.Error);
                        if (policy.ShouldStop) { StopAfterWorker(); return; }
                        if (stopping.WaitOne(5000)) break;
                    }
                }
            } finally {
                // The job owns only the process tree launched by this service.
                if (child != null) {
                    try { ControlPipe.Send(ownerSid, "quit", 250); } catch { }
                    child.CloseGracefully(); child.Dispose();
                }
            }
        }
        protected override void OnStop() { stopping.Set(); if (worker != null && !worker.Join(7000)) throw new TimeoutException("Desktop supervisor did not stop."); }
        protected override void OnShutdown() { OnStop(); }
    }

    internal static class Registration {
        private static string ImagePath { get { return (string)Registry.GetValue(@"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\" + Program.Name, "ImagePath", null); } }
        private static void EnsureOwned() {
            string existing = ImagePath;
            if (existing != null && !existing.StartsWith(Program.Quote(Program.Executable) + " ", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("A service with this name belongs to another installation. Remove that installation first.");
        }
        private static void Sc(params string[] arguments) {
            var info = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "sc.exe"), String.Join(" ", arguments.Select(Program.Quote))) {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            using (var process = Process.Start(info)) {
                string output = process.StandardOutput.ReadToEnd();
                string error = process.StandardError.ReadToEnd();
                if (!process.WaitForExit(30000)) { process.Kill(); throw new TimeoutException("Windows service control timed out."); }
                if (process.ExitCode != 0) throw new InvalidOperationException((output + error).Trim());
            }
        }
        internal static void Status() {
            EnsureOwned();
            if (ImagePath == null) { Console.WriteLine("NotInstalled"); return; }
            using (var service = new ServiceController(Program.Name)) Console.WriteLine(service.Status);
        }
        internal static int Launch() {
            EnsureOwned();
            if (ImagePath == null) return 3;
            string owner = (string)Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\bakame", "OwnerSid", null);
            if (owner != WindowsIdentity.GetCurrent().User.Value) throw new UnauthorizedAccessException("Start bakame from the account that installed it.");
            using (var gate = new Mutex(false, @"Local\bakame-launch-" + owner)) {
                bool held = false;
                try {
                    try { held = gate.WaitOne(25000); } catch (AbandonedMutexException) { held = true; }
                    if (!held) throw new TimeoutException("Another launch is still in progress.");
                    DateTime deadline = DateTime.UtcNow.AddSeconds(22);
                    while (DateTime.UtcNow < deadline) {
                        using (var service = new ServiceController(Program.Name)) {
                            if (service.Status == ServiceControllerStatus.StopPending) {
                                Thread.Sleep(100); continue;
                            }
                            if (service.Status == ServiceControllerStatus.Stopped) service.Start();
                            service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(10));
                        }
                        try { ControlPipe.Send(owner, "activate", 1000); return 0; }
                        catch (TimeoutException) { /* An overlapping Quit may still be closing the old session. */ }
                        catch (IOException) { /* Retry a pipe that closed during an intentional shutdown. */ }
                    }
                    throw new TimeoutException("The desktop app did not become ready. Open bakame again or repair the installation.");
                } finally { if (held) gate.ReleaseMutex(); }
            }
        }
        private static void RemoveLegacy() {
            const string legacyName = "OpenCluelyDesktopService";
            string image = (string)Registry.GetValue(@"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\" + legacyName, "ImagePath", null);
            if (image == null) return;
            string expected = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"OpenCluely\resources\service\OpenCluely.Service.exe");
            if (!image.StartsWith(Program.Quote(expected) + " ", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The legacy service belongs to an unexpected path; it was not modified.");
            using (var service = new ServiceController(legacyName)) {
                if (service.Status != ServiceControllerStatus.Stopped) {
                    if (service.Status != ServiceControllerStatus.StopPending) service.Stop();
                    service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
                }
            }
            Sc("delete", legacyName);
        }
        internal static void Install() {
            string protectedRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "bakame");
            if (!Program.Executable.StartsWith(protectedRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Install the service using bakame-Service-Setup.exe. Its executable must be protected under Program Files.");
            if (!File.Exists(Program.AppExecutable)) throw new FileNotFoundException("The desktop executable is missing.");
            EnsureOwned();
            string owner = Native.SessionSid(Process.GetCurrentProcess().SessionId);
            if (String.IsNullOrEmpty(owner)) throw new InvalidOperationException("Run setup from the desktop account that will use bakame.");
            string command = Program.Quote(Program.Executable) + " --service --owner-sid " + Program.Quote(owner);
            if (ImagePath == null) Sc("create", Program.Name, "binPath=", command, "start=", "demand", "obj=", "LocalSystem", "DisplayName=", "bakame Desktop Service");
            else { Stop(); Sc("config", Program.Name, "binPath=", command, "start=", "demand", "obj=", "LocalSystem"); }
            Sc("description", Program.Name, "Starts bakame on demand in its owner's desktop session. Quitting the app stops the service.");
            // Query config/status/dependents/security, interrogate, start and stop.
            // Standard service tools enumerate dependents before stopping. The owner
            // still cannot change the privileged command, ACL, ownership, or registration.
            Sc("sdset", Program.Name, "D:(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWRPWPLORC;;;" + owner + ")");
            using (var key = Registry.LocalMachine.CreateSubKey(@"SOFTWARE\bakame")) key.SetValue("OwnerSid", owner);
            RemoveLegacy();
            using (var service = new ServiceController(Program.Name)) { service.Start(); service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20)); }
            Console.WriteLine("bakame Desktop Service installed and running.");
        }
        internal static void Stop() {
            EnsureOwned();
            if (ImagePath == null) return;
            using (var service = new ServiceController(Program.Name)) {
                if (service.Status == ServiceControllerStatus.Stopped) return;
                if (service.Status != ServiceControllerStatus.StopPending) service.Stop();
                service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
            }
        }
        internal static void Uninstall() { Stop(); if (ImagePath != null) Sc("delete", Program.Name); }
    }

    internal static class ControlPipe {
        internal static void Send(string sid, string command, int timeout) {
            using (var pipe = new NamedPipeClientStream(".", "bakame-ui-" + sid, PipeDirection.Out)) {
                pipe.Connect(timeout);
                using (var writer = new StreamWriter(pipe, new UTF8Encoding(false))) { writer.WriteLine(command); writer.Flush(); }
            }
        }
    }

    internal sealed class OwnedProcess : IDisposable {
        private IntPtr job;
        private IntPtr process;
        internal int Id;
        internal static OwnedProcess Launch(string executable, string[] arguments, int session, string ownerSid) {
            var result = new OwnedProcess();
            IntPtr token = IntPtr.Zero, environment = IntPtr.Zero;
            var created = new Native.ProcessInformation();
            try {
                result.job = Native.CreateKillJob();
                var startup = new Native.StartupInfo();
                startup.cb = Marshal.SizeOf(startup); startup.desktop = @"winsta0\default";
                var command = new StringBuilder(Program.Quote(executable) + " " + String.Join(" ", arguments.Select(Program.Quote)));
                bool success;
                if (session < 0) { // Self-test only: use the current user without service privileges.
                    success = Native.CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000004, IntPtr.Zero, Path.GetDirectoryName(executable), ref startup, out created);
                } else {
                    Native.Check(Native.WTSQueryUserToken(session, out token));
                    using (var identity = new WindowsIdentity(token)) {
                        if (identity.User.Value != ownerSid) throw new InvalidOperationException("Desktop user changed before launch.");
                    }
                    Native.Check(Native.CreateEnvironmentBlock(out environment, token, false));
                    success = Native.CreateProcessAsUser(token, executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x00000404, environment, Path.GetDirectoryName(executable), ref startup, out created);
                }
                Native.Check(success);
                result.process = created.process; result.Id = created.processId;
                Native.Check(Native.AssignProcessToJobObject(result.job, result.process));
                if (Native.ResumeThread(created.thread) == UInt32.MaxValue) throw new Win32Exception();
                return result;
            } catch {
                if (created.process != IntPtr.Zero) Native.TerminateProcess(created.process, 1);
                result.Dispose(); throw;
            } finally {
                if (created.thread != IntPtr.Zero) Native.CloseHandle(created.thread);
                if (environment != IntPtr.Zero) Native.DestroyEnvironmentBlock(environment);
                if (token != IntPtr.Zero) Native.CloseHandle(token);
            }
        }
        internal bool TryExitCode(out uint code) { code = 0; if (Native.WaitForSingleObject(process, 0) != 0) return false; Native.Check(Native.GetExitCodeProcess(process, out code)); return true; }
        internal void CloseGracefully() {
            try { using (var app = Process.GetProcessById(Id)) { app.CloseMainWindow(); app.WaitForExit(4500); } } catch { }
        }
        public void Dispose() {
            if (job != IntPtr.Zero) { Native.CloseHandle(job); job = IntPtr.Zero; }
            if (process != IntPtr.Zero) { Native.CloseHandle(process); process = IntPtr.Zero; }
        }
    }

    internal static class Native {
        [StructLayout(LayoutKind.Sequential)] internal struct SessionInfo { internal int id; internal IntPtr station; internal int state; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct StartupInfo {
            internal int cb; internal string reserved, desktop, title;
            internal int x, y, width, height, xChars, yChars, fill, flags;
            internal short show, reservedSize; internal IntPtr reserved2, input, output, error;
        }
        [StructLayout(LayoutKind.Sequential)] internal struct ProcessInformation { internal IntPtr process, thread; internal int processId, threadId; }
        [StructLayout(LayoutKind.Sequential)] private struct BasicLimit { internal long processTime, jobTime; internal uint flags; internal UIntPtr minWorking, maxWorking; internal uint processLimit; internal UIntPtr affinity; internal uint priority, scheduling; }
        [StructLayout(LayoutKind.Sequential)] private struct IoCounters { internal ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
        [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimit { internal BasicLimit basic; internal IoCounters io; internal UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory; }
        [DllImport("wtsapi32.dll", SetLastError = true)] internal static extern bool WTSQueryUserToken(int session, out IntPtr token);
        [DllImport("wtsapi32.dll", SetLastError = true)] private static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr sessions, out int count);
        [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool WTSQuerySessionInformation(IntPtr server, int session, int info, out IntPtr buffer, out int bytes);
        [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(IntPtr memory);
        [DllImport("userenv.dll", SetLastError = true)] internal static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);
        [DllImport("userenv.dll")] internal static extern bool DestroyEnvironmentBlock(IntPtr environment);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcessAsUser(IntPtr token, string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation result);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation result);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int info, ref ExtendedLimit limits, int length);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll")] internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll")] internal static extern bool TerminateProcess(IntPtr process, uint exitCode);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CommandLineToArgvW(string command, out int count);
        [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr memory);
        internal static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
        internal static IntPtr CreateKillJob() {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception();
            var limits = new ExtendedLimit(); limits.basic.flags = 0x2000;
            if (!SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(limits))) { int error = Marshal.GetLastWin32Error(); CloseHandle(job); throw new Win32Exception(error); }
            return job;
        }
        private static string SessionString(int session, int kind) {
            IntPtr buffer; int bytes;
            if (!WTSQuerySessionInformation(IntPtr.Zero, session, kind, out buffer, out bytes)) return null;
            try { return Marshal.PtrToStringUni(buffer); } finally { WTSFreeMemory(buffer); }
        }
        internal static string SessionSid(int session) {
            string user = SessionString(session, 5), domain = SessionString(session, 7);
            if (String.IsNullOrEmpty(user)) return null;
            try { return ((SecurityIdentifier)new NTAccount(domain, user).Translate(typeof(SecurityIdentifier))).Value; } catch (IdentityNotMappedException) { return null; }
        }
        internal static int FindOwnerSession(string ownerSid) {
            IntPtr sessions; int count;
            Check(WTSEnumerateSessions(IntPtr.Zero, 0, 1, out sessions, out count));
            try {
                int size = Marshal.SizeOf(typeof(SessionInfo));
                for (int i = 0; i < count; i++) {
                    var session = (SessionInfo)Marshal.PtrToStructure(IntPtr.Add(sessions, i * size), typeof(SessionInfo));
                    if (session.state == 0 && SessionSid(session.id) == ownerSid) return session.id;
                }
                return -1;
            } finally { WTSFreeMemory(sessions); }
        }
    }

    internal static class SelfTest {
        private static void Assert(bool condition, string message) { if (!condition) throw new Exception("Self-test failed: " + message); }
        internal static void Run() {
            var policy = new LaunchPolicy(); var now = DateTime.UtcNow;
            Assert(!policy.CanStart(-1, now) && policy.CanStart(1, now), "signed-in session required");
            policy.Exited(1, 1, now); Assert(!policy.CanStart(1, now) && policy.CanStart(1, now.AddSeconds(6)), "crash restart delay");
            policy.Exited(1, 0, now); Assert(policy.ShouldStop && !policy.CanStart(1, now.AddDays(1)), "Quit stops service permanently until requested");
            policy = new LaunchPolicy(); policy.Exited(1, 10, now); Assert(policy.ShouldStop, "duplicate launch must not restart");
            policy = new LaunchPolicy(); for (int i = 0; i < 4; i++) policy.Failed(now.AddSeconds(i * 6));
            Assert(policy.ShouldStop, "crash loop is bounded");
            string[] arguments = { "C:\\Program Files\\OpenCluely\\app.exe", "", "a\\\"b", "ends\\", "two words" };
            int count; IntPtr parsed = Native.CommandLineToArgvW(String.Join(" ", arguments.Select(Program.Quote)), out count);
            try { Assert(count == arguments.Length, "argument count"); for (int i = 0; i < count; i++) Assert(Marshal.PtrToStringUni(Marshal.ReadIntPtr(parsed, i * IntPtr.Size)) == arguments[i], "command-line escaping"); } finally { Native.LocalFree(parsed); }
            string sid = WindowsIdentity.GetCurrent().User.Value;
            Assert(Native.SessionSid(Process.GetCurrentProcess().SessionId) == sid, "installer targets the desktop user's SID");
            Assert(Native.FindOwnerSession(sid) == Process.GetCurrentProcess().SessionId, "owner session selection");
            Console.WriteLine("PASS: service launch policy, account/session selection, and Windows argument escaping");
            string status = Path.Combine(Path.GetTempPath(), "opencluely-service-test-" + Guid.NewGuid().ToString("N"));
            using (var child = OwnedProcess.Launch(Program.Executable, new[] { "--job-test-child", status }, -1, null)) {
                try {
                    DateTime deadline = DateTime.UtcNow.AddSeconds(15);
                    while (!File.Exists(status) && DateTime.UtcNow < deadline) Thread.Sleep(100);
                    Assert(File.Exists(status), "test child started");
                    int grandchildId = Int32.Parse(File.ReadAllText(status));
                    using (var grandchild = Process.GetProcessById(grandchildId)) {
                        child.Dispose(); Assert(grandchild.WaitForExit(5000), "service stop kills owned descendants");
                    }
                } finally { if (File.Exists(status)) File.Delete(status); }
            }
            Console.WriteLine("PASS: actual Windows job object closes the owned process tree");
        }
    }
}
