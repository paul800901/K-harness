using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.Serialization;
using System.Windows.Forms;
internal static class ForceProbe {
 static void Set(object target,string field,object value){typeof(KLauncherContext).GetField(field,BindingFlags.Instance|BindingFlags.NonPublic).SetValue(target,value);}
 [STAThread] static void Main(string[] args){
  Application.EnableVisualStyles();
  var folder=args[0];Directory.CreateDirectory(folder);
  var child=Process.Start(new ProcessStartInfo(@"C:\Program Files\nodejs\node.exe","\""+Path.Combine(folder,"reject-supervisor.mjs")+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true});
  var context=(KLauncherContext)FormatterServices.GetUninitializedObject(typeof(KLauncherContext));
  Set(context,"root",folder);Set(context,"logPath",Path.Combine(folder,"launcher.log"));Set(context,"supervisorSync",new object());Set(context,"supervisor",child);
  var onOutput=typeof(KLauncherContext).GetMethod("OnSupervisorOutput",BindingFlags.Instance|BindingFlags.NonPublic);
  child.OutputDataReceived+=(sender,e)=>onOutput.Invoke(context,new object[]{sender,e});child.BeginOutputReadLine();
  File.WriteAllText(Path.Combine(folder,"supervisor.pid"),child.Id.ToString());
  var stop=typeof(KLauncherContext).GetMethod("StopK",BindingFlags.Instance|BindingFlags.NonPublic,null,new Type[]{typeof(bool)},null);
  var first=(bool)stop.Invoke(context,new object[]{false});
  File.WriteAllText(Path.Combine(folder,"no-result.txt"),"stop="+first+" alive="+(!child.HasExited));
  if(args.Length>1&&args[1]=="before")return;
  var second=(bool)stop.Invoke(context,new object[]{false});
  child.WaitForExit(5000);File.WriteAllText(Path.Combine(folder,"yes-result.txt"),"stop="+second+" exited="+child.HasExited);
 }
}
