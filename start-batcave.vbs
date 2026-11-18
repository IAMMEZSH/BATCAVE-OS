Option Explicit
Dim fso, sh, base, nodeExe, serverJs
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
nodeExe = fso.BuildPath(base, "node.exe")
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
serverJs = fso.BuildPath(base, "server.js")
sh.Run """" & nodeExe & """ """ & serverJs & """", 0, False
