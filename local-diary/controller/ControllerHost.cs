using System;
using System.IO;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Threading;
using System.Windows.Forms;

internal static class ControllerHost
{
    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            if (args.Length < 2) throw new ArgumentException("Missing controller location.");
            using (var runspace = RunspaceFactory.CreateRunspace())
            {
                runspace.ApartmentState = ApartmentState.STA;
                runspace.ThreadOptions = PSThreadOptions.UseCurrentThread;
                runspace.Open();
                using (var shell = PowerShell.Create())
                {
                    shell.Runspace = runspace;
                    shell.AddCommand(Path.GetFullPath(args[0])).AddParameter("ProjectRoot", Path.GetFullPath(args[1]));
                    if (args.Length > 2 && args[2] == "--no-browser") shell.AddParameter("NoBrowser");
                    shell.Invoke();
                    if (shell.InvocationStateInfo.State == PSInvocationState.Failed)
                        throw shell.InvocationStateInfo.Reason;
                }
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Controller", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
