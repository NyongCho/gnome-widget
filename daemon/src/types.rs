use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarContext {
    pub month: String,
    pub time_zone: String,
    pub week_start: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarEvent {
    pub uid: String,
    pub occurrence_key: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderState<T> {
    pub status: ProviderStatus,
    pub source_id: Option<String>,
    pub updated_at: Option<String>,
    pub data: Option<T>,
    pub error_code: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderStatus {
    Loading,
    Ok,
    Stale,
    Unconfigured,
    Unavailable,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderName {
    Calendar,
    Weather,
    System,
    Network,
    Media,
}
impl ProviderName {
    pub const ALL: [Self; 5] = [
        Self::Calendar,
        Self::Weather,
        Self::System,
        Self::Network,
        Self::Media,
    ];
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == value)
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Calendar => "calendar",
            Self::Weather => "weather",
            Self::System => "system",
            Self::Network => "network",
            Self::Media => "media",
        }
    }
}
macro_rules! dto {
    ($name:ident { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
    };
}
dto!(CalendarData { month: String, time_zone: String, week_start: u8, events: Vec<CalendarEvent> });
dto!(WeatherLocation {
    id: String,
    label: String,
    latitude: f64,
    longitude: f64,
    time_zone: String
});
dto!(WeatherCurrent { temperature_c: Option<f64>, code: Option<u32> });
dto!(WeatherHour { at: String, temperature_c: Option<f64>, precipitation_probability: Option<f64> });
dto!(WeatherData { location: String, time_zone: String, current: WeatherCurrent, hourly: Vec<WeatherHour>, attribution_url: String });
dto!(SystemData { cpu_percent: Option<f64>, memory_used_bytes: u64, memory_total_bytes: u64, temperature_c: Option<f64> });
dto!(NetworkSample {
    at: String,
    rx: f64,
    tx: f64
});
dto!(NetworkData { interface: String, rx_bytes_per_sec: Option<f64>, tx_bytes_per_sec: Option<f64>, history: Vec<NetworkSample> });
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Playing,
    Paused,
    Stopped,
}
dto!(MediaData { player: String, status: PlaybackStatus, title: String, artist: String, art_uri: Option<String> });
dto!(Revisions {
    calendar: u32,
    weather: u32,
    system: u32,
    network: u32,
    media: u32
});
dto!(Snapshot { schema_version: u32, generated_at: String, revisions: Revisions, calendar: ProviderState<CalendarData>, weather: ProviderState<WeatherData>, system: ProviderState<SystemData>, network: ProviderState<NetworkData>, media: ProviderState<MediaData> });
dto!(Settings { calendar_enabled: bool, calendar_secret_deletion_pending: bool, weather_location: Option<WeatherLocation>, network_interface: String });
