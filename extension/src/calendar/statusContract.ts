export const STATUS_BUS='io.github.NyongCho.LiquidWidgets.Status';
export const STATUS_PATH='/io/github/NyongCho/LiquidWidgets/Status';
export const STATUS_INTERFACE='io.github.NyongCho.LiquidWidgets.Status1';
export const STATUS_XML='<node>\n  <interface name="io.github.NyongCho.LiquidWidgets.Status1">\n    <method name="WatchCalendar">\n      <arg name="token" type="s" direction="out"/>\n      <arg name="summaryJson" type="s" direction="out"/>\n    </method>\n    <method name="UnwatchCalendar"><arg name="token" type="s" direction="in"/></method>\n    <method name="RefreshCalendar"/>\n    <signal name="CalendarStatusChanged"><arg name="summaryJson" type="s"/></signal>\n  </interface>\n</node>\n';
