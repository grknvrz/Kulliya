using System.Diagnostics;

internal static class SecondScreenOnly
{
    private static void Main()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = @"C:\Windows\System32\DisplaySwitch.exe",
            Arguments = "/external",
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }
}
