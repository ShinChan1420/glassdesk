// Talks to the Workmate Desk app running on this PC (its local, key-protected server).
// Port and key come from Workmate Desk's own config file, so there is nothing to set up here.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace GlassDeskDock;

internal sealed record RunningTimer(string TaskGid, string Name, long SessionSeconds);

internal sealed record Entry(string TaskId, string TaskGid, string Name, string Project, long Seconds, bool Running);

internal sealed record Day(string Label, long Total, List<Entry> Entries);

internal sealed record Week(bool Everhour, RunningTimer? Running, long TodayTotal, long WeekTotal, List<Day> Days);

internal sealed record TimerStatus(bool GlassDesk, bool Everhour, bool Running, string? TaskGid, string? TaskName, long TodaySeconds, string? Problem);

internal static class GlassDeskClient
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(5) };

    // Fired after a stop/start so the band and the panel refresh straight away.
    public static event Action? Changed;

    public static void RaiseChanged() => Changed?.Invoke();

    private static (int Port, string Token)? ReadConfig()
    {
        // Packaged apps get a private copy of AppData, so Workmate Desk also writes the port and key
        // to %USERPROFILE%\.workmate-desk\dock.json, outside AppData. Read that first.
        var dockFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".workmate-desk", "dock.json");
        if (File.Exists(dockFile))
        {
            using var dock = JsonDocument.Parse(File.ReadAllText(dockFile));
            if (dock.RootElement.TryGetProperty("port", out var p) && p.ValueKind == JsonValueKind.Number
                && dock.RootElement.TryGetProperty("token", out var k) && k.ValueKind == JsonValueKind.String)
            {
                return (p.GetInt32(), k.GetString()!);
            }
        }

        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "glassdesk", "config.json");
        if (!File.Exists(path))
        {
            return null;
        }

        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        if (!doc.RootElement.TryGetProperty("mcp", out var mcp)
            || !mcp.TryGetProperty("port", out var port) || port.ValueKind != JsonValueKind.Number
            || !mcp.TryGetProperty("token", out var token) || token.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return (port.GetInt32(), token.GetString()!);
    }

    // What went wrong on the last call, shown in the panel ("isn't running" vs an Everhour error).
    public static string? LastProblem { get; private set; }

    // Workmate Desk serves on the first free port from 47823. If the saved port doesn't answer
    // (it moved, or the file is stale), find it on the others and remember it.
    private const int FirstPort = 47823, LastPort = 47842;
    private static int? _foundPort;

    private static async Task<HttpResponseMessage> SendAsync(int port, string token, HttpMethod method, string path, string? json)
    {
        using var req = new HttpRequestMessage(method, $"http://127.0.0.1:{port}{path}");
        req.Headers.Add("Authorization", $"Bearer {token}");
        if (json is not null)
        {
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        return await Http.SendAsync(req).ConfigureAwait(false);
    }

    private static async Task<JsonDocument?> CallAsync(HttpMethod method, string path, string? json = null)
    {
        var cfg = ReadConfig();
        if (cfg is null)
        {
            LastProblem = "Open Workmate Desk once to set it up";
            return null;
        }

        var token = cfg.Value.Token;
        var tried = new HashSet<int>();
        HttpResponseMessage? res = null;
        foreach (var port in new[] { _foundPort ?? cfg.Value.Port, cfg.Value.Port }.Concat(Enumerable.Range(FirstPort, LastPort - FirstPort + 1)))
        {
            if (!tried.Add(port))
            {
                continue;
            }

            try
            {
                var r = await SendAsync(port, token, method, path, json).ConfigureAwait(false);
                if (r.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    r.Dispose(); // something else on this port, or another copy with a different key
                    continue;
                }

                _foundPort = port;
                res = r;
                break;
            }
            catch (HttpRequestException)
            {
                // nothing listening here: try the next port (refused connections fail instantly)
            }
        }

        if (res is null)
        {
            LastProblem = "Workmate Desk isn't running. Start it to see your Everhour time";
            throw new HttpRequestException(LastProblem);
        }

        using (res)
        {
            var body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (res.IsSuccessStatusCode)
            {
                LastProblem = null;
                return JsonDocument.Parse(body);
            }

            // Workmate Desk is running but the request failed (e.g. Everhour unreachable): say so
            string? msg = null;
            try { using var e = JsonDocument.Parse(body); msg = e.RootElement.TryGetProperty("error", out var m) ? m.GetString() : null; } catch (JsonException) { }
            LastProblem = $"Workmate Desk couldn't load Everhour: {msg ?? res.ReasonPhrase}";
            throw new HttpRequestException(LastProblem);
        }
    }

    public static async Task<TimerStatus> StatusAsync()
    {
        try
        {
            using var doc = await CallAsync(HttpMethod.Get, "/dock/status").ConfigureAwait(false);
            if (doc is null)
            {
                return new(false, false, false, null, null, 0, "Open Workmate Desk once to set it up");
            }

            var r = doc.RootElement;
            var running = r.TryGetProperty("running", out var run) && run.GetBoolean();
            var everhour = r.TryGetProperty("everhour", out var eh) && eh.GetBoolean();
            string? gid = null, name = null;
            if (running && r.TryGetProperty("task", out var task) && task.ValueKind == JsonValueKind.Object)
            {
                gid = task.GetProperty("gid").GetString();
                name = task.GetProperty("name").GetString();
            }

            var today = r.TryGetProperty("today", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt64() : 0;
            return new(true, everhour, running, gid, name, today, null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException or JsonException)
        {
            return new(false, false, false, null, null, 0, LastProblem ?? "Start Workmate Desk to see your Everhour timer");
        }
    }

    public static async Task<bool> StopAsync()
    {
        try
        {
            using var _ = await CallAsync(HttpMethod.Post, "/dock/stop", "{}").ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            return false;
        }
        finally
        {
            RaiseChanged();
        }
    }

    public static async Task<bool> OpenAsync(string? taskGid)
    {
        try
        {
            var json = string.IsNullOrEmpty(taskGid) ? "{}" : $"{{\"task\":{JsonSerializer.Serialize(taskGid, GlassDeskJson.Default.String)}}}";
            using var _ = await CallAsync(HttpMethod.Post, "/dock/open", json).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            return false;
        }
    }

    // This week's time, grouped by day, like Everhour's Time list
    public static async Task<Week?> WeekAsync()
    {
        try
        {
            using var doc = await CallAsync(HttpMethod.Get, "/dock/week").ConfigureAwait(false);
            if (doc is null)
            {
                return null;
            }

            var r = doc.RootElement;
            if (!r.GetProperty("everhour").GetBoolean())
            {
                return new Week(false, null, 0, 0, []);
            }

            RunningTimer? running = null;
            if (r.TryGetProperty("running", out var run) && run.ValueKind == JsonValueKind.Object)
            {
                running = new(run.GetProperty("gid").GetString() ?? string.Empty, run.GetProperty("name").GetString() ?? "Timer", run.GetProperty("session").GetInt64());
            }

            var days = new List<Day>();
            foreach (var d in r.GetProperty("days").EnumerateArray())
            {
                var entries = new List<Entry>();
                foreach (var e in d.GetProperty("entries").EnumerateArray())
                {
                    entries.Add(new(e.GetProperty("taskId").GetString() ?? string.Empty, e.GetProperty("gid").GetString() ?? string.Empty,
                        e.GetProperty("name").GetString() ?? string.Empty, e.GetProperty("project").GetString() ?? string.Empty,
                        e.GetProperty("seconds").GetInt64(), e.GetProperty("running").GetBoolean()));
                }

                days.Add(new(d.GetProperty("label").GetString() ?? string.Empty, d.GetProperty("total").GetInt64(), entries));
            }

            return new Week(true, running, r.GetProperty("todayTotal").GetInt64(), r.GetProperty("weekTotal").GetInt64(), days);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException or JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return null;
        }
    }

    public static async Task<bool> StartAsync(string everhourTaskId)
    {
        try
        {
            var json = $"{{\"taskId\":{JsonSerializer.Serialize(everhourTaskId, GlassDeskJson.Default.String)}}}";
            using var _ = await CallAsync(HttpMethod.Post, "/dock/start", json).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            return false;
        }
        finally
        {
            RaiseChanged();
        }
    }

    // "1h 05m" / "22m", same as Workmate Desk
    public static string Format(long seconds) =>
        seconds >= 3600 ? $"{seconds / 3600}h {seconds % 3600 / 60:00}m" : $"{seconds / 60}m";
}
