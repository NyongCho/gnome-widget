export const STATUS_BUS = 'io.github.NyongCho.LiquidWidgets.Status';
export const STATUS_PATH = '/io/github/NyongCho/LiquidWidgets/Status';
export const STATUS_INTERFACE = 'io.github.NyongCho.LiquidWidgets.Status1';
export const STATUS_XML = `<node>
  <interface name="io.github.NyongCho.LiquidWidgets.Status1">
    <method name="WatchCalendar">
      <arg name="token" type="s" direction="out"/>
      <arg name="summaryJson" type="s" direction="out"/>
    </method>
    <method name="UnwatchCalendar"><arg name="token" type="s" direction="in"/></method>
    <method name="RefreshCalendar"/>
    <signal name="CalendarStatusChanged"><arg name="summaryJson" type="s"/></signal>
  </interface>
</node>
`;
