$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$kPickerInput = [Console]::In.ReadToEnd() | ConvertFrom-Json

# Windows' common folder dialog. Runs in its own STA process so Show does not
# block K's HTTP server. No selected path is evaluated as PowerShell code.
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class KWorkspaceDialog
{
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class FileOpenDialog { }

    // IModalWindow::Show followed by IFileDialog's native vtable order.
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr value);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem item, uint hint, out int order);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    public static string Pick(string initialPath)
    {
        SetProcessDPIAware();
        var dialog = (IFileDialog)new FileOpenDialog();
        IShellItem initial = null;
        IShellItem selected = null;
        IntPtr name = IntPtr.Zero;
        // A background HTTP process has no foreground browser owner. Give the
        // common dialog a temporary topmost owner so it cannot open behind K.
        using (var owner = new Form())
        {
        owner.ShowInTaskbar = false;
        owner.FormBorderStyle = FormBorderStyle.None;
        owner.StartPosition = FormStartPosition.CenterScreen;
        owner.Size = new System.Drawing.Size(1, 1);
        owner.Opacity = 0;
        owner.TopMost = true;
        try
        {
            uint options;
            dialog.GetOptions(out options);
            // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST |
            // FOS_NOCHANGEDIR | FOS_DONTADDTORECENT.
            dialog.SetOptions(options | 0x20 | 0x40 | 0x800 | 0x8 | 0x02000000);
            dialog.SetTitle("K \u2014 \u9078\u64c7\u5de5\u4f5c\u5340\u8cc7\u6599\u593e");
            dialog.SetOkButtonLabel("\u9078\u64c7\u8cc7\u6599\u593e");
            if (!String.IsNullOrWhiteSpace(initialPath) && Directory.Exists(initialPath))
            {
                var iid = typeof(IShellItem).GUID;
                SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref iid, out initial);
                dialog.SetFolder(initial);
            }
            owner.Show();
            owner.Activate();
            int result = dialog.Show(owner.Handle);
            if (result == unchecked((int)0x800704C7)) return null;
            Marshal.ThrowExceptionForHR(result);
            dialog.GetResult(out selected);
            selected.GetDisplayName(0x80058000, out name); // SIGDN_FILESYSPATH
            return Marshal.PtrToStringUni(name);
        }
        finally
        {
            if (name != IntPtr.Zero) Marshal.FreeCoTaskMem(name);
            if (selected != null) Marshal.ReleaseComObject(selected);
            if (initial != null) Marshal.ReleaseComObject(initial);
            Marshal.ReleaseComObject(dialog);
        }
        }
    }
}
'@

$kSelectedPath = [KWorkspaceDialog]::Pick([string]$kPickerInput.path)
if ($null -eq $kSelectedPath) {
    [Console]::Write('{"cancelled":true}')
} else {
    [Console]::Write((@{ cancelled = $false; path = $kSelectedPath } | ConvertTo-Json -Compress))
}
