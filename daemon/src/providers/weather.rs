use crate::{
    http::Fetcher,
    state::Failure,
    types::{WeatherCurrent, WeatherData, WeatherHour, WeatherLocation},
    validation,
};
use serde_json::Value;
use std::sync::Arc;
const MAX_BYTES: usize = 256 * 1024;
pub struct Weather {
    pub fetcher: Arc<dyn Fetcher>,
}
fn document(bytes: &[u8]) -> Result<Value, Failure> {
    if bytes.len() > MAX_BYTES {
        return Err(Failure::TooLarge);
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| Failure::Invalid)?;
    if !value.is_object() || value["error"] == true {
        return Err(Failure::Invalid);
    }
    Ok(value)
}
pub fn parse_locations(bytes: &[u8]) -> Result<Vec<WeatherLocation>, Failure> {
    let value = document(bytes)?;
    let Some(rows) = value.get("results") else {
        return Ok(vec![]);
    };
    let rows = rows.as_array().ok_or(Failure::Invalid)?;
    let mut result = Vec::new();
    for row in rows.iter().take(20) {
        let (Some(id), Some(name), Some(latitude), Some(longitude), Some(time_zone)) = (
            row["id"].as_u64(),
            row["name"].as_str(),
            row["latitude"].as_f64(),
            row["longitude"].as_f64(),
            row["timezone"].as_str(),
        ) else {
            continue;
        };
        let mut labels = vec![name];
        for key in ["admin1", "country"] {
            if let Some(label) = row[key].as_str().filter(|s| !s.is_empty())
                && !labels.contains(&label)
            {
                labels.push(label);
            }
        }
        let location = WeatherLocation {
            id: id.to_string(),
            label: labels.join(" · "),
            latitude,
            longitude,
            time_zone: time_zone.into(),
        };
        if validation::parse_weather_location(
            &serde_json::to_string(&location).map_err(|_| Failure::Invalid)?,
        )
        .is_ok()
        {
            result.push(location);
        }
    }
    Ok(result)
}
pub fn parse_forecast(
    bytes: &[u8],
    location: &WeatherLocation,
    now: i64,
) -> Result<WeatherData, Failure> {
    let value = document(bytes)?;
    let hourly = &value["hourly"];
    let times = hourly["time"]
        .as_array()
        .filter(|v| v.len() <= 168)
        .ok_or(Failure::Invalid)?;
    let mut samples = Vec::new();
    for (index, time) in times.iter().enumerate() {
        let epoch = time.as_i64().ok_or(Failure::Invalid)?;
        if epoch < now {
            continue;
        }
        let time = chrono::DateTime::from_timestamp(epoch, 0).ok_or(Failure::Invalid)?;
        samples.push(WeatherHour {
            at: time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            temperature_c: hourly["temperature_2m"][index].as_f64(),
            precipitation_probability: hourly["precipitation_probability"][index]
                .as_f64()
                .filter(|v| (0.0..=100.0).contains(v)),
        });
    }
    samples.sort_by(|a, b| a.at.cmp(&b.at));
    samples.dedup_by(|a, b| a.at == b.at);
    samples.truncate(6);
    Ok(WeatherData {
        location: location.label.clone(),
        time_zone: location.time_zone.clone(),
        current: WeatherCurrent {
            temperature_c: value["current"]["temperature_2m"].as_f64(),
            code: value["current"]["weather_code"]
                .as_u64()
                .filter(|code| *code <= 99)
                .map(|code| code as u32),
        },
        hourly: samples,
        attribution_url: "https://open-meteo.com/".into(),
    })
}
impl Weather {
    pub async fn search(&self, query: &str) -> Result<Vec<WeatherLocation>, Failure> {
        let query = query.trim();
        if !(2..=100).contains(&query.chars().count()) {
            return Err(Failure::Invalid);
        }
        let mut url = reqwest::Url::parse("https://geocoding-api.open-meteo.com/v1/search")
            .map_err(|_| Failure::Unavailable)?;
        url.query_pairs_mut().extend_pairs([
            ("name", query),
            ("count", "10"),
            ("language", "ko"),
            ("format", "json"),
        ]);
        parse_locations(&self.fetcher.get(url, MAX_BYTES).await?)
    }
    pub async fn collect(
        &self,
        location: &WeatherLocation,
        now: i64,
    ) -> Result<WeatherData, Failure> {
        let mut url = reqwest::Url::parse("https://api.open-meteo.com/v1/forecast")
            .map_err(|_| Failure::Unavailable)?;
        url.query_pairs_mut().extend_pairs([
            ("latitude", location.latitude.to_string()),
            ("longitude", location.longitude.to_string()),
            ("timezone", location.time_zone.clone()),
            ("timeformat", "unixtime".into()),
            ("forecast_hours", "7".into()),
            ("temperature_unit", "celsius".into()),
            ("current", "temperature_2m,weather_code".into()),
            ("hourly", "temperature_2m,precipitation_probability".into()),
        ]);
        parse_forecast(&self.fetcher.get(url, MAX_BYTES).await?, location, now)
    }
}
