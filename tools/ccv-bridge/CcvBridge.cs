using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Threading;

internal static class CcvBridge
{
    sealed class Waiter
    {
        internal readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
        internal bool Success;
        internal string Error = "";
        public void OnMessage<T>(object sender, T response)
        {
            if (response == null) return;
            Type type = response.GetType();
            string kind = Convert.ToString(type.GetField("Type").GetValue(response));
            string message = Convert.ToString(type.GetField("Message").GetValue(response));
            Console.Error.WriteLine(kind + " " + message);
            if (kind == "COMPLETED" || kind == "COMPLETED_WITH_QUESTION") { Success = true; Done.Set(); }
            else if (kind == "ERROR" || kind == "TIMED_OUT") { Error = String.IsNullOrWhiteSpace(message) ? kind : message; Done.Set(); }
        }
    }

    static Type FindType(Assembly assembly, string name)
    {
        Type found = assembly.GetType("Samba.Modules.VerifoneCCVPaymentController." + name, false);
        if (found == null) found = assembly.GetTypes().FirstOrDefault(type => type.Name == name);
        if (found == null) throw new InvalidOperationException("CCV-type ontbreekt: " + name);
        return found;
    }

    static int Main(string[] args)
    {
        try
        {
            if (args.Length < 4 || args[0] != "pay") throw new ArgumentException("Gebruik: CcvBridge.exe pay <ip> <port> <bedrag>");
            IPAddress address; int port; decimal amount;
            if (!IPAddress.TryParse(args[1], out address)) throw new ArgumentException("Ongeldig CCV IP-adres.");
            if (!Int32.TryParse(args[2], out port) || port < 1 || port > 65535) throw new ArgumentException("Ongeldige CCV-poort.");
            if (!Decimal.TryParse(args[3], System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out amount) || amount <= 0) throw new ArgumentException("Ongeldig bedrag.");
            string modules = Environment.GetEnvironmentVariable("CCV_CONTROLLER_DIR");
            if (String.IsNullOrWhiteSpace(modules)) modules = @"C:\Program Files (x86)\SambaPOS5\PaymentController";
            string opi = Path.Combine(modules, "Ccv.OpiCom.dll"), controllerFile = Path.Combine(modules, "Samba.Modules.VerifoneCCVPaymentController.dll");
            if (!File.Exists(opi) || !File.Exists(controllerFile)) throw new FileNotFoundException("CCV OPI-modules niet gevonden in " + modules);
            Assembly.LoadFrom(opi); Assembly assembly = Assembly.LoadFrom(controllerFile);
            Type controllerType = FindType(assembly, "TerminalController"), responseType = FindType(assembly, "PosManagerResponse");
            object controller = controllerType.GetProperty("Instance", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic).GetValue(null, null);
            var waiter = new Waiter(); MethodInfo handlerMethod = typeof(Waiter).GetMethod("OnMessage").MakeGenericMethod(responseType); EventInfo eventInfo = controllerType.GetEvent("MessageCame"); Delegate handler = Delegate.CreateDelegate(eventInfo.EventHandlerType, waiter, handlerMethod); eventInfo.AddEventHandler(controller, handler);
            try
            {
                PropertyInfo initialized = controllerType.GetProperty("IsInitialized", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (initialized == null || !Convert.ToBoolean(initialized.GetValue(controller, null))) controllerType.GetMethod("Initialize").Invoke(controller, new object[] { address.ToString(), port, "MoskeeApp", "Bedankt" });
                Type cardType = Assembly.LoadFrom(opi).GetType("Ccv.OpiCom.Opi.CardRequestType", true);
                controllerType.GetMethod("StartTransaction").Invoke(controller, new object[] { amount, Enum.Parse(cardType, "CardPayment") });
                var inputThread = new Thread(delegate() { try { if (Console.ReadLine() == "cancel") controllerType.GetMethod("AbortTransaction").Invoke(controller, null); } catch { } }); inputThread.IsBackground = true; inputThread.Start();
                if (!waiter.Done.Wait(TimeSpan.FromMinutes(5))) throw new TimeoutException("Geen definitieve reactie van de CCV-terminal ontvangen.");
                if (!waiter.Success) throw new InvalidOperationException(waiter.Error);
                Console.WriteLine("{\"success\":true}"); return 0;
            }
            finally { eventInfo.RemoveEventHandler(controller, handler); }
        }
        catch (Exception error)
        {
            Exception actual = error is TargetInvocationException && error.InnerException != null ? error.InnerException : error;
            Console.WriteLine("{\"success\":false,\"error\":\"" + actual.Message.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}"); return 1;
        }
    }
}
