use crate::{
    state::{Failure, Ticket},
    types::SystemData,
    worker::BlockingWorker,
};
use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
#[derive(Default)]
pub struct SystemSampler {
    previous: Option<(u64, u64)>,
}
impl SystemSampler {
    pub fn sample(
        &mut self,
        stat: &str,
        mem: &str,
        temperature: Option<f64>,
    ) -> Result<SystemData, Failure> {
        let fields = stat
            .lines()
            .find(|line| line.starts_with("cpu "))
            .ok_or(Failure::Invalid)?
            .split_whitespace()
            .skip(1)
            .take(8)
            .map(str::parse::<u64>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| Failure::Invalid)?;
        if fields.len() < 4 {
            return Err(Failure::Invalid);
        }
        // Guest ticks are already included in user/nice; only the first eight fields count.
        let total = fields
            .iter()
            .try_fold(0_u64, |sum, value| sum.checked_add(*value))
            .ok_or(Failure::Invalid)?;
        let idle = fields[3]
            .checked_add(*fields.get(4).unwrap_or(&0))
            .ok_or(Failure::Invalid)?;
        let cpu_percent = self.previous.and_then(|(old_total, old_idle)| {
            let elapsed = total.checked_sub(old_total)?;
            let idle_delta = idle.checked_sub(old_idle)?;
            (elapsed > 0 && idle_delta <= elapsed)
                .then(|| 100.0 * (elapsed - idle_delta) as f64 / elapsed as f64)
        });
        self.previous = Some((total, idle));
        let bytes = |key: &str| -> Result<u64, Failure> {
            let mut fields = mem
                .lines()
                .find(|line| line.starts_with(key))
                .ok_or(Failure::Invalid)?
                .split_whitespace();
            fields.next();
            let value = fields
                .next()
                .ok_or(Failure::Invalid)?
                .parse::<u64>()
                .map_err(|_| Failure::Invalid)?;
            if fields.next() != Some("kB") {
                return Err(Failure::Invalid);
            }
            value.checked_mul(1024).ok_or(Failure::Invalid)
        };
        let memory_total_bytes = bytes("MemTotal:")?;
        let available = bytes("MemAvailable:")?;
        if memory_total_bytes == 0 {
            return Err(Failure::Invalid);
        }
        Ok(SystemData {
            cpu_percent,
            memory_used_bytes: memory_total_bytes
                .checked_sub(available)
                .ok_or(Failure::Invalid)?,
            memory_total_bytes,
            temperature_c: temperature,
        })
    }
}
pub fn read_temperature(hwmon: &Path) -> Option<f64> {
    let mut sensors = Vec::new();
    for entry in fs::read_dir(hwmon).ok()?.flatten() {
        let dir = entry.path();
        let name = fs::read_to_string(dir.join("name")).unwrap_or_default();
        if !matches!(name.trim(), "coretemp" | "k10temp") {
            continue;
        }
        let Ok(files) = fs::read_dir(&dir) else {
            continue;
        };
        for file in files.flatten() {
            let name_file = file.file_name();
            let name_file = name_file.to_string_lossy();
            let Some(prefix) = name_file
                .strip_suffix("_label")
                .filter(|s| s.starts_with("temp"))
            else {
                continue;
            };
            let label = fs::read_to_string(file.path()).unwrap_or_default();
            let priority = match (name.trim(), label.trim()) {
                ("coretemp", label) if label.starts_with("Package id ") => 0,
                ("coretemp", label) if label.starts_with("Core ") => 2,
                ("k10temp", "Tdie") => 0,
                ("k10temp", "Tctl") => 1,
                _ => continue,
            };
            let value = fs::read_to_string(dir.join(format!("{prefix}_input")))
                .ok()
                .and_then(|s| s.trim().parse::<f64>().ok())
                .map(|v| v / 1000.0);
            if let Some(value) = value.filter(|v| v.is_finite() && (-40.0..=150.0).contains(v)) {
                sensors.push((priority, value));
            }
        }
    }
    let best = sensors.iter().map(|v| v.0).min()?;
    sensors
        .into_iter()
        .filter(|v| v.0 == best)
        .map(|v| v.1)
        .reduce(f64::max)
}
#[derive(Default)]
struct SampleState {
    ticket: Option<Ticket>,
    sampler: SystemSampler,
    temperature: Option<f64>,
    temperature_at: Option<Instant>,
}
#[derive(Default)]
pub struct System {
    state: Arc<Mutex<SampleState>>,
}
impl System {
    pub async fn collect(
        &self,
        ticket: Ticket,
        worker: BlockingWorker,
    ) -> Result<SystemData, Failure> {
        let shared = self.state.clone();
        worker
            .run(move || {
                let mut state = shared.lock().map_err(|_| Failure::Unavailable)?;
                if state.ticket.as_ref() != Some(&ticket) {
                    state.sampler = SystemSampler::default();
                    state.ticket = Some(ticket);
                }
                if state
                    .temperature_at
                    .is_none_or(|at| at.elapsed() >= Duration::from_secs(5))
                {
                    state.temperature = read_temperature(Path::new("/sys/class/hwmon"));
                    state.temperature_at = Some(Instant::now());
                }
                let stat = fs::read_to_string("/proc/stat").map_err(|_| Failure::Unavailable)?;
                let mem = fs::read_to_string("/proc/meminfo").map_err(|_| Failure::Unavailable)?;
                let temperature = state.temperature;
                state.sampler.sample(&stat, &mem, temperature)
            })
            .await
            .map_err(|_| Failure::Unavailable)?
    }
}
