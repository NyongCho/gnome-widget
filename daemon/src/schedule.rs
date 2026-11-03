use crate::types::ProviderName;
pub fn poll_seconds(name: ProviderName, failures: u32, rate_limited: bool) -> u64 {
    match name {
        ProviderName::Weather if rate_limited || failures == 0 => 900,
        ProviderName::Weather => 30_u64
            .saturating_mul(2_u64.pow(failures.saturating_sub(1).min(5)))
            .min(900),
        ProviderName::Calendar => 300,
        ProviderName::System | ProviderName::Network => 2,
        ProviderName::Media if failures == 0 => 0, // collector awaits MPRIS events
        ProviderName::Media => 5,
    }
}
