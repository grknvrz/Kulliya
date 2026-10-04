using System.Diagnostics;

internal static class ExtendDisplay
{
    private static void Main()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = @"C:\Windows\System32\DisplaySwitch.exe",
            Arguments = "/extend",
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }
}
