using System.Collections.Generic;
using Microsoft.CommandPalette.Extensions;
using Microsoft.CommandPalette.Extensions.Toolkit;

namespace GlassDeskDock;

// What opens when you click the dock band, laid out like Everhour's Time view:
// the running timer with Stop, this week's and today's totals, then each day's entries.
// Selecting an entry starts the timer on that task; Ctrl+K on it offers "Open task in Workmate Desk".
internal sealed partial class TimerPage : ListPage
{
    public TimerPage()
    {
        Id = "com.glassdesk.dock.timer.page";
        Name = "Open";
        Title = "Everhour timer";
        Icon = Glyphs.Stopwatch;
        PlaceholderText = "Filter tasks";
        GlassDeskClient.Changed += () => RaiseItemsChanged();
    }

    public override IListItem[] GetItems()
    {
        var w = GlassDeskClient.WeekAsync().GetAwaiter().GetResult();
        if (w is null)
        {
            var problem = GlassDeskClient.LastProblem ?? "Workmate Desk isn't running. Start it to see your Everhour time";
            var notRunning = problem.StartsWith("Workmate Desk isn't running", System.StringComparison.Ordinal) || problem.StartsWith("Open Workmate Desk", System.StringComparison.Ordinal);
            return [
                new ListItem(new NoOpCommand()) { Title = notRunning ? "Workmate Desk isn't running" : "Couldn't load your Everhour time", Subtitle = problem, Icon = Glyphs.Warning },
                new ListItem(new OpenInGlassDeskCommand(null)) { Title = "Open Workmate Desk", Icon = Glyphs.Open },
            ];
        }

        if (!w.Everhour)
        {
            return [
                new ListItem(new NoOpCommand()) { Title = "Everhour isn't connected", Subtitle = "Connect it in Workmate Desk → Settings → Everhour", Icon = Glyphs.Warning },
                new ListItem(new OpenInGlassDeskCommand(null)) { Title = "Open Workmate Desk", Icon = Glyphs.Open },
            ];
        }

        var items = new List<IListItem>();
        var totals = $"This week {GlassDeskClient.Format(w.WeekTotal)} · Today {GlassDeskClient.Format(w.TodayTotal)}";
        if (w.Running is { } r)
        {
            items.Add(new ListItem(new OpenInGlassDeskCommand(string.IsNullOrEmpty(r.TaskGid) ? null : r.TaskGid))
            {
                Title = r.Name,
                Subtitle = $"Running {GlassDeskClient.Format(r.SessionSeconds)} · {totals}",
                Icon = Glyphs.RunningRow,
                Tags = [Badges.Running(GlassDeskClient.Format(r.SessionSeconds))],
                Section = "Tracking now",
            });
            items.Add(new ListItem(new StopTimerCommand()) { Title = "Stop timer", Subtitle = "Saves the time to Everhour", Icon = Glyphs.StopRow, Section = "Tracking now" });
        }
        else
        {
            items.Add(new ListItem(new OpenInGlassDeskCommand(null)) { Title = "No timer running", Subtitle = $"{totals} · pick a task below to start", Icon = Glyphs.Stopwatch, Section = "Tracking now" });
        }

        foreach (var day in w.Days)
        {
            var section = $"{day.Label} · {GlassDeskClient.Format(day.Total)}";

            // the day's total as its own row, so it reads clearly even where section headers are subtle
            items.Add(new ListItem(new NoOpCommand())
            {
                Title = $"{day.Label}: {GlassDeskClient.Format(day.Total)} tracked",
                Subtitle = $"{day.Entries.Count} task{(day.Entries.Count == 1 ? string.Empty : "s")}",
                Icon = Glyphs.DayRow,
                Tags = [Badges.Day(GlassDeskClient.Format(day.Total))],
                Section = section,
            });

            foreach (var e in day.Entries)
            {
                var item = new ListItem(e.Running ? new StopTimerCommand() : new StartTimerCommand(e.TaskId, e.Name))
                {
                    Title = e.Name,

                    // that task's time on that day, in the text itself (the tag repeats it on the right)
                    Subtitle = $"{GlassDeskClient.Format(e.Seconds)} on {day.Label.ToLowerInvariant() switch { "today" => "today", "yesterday" => "yesterday", _ => day.Label }}{(string.IsNullOrEmpty(e.Project) ? string.Empty : " · " + e.Project)}{(e.Running ? " · running" : string.Empty)}",
                    Icon = e.Running ? Glyphs.RunningRow : Glyphs.StartRow,
                    Tags = [e.Running ? Badges.Running(GlassDeskClient.Format(e.Seconds)) : Badges.Task(GlassDeskClient.Format(e.Seconds))],
                    Section = section,
                };
                if (!string.IsNullOrEmpty(e.TaskGid))
                {
                    item.MoreCommands = [new CommandContextItem(new OpenInGlassDeskCommand(e.TaskGid)) { Title = "Open task in Workmate Desk" }];
                }

                items.Add(item);
            }
        }

        return [.. items];
    }
}
