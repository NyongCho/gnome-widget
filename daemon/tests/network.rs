use liquid_widgets_daemon::providers::network::{NetworkSampler, default_interface};
use std::time::Duration;
fn at(sec: u64) -> String {
    format!("2026-11-04T00:{:02}:{:02}Z", sec / 60, sec % 60)
}
#[test]
fn byte_deltas_use_elapsed_time_without_summing_interfaces() {
    let mut sampler = NetworkSampler::default();
    let first = sampler.sample("eth0", 1000, 2000, Duration::ZERO, at(0));
    assert!(first.rx_bytes_per_sec.is_none());
    assert!(first.history.is_empty());
    let second = sampler.sample("eth0", 3048, 6096, Duration::from_secs(2), at(2));
    assert_eq!(second.rx_bytes_per_sec, Some(1024.0));
    assert_eq!(second.tx_bytes_per_sec, Some(2048.0));
    let idle = sampler.sample("eth0", 3048, 6096, Duration::from_secs(4), at(4));
    assert_eq!(idle.rx_bytes_per_sec, Some(0.0));
}
#[test]
fn interface_change_resets_rate_and_history() {
    let mut sampler = NetworkSampler::default();
    sampler.sample("eth0", 0, 0, Duration::ZERO, at(0));
    sampler.sample("eth0", 100, 100, Duration::from_secs(2), at(2));
    let changed = sampler.sample("tailscale0", 500, 500, Duration::from_secs(4), at(4));
    assert!(changed.history.is_empty());
    assert!(changed.rx_bytes_per_sec.is_none());
    let reset = sampler.sample("tailscale0", 0, 0, Duration::from_secs(6), at(6));
    assert!(reset.history.is_empty());
    assert!(reset.rx_bytes_per_sec.is_none());
}
#[test]
fn history_contains_only_the_last_sixty_seconds() {
    let mut sampler = NetworkSampler::default();
    for i in 0..=32 {
        let value = sampler.sample(
            "eth0",
            i * 100,
            i * 50,
            Duration::from_secs(i * 2),
            at(i * 2),
        );
        if i == 32 {
            assert_eq!(value.history.len(), 31);
            assert_eq!(value.history[0].at, at(4));
        }
    }
}
#[test]
fn automatic_route_ignores_tailscale_and_uses_one_default_interface() {
    assert_eq!(
        default_interface(include_str!("../../tests/fixtures/network/route.txt"), ""),
        Some("enp5s0".into())
    );
    assert_eq!(default_interface("", ""), None);
}

#[test]
#[ignore = "explicit live /proc and sysfs probe; no configuration is changed"]
fn live_metrics_with_active_tailscale() {
    use liquid_widgets_daemon::{
        providers::{network::Network, system::System},
        state::ServiceState,
        types::ProviderName,
        worker::BlockingWorker,
    };
    let output = std::process::Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let vpn: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(vpn["BackendState"], "Running");
    tokio::runtime::Runtime::new().unwrap().block_on(async{
        let state=ServiceState::new();let worker=BlockingWorker::new(2);let system=System::default();let network=Network::default();
        let first=network.collect(state.begin(ProviderName::Network),"auto".into(),worker.clone()).await.unwrap();assert!(first.rx_bytes_per_sec.is_none());assert!(!first.interface.starts_with("tailscale"));
        assert!(system.collect(state.begin(ProviderName::System),worker.clone()).await.unwrap().cpu_percent.is_none());
        // Ordinary public HTTPS traffic; do not send traffic to private Tailscale peers.
        reqwest::get("https://open-meteo.com/").await.unwrap().bytes().await.unwrap();
        tokio::time::sleep(Duration::from_secs(2)).await;
        let second=network.collect(state.begin(ProviderName::Network),"auto".into(),worker.clone()).await.unwrap();
        let system=system.collect(state.begin(ProviderName::System),worker.clone()).await.unwrap();assert!(system.cpu_percent.is_some_and(|v|(0.0..=100.0).contains(&v)));assert!(system.memory_used_bytes>0);
        assert_eq!(first.interface,second.interface);assert!(second.rx_bytes_per_sec.is_some_and(|v|v>0.0));
        let explicit=network.collect(state.begin(ProviderName::Network),"tailscale0".into(),worker).await.unwrap();assert_eq!(explicit.interface,"tailscale0");assert!(explicit.rx_bytes_per_sec.is_none());assert!(explicit.history.is_empty());
        println!("LIVE_METRICS: Tailscale Running; physical={} rx={:.1} B/s tx={:.1} B/s CPU={:.1}% RAM={}/{} bytes CPU sensor={:?}; explicit tailscale0 resets",second.interface,second.rx_bytes_per_sec.unwrap(),second.tx_bytes_per_sec.unwrap(),system.cpu_percent.unwrap(),system.memory_used_bytes,system.memory_total_bytes,system.temperature_c);
    });
}
