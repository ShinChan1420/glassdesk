using Microsoft.CommandPalette.Extensions;
using Microsoft.CommandPalette.Extensions.Toolkit;

namespace GlassDeskDock;

internal static class Glyphs
{
    public static readonly IconInfo Stopwatch = new("");
    public static readonly IconInfo Stop = new("");
    public static readonly IconInfo Open = new("");
    public static readonly IconInfo Warning = new("");
    public static readonly IconInfo Play = new("");
    public static readonly IconInfo Calendar = new("");

    // coloured icons so row types read apart at a glance (font glyphs are tinted one colour)
    public static readonly IconInfo DayRow = IconHelpers.FromRelativePath("Assets\\Dock\\day.png");
    public static readonly IconInfo RunningRow = IconHelpers.FromRelativePath("Assets\\Dock\\running.png");
    public static readonly IconInfo StopRow = IconHelpers.FromRelativePath("Assets\\Dock\\stop.png");
    public static readonly IconInfo StartRow = IconHelpers.FromRelativePath("Assets\\Dock\\start.png");
}

internal static class Badges
{
    private static Tag Make(string text, byte r, byte g, byte b) => new(text) { Background = ColorHelpers.FromRgb(r, g, b), Foreground = ColorHelpers.FromRgb(255, 255, 255) };

    public static Tag Day(string text) => Make(text, 10, 132, 255);       // blue: a day's total

    public static Tag Running(string text) => Make(text, 48, 209, 88);    // green: tracking now

    public static Tag Task(string text) => new(text);                     // plain: a task's time
}

// Stops the running Everhour timer through GlassDesk; the time is saved to Everhour.
internal sealed partial class StopTimerCommand : InvokableCommand
{
    public StopTimerCommand()
    {
        Id = "com.glassdesk.dock.stop";
        Name = "Stop timer";
        Icon = Glyphs.Stop;
    }

    public override ICommandResult Invoke()
    {
        var ok = GlassDeskClient.StopAsync().GetAwaiter().GetResult();
        return CommandResult.ShowToast(ok ? "Timer stopped. Time saved to Everhour." : "Couldn't stop the timer. Is Workmate Desk running?");
    }
}

// Starts (or switches) the Everhour timer to a task, like the ▶ button in Everhour's list.
internal sealed partial class StartTimerCommand : InvokableCommand
{
    private readonly string _taskId;
    private readonly string _name;

    public StartTimerCommand(string everhourTaskId, string name)
    {
        _taskId = everhourTaskId;
        _name = name;
        Id = "com.glassdesk.dock.start." + everhourTaskId;
        Name = "Start timer";
        Icon = Glyphs.Play;
    }

    public override ICommandResult Invoke()
    {
        var ok = GlassDeskClient.StartAsync(_taskId).GetAwaiter().GetResult();
        return CommandResult.ShowToast(ok ? $"Tracking {_name}" : "Couldn't start the timer. Is Workmate Desk running?");
    }
}

// Brings Workmate Desk to the front, showing the task (or just the app when there's no task).
internal sealed partial class OpenInGlassDeskCommand : InvokableCommand
{
    private readonly string? _taskGid;

    public OpenInGlassDeskCommand(string? taskGid)
    {
        _taskGid = taskGid;
        Id = "com.glassdesk.dock.open" + (string.IsNullOrEmpty(taskGid) ? string.Empty : "." + taskGid);
        Name = string.IsNullOrEmpty(taskGid) ? "Open Workmate Desk" : "Open task";
        Icon = Glyphs.Open;
    }

    public override ICommandResult Invoke()
    {
        var ok = GlassDeskClient.OpenAsync(_taskGid).GetAwaiter().GetResult();
        return ok ? CommandResult.Dismiss() : CommandResult.ShowToast("Workmate Desk isn't running.");
    }
}
