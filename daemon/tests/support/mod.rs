use liquid_widgets_daemon::types::CalendarContext;

pub fn seoul_november() -> CalendarContext {
    CalendarContext {
        month: "2026-11".into(),
        time_zone: "Asia/Seoul".into(),
        week_start: 1,
    }
}
