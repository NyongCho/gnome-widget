use crate::{
    state::{Failure, Ticket},
    types::{NetworkData, NetworkSample},
    worker::BlockingWorker,
};
use std::{
    collections::VecDeque,
    fs,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
#[derive(Default)]
pub struct NetworkSampler {
    previous: Option<(String, u64, u64, Duration)>,
    history: VecDeque<(Duration, NetworkSample)>,
}
impl NetworkSampler {
    pub fn sample(
        &mut self,
        interface: &str,
        rx: u64,
        tx: u64,
        elapsed: Duration,
        at: String,
    ) -> NetworkData {
        let rate = self
            .previous
            .as_ref()
            .and_then(|(old_interface, old_rx, old_tx, old_time)| {
                if old_interface != interface {
                    return None;
                }
                let seconds = elapsed.checked_sub(*old_time)?.as_secs_f64();
                if seconds <= 0.0 {
                    return None;
                }
                Some((
                    rx.checked_sub(*old_rx)? as f64 / seconds,
                    tx.checked_sub(*old_tx)? as f64 / seconds,
                ))
            });
        self.previous = Some((interface.into(), rx, tx, elapsed));
        if let Some((rx, tx)) = rate {
            self.history
                .push_back((elapsed, NetworkSample { at, rx, tx }));
        } else {
            self.history.clear();
        }
        while self
            .history
            .front()
            .is_some_and(|(time, _)| elapsed.saturating_sub(*time) > Duration::from_secs(60))
            || self.history.len() > 60
        {
            self.history.pop_front();
        }
        NetworkData {
            interface: interface.into(),
            rx_bytes_per_sec: rate.map(|r| r.0),
            tx_bytes_per_sec: rate.map(|r| r.1),
            history: self
                .history
                .iter()
                .map(|(_, sample)| sample.clone())
                .collect(),
        }
    }
}
fn automatic_candidate(name: &str) -> bool {
    name != "lo" && !name.starts_with("tailscale")
}
pub fn default_interface(ipv4: &str, ipv6: &str) -> Option<String> {
    let mut candidates = Vec::new();
    for line in ipv4.lines().skip(1) {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() < 8
            || fields[1] != "00000000"
            || fields[7] != "00000000"
            || !automatic_candidate(fields[0])
        {
            continue;
        }
        if let (Ok(flags), Ok(metric)) =
            (u32::from_str_radix(fields[3], 16), fields[6].parse::<u32>())
            && flags & 1 != 0
        {
            candidates.push((metric, fields[0].to_owned()));
        }
    }
    // IPv6 fallback. Reject unreachable/reject routes and use the lowest metric once.
    if candidates.is_empty() {
        for line in ipv6.lines() {
            let f: Vec<_> = line.split_whitespace().collect();
            if f.len() != 10
                || f[0] != "00000000000000000000000000000000"
                || f[1] != "00"
                || !automatic_candidate(f[9])
            {
                continue;
            }
            if let (Ok(flags), Ok(metric)) =
                (u32::from_str_radix(f[8], 16), u32::from_str_radix(f[5], 16))
                && flags & 1 != 0
                && flags & 0x200 == 0
            {
                candidates.push((metric, f[9].to_owned()));
            }
        }
    }
    candidates.sort();
    candidates.into_iter().next().map(|(_, name)| name)
}
struct SampleState {
    ticket: Option<Ticket>,
    sampler: NetworkSampler,
    started: Instant,
}
impl Default for SampleState {
    fn default() -> Self {
        Self {
            ticket: None,
            sampler: NetworkSampler::default(),
            started: Instant::now(),
        }
    }
}
#[derive(Default)]
pub struct Network {
    state: Arc<Mutex<SampleState>>,
}
impl Network {
    pub async fn collect(
        &self,
        ticket: Ticket,
        interface: String,
        worker: BlockingWorker,
    ) -> Result<NetworkData, Failure> {
        let shared = self.state.clone();
        worker
            .run(move || {
                let mut state = shared.lock().map_err(|_| Failure::Unavailable)?;
                if state.ticket.as_ref() != Some(&ticket) {
                    state.sampler = NetworkSampler::default();
                    state.ticket = Some(ticket);
                }
                let read = || -> Result<(String, u64, u64), Failure> {
                    let name = if interface == "auto" {
                        default_interface(
                            &fs::read_to_string("/proc/net/route").unwrap_or_default(),
                            &fs::read_to_string("/proc/net/ipv6_route").unwrap_or_default(),
                        )
                        .ok_or(Failure::NoInterface)?
                    } else {
                        interface
                    };
                    // Defense in depth: this string is also checked by the settings schema.
                    if name.is_empty()
                        || name.len() > 15
                        || !name
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"_-.:".contains(&b))
                    {
                        return Err(Failure::Invalid);
                    }
                    let counter = |file: &str| {
                        fs::read_to_string(format!("/sys/class/net/{name}/statistics/{file}"))
                            .map_err(|_| Failure::NoInterface)?
                            .trim()
                            .parse::<u64>()
                            .map_err(|_| Failure::Invalid)
                    };
                    Ok((name.clone(), counter("rx_bytes")?, counter("tx_bytes")?))
                };
                let (name, rx, tx) = match read() {
                    Ok(value) => value,
                    Err(error) => {
                        state.sampler = NetworkSampler::default();
                        return Err(error);
                    }
                };
                let elapsed = state.started.elapsed();
                Ok(state
                    .sampler
                    .sample(&name, rx, tx, elapsed, crate::state::now()))
            })
            .await
            .map_err(|_| Failure::Unavailable)?
    }
}
