// Copyright (c) Microsoft Corporation
// The Microsoft Corporation licenses this file to you under the MIT license.
// See the LICENSE file in the project root for more information.

using Microsoft.CommandPalette.Extensions;
using Microsoft.CommandPalette.Extensions.Toolkit;

namespace GlassDeskDock;

public partial class GlassDeskDockCommandsProvider : CommandProvider
{
    private readonly ICommandItem[] _commands;
    private readonly ICommandItem _timerBand;

    public GlassDeskDockCommandsProvider()
    {
        DisplayName = "Workmate Desk";
        Id = "com.glassdesk.dock";
        Icon = IconHelpers.FromRelativePath("Assets\\StoreLogo.png");

        var page = new TimerPage();
        _commands = [
            new CommandItem(page) { Title = "Everhour timer", Subtitle = "See and stop your Workmate Desk timer" },
            new CommandItem(new StopTimerCommand()) { Title = "Stop Everhour timer", Subtitle = "Workmate Desk" },
        ];

        // Pin it from Command Palette → Settings → Dock → Bands → "Everhour timer"
        _timerBand = new WrappedDockItem([new TimerBand(page)], "com.glassdesk.dock.timer", "Everhour timer");
    }

    public override ICommandItem[] TopLevelCommands() => _commands;

    public override ICommandItem[]? GetDockBands() => [_timerBand];
}
