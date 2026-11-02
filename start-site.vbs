' Start the Vancouver Directory site hidden, detached from any shell.
' Replaces the broken "Vancouver Directory (5050)" task for on-demand starts until that task is
' repointed (editing it needs elevation).
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\jayng\DSH\vancouver-directory"
sh.Run "cmd.exe /c ""C:\Users\jayng\DSH\vancouver-directory\run-site.cmd""", 0, False
