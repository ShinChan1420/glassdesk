using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.CommandPalette.Extensions.Toolkit;

namespace GlassDeskDock;

// The live dock button: time tracked today on the running task, with the task name.
// Polls Workmate Desk every 15 s (Workmate Desk itself caches Everhour for 10 s), and right after a stop.
internal sealed partial class TimerBand : ListItem, IDisposable
{
    private readonly Timer _timer;
    private int _busy;

    public TimerBand(TimerPage page)
        : base(page)
    {
        Title = "Everhour";
        Icon = Glyphs.Stopwatch;
        GlassDeskClient.Changed += Kick;
        // reads Workmate Desk's shared timer state (no Everhour call), so polling often is cheap
        _timer = new Timer(_ => Kick(), null, TimeSpan.Zero, TimeSpan.FromSeconds(10));
    }

    private void Kick() => _ = RefreshAsync();

    private async Task RefreshAsync()
    {
        if (Interlocked.Exchange(ref _busy, 1) == 1)
        {
            return;
        }

        try
        {
            var s = await GlassDeskClient.StatusAsync().ConfigureAwait(false);
            var (title, subtitle) = !s.GlassDesk ? (s.Problem?.StartsWith("Workmate Desk couldn't", StringComparison.Ordinal) == true ? "Everhour error" : "Workmate Desk off", string.Empty)
                : !s.Everhour ? ("Everhour not connected", string.Empty)
                : !s.Running ? ("No timer", string.Empty)
                : ($"{GlassDeskClient.Format(s.TodaySeconds)} · {Short(s.TaskName)}", string.Empty);

            // only touch the properties when they change, so the dock isn't redrawn for nothing
            if (Title != title)
            {
                Title = title;
            }

            if (Subtitle != subtitle)
            {
                Subtitle = subtitle;
            }
        }
        finally
        {
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    // keep the band short enough to read in the compact Dock
    private static string Short(string? name)
    {
        var n = (name ?? "Timer").Trim();
        return n.Length <= 24 ? n : n[..23].TrimEnd(' ', '-', '·') + "…";
    }

    public void Dispose()
    {
        GlassDeskClient.Changed -= Kick;
        _timer.Dispose();
    }
}
