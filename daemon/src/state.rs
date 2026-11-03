//! Provider-local revisions and generation fences. No provider error text crosses IPC.
use crate::{
    types::ProviderName,
    validation::{MAX_PAYLOAD_BYTES, parse_snapshot, validate_provider_state},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, time::SystemTime};
#[derive(Clone, Debug)]
pub struct Ticket {
    pub provider: ProviderName,
    pub source_id: String,
    generation: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Network,
    Unavailable,
    Invalid,
    TooLarge,
    Keyring,
    Auth,
    Unsupported,
    ExpansionLimit,
    TimeZone,
    RateLimited,
}
impl Failure {
    fn code(self) -> &'static str {
        match self {
            Self::Network => "NETWORK_ERROR",
            Self::Unavailable => "SERVICE_UNAVAILABLE",
            Self::Invalid => "INVALID_DATA",
            Self::TooLarge => "PAYLOAD_TOO_LARGE",
            Self::Keyring => "KEYRING_LOCKED",
            Self::Auth => "AUTH_ERROR",
            Self::Unsupported => "UNSUPPORTED_CALENDAR",
            Self::ExpansionLimit => "EXPANSION_LIMIT",
            Self::TimeZone => "UNKNOWN_TIME_ZONE",
            Self::RateLimited => "RATE_LIMITED",
        }
    }
}
#[derive(Debug, thiserror::Error)]
#[error("invalid service state")]
pub struct StateError;
struct Slot {
    value: Value,
    source: String,
    generation: u64,
    revision: u32,
}
pub struct ServiceState {
    slots: BTreeMap<ProviderName, Slot>,
}
pub fn now() -> String {
    chrono::DateTime::<chrono::Utc>::from(SystemTime::now())
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
impl Default for ServiceState {
    fn default() -> Self {
        Self::new()
    }
}
impl ServiceState {
    pub fn new() -> Self {
        Self {
            slots: ProviderName::ALL
                .into_iter()
                .map(|name| {
                    let source = uuid::Uuid::new_v4().to_string();
                    let enabled = !matches!(name, ProviderName::Calendar | ProviderName::Weather);
                    (
                        name,
                        Slot {
                            value: empty(&source, enabled),
                            source,
                            generation: 0,
                            revision: 0,
                        },
                    )
                })
                .collect(),
        }
    }
    pub fn begin(&self, provider: ProviderName) -> Ticket {
        let s = &self.slots[&provider];
        Ticket {
            provider,
            source_id: s.source.clone(),
            generation: s.generation,
        }
    }
    pub fn is_current(&self, ticket: &Ticket) -> bool {
        let s = &self.slots[&ticket.provider];
        s.source == ticket.source_id && s.generation == ticket.generation
    }
    pub fn change_source(&mut self, name: ProviderName, enabled: bool) {
        self.set_source(name, uuid::Uuid::new_v4().to_string(), enabled);
    }
    pub fn set_source(&mut self, name: ProviderName, source: String, enabled: bool) {
        let s = self.slots.get_mut(&name).unwrap();
        s.source = source;
        s.generation += 1;
        s.value = empty(&s.source, enabled);
    }
    pub fn invalidate_jobs(&mut self, name: ProviderName) {
        self.slots.get_mut(&name).unwrap().generation += 1;
    }
    pub fn bump(&mut self, name: ProviderName) -> Result<u32, StateError> {
        let s = self.slots.get_mut(&name).unwrap();
        s.revision = s.revision.checked_add(1).ok_or(StateError)?;
        Ok(s.revision)
    }
    pub fn revision(&self, name: ProviderName) -> u32 {
        self.slots[&name].revision
    }
    pub fn provider(&self, name: ProviderName) -> &Value {
        &self.slots[&name].value
    }
    pub fn snapshot_json(&self) -> Result<String, StateError> {
        let mut v = json!({"schemaVersion":1,"generatedAt":now(),"revisions":{}});
        for (name, s) in &self.slots {
            v[name.as_str()] = s.value.clone();
            v["revisions"][name.as_str()] = json!(s.revision);
        }
        let raw = v.to_string();
        parse_snapshot(&raw).map_err(|_| StateError)?;
        Ok(raw)
    }
    pub fn finish(
        &mut self,
        job: &Ticket,
        result: Result<Value, Failure>,
    ) -> Result<bool, StateError> {
        self.finish_report(job, result, None, None)
    }
    pub fn finish_report(
        &mut self,
        job: &Ticket,
        result: Result<Value, Failure>,
        updated_at: Option<String>,
        stale: Option<Failure>,
    ) -> Result<bool, StateError> {
        if !self.is_current(job) {
            return Ok(false);
        }
        let old = self.provider(job.provider).clone();
        let mut value = match result {
            Ok(data) => {
                json!({"status":if stale.is_some(){"stale"}else{"ok"},"sourceId":job.source_id,"updatedAt":updated_at.unwrap_or_else(now),"data":data,"errorCode":stale.map(Failure::code)})
            }
            Err(error) => failed(&old, error, true),
        };
        let raw = value.to_string();
        if raw.len() > MAX_PAYLOAD_BYTES {
            value = failed(&old, Failure::TooLarge, true);
        } else if validate_provider_state(job.provider, &raw).is_err() {
            value = failed(&old, Failure::Invalid, true);
        }
        self.slots.get_mut(&job.provider).unwrap().value = value;
        // The aggregate budget matters even when each individual provider fits.
        if self.snapshot_json().is_err() {
            self.slots.get_mut(&job.provider).unwrap().value =
                failed(&old, Failure::TooLarge, true);
            // The stale/error metadata can itself push an exactly-full snapshot
            // over the budget. Clear only if preserving the old data cannot fit.
            if self.snapshot_json().is_err() {
                self.slots.get_mut(&job.provider).unwrap().value =
                    failed(&old, Failure::TooLarge, false);
            }
        }
        self.snapshot_json()?;
        self.bump(job.provider)?;
        Ok(true)
    }
    pub fn restore(&mut self, name: ProviderName, value: Value) -> bool {
        if value["sourceId"] != self.slots[&name].source
            || value["data"].is_null()
            || validate_provider_state(name, &value.to_string()).is_err()
        {
            return false;
        }
        let stale = failed(&value, Failure::Unavailable, true);
        let old = std::mem::replace(&mut self.slots.get_mut(&name).unwrap().value, stale);
        if self.snapshot_json().is_err() {
            self.slots.get_mut(&name).unwrap().value = old;
            return false;
        }
        true
    }
}
fn empty(source: &str, enabled: bool) -> Value {
    json!({"status":if enabled{"unavailable"}else{"unconfigured"},"sourceId":source,"updatedAt":null,"data":null,"errorCode":if enabled{Some("SERVICE_UNAVAILABLE")}else{None}})
}
fn failed(old: &Value, error: Failure, preserve: bool) -> Value {
    let keep = preserve && !old["data"].is_null();
    json!({"status":if keep{"stale"}else{"unavailable"},"sourceId":old["sourceId"],"updatedAt":if keep{old["updatedAt"].clone()}else{Value::Null},"data":if keep{old["data"].clone()}else{Value::Null},"errorCode":error.code()})
}
