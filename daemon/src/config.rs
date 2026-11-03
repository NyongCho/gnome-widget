use crate::{
    cache::{CacheKey, PrivateStore},
    types::{CalendarContext, ProviderName, Settings},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub settings: Settings,
    pub context: Option<CalendarContext>,
    pub sources: BTreeMap<ProviderName, String>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            settings: Settings {
                calendar_enabled: false,
                calendar_secret_deletion_pending: false,
                weather_location: None,
                network_interface: "auto".into(),
            },
            context: None,
            sources: ProviderName::ALL
                .into_iter()
                .map(|p| (p, uuid::Uuid::new_v4().to_string()))
                .collect(),
        }
    }
}
impl Config {
    pub fn load(store: &PrivateStore) -> io::Result<Self> {
        let value = match store.read(&CacheKey::settings())? {
            Some(bytes) => toml::from_str::<Self>(
                std::str::from_utf8(&bytes).map_err(|_| io::Error::other("invalid settings"))?,
            )
            .map_err(|_| io::Error::other("invalid settings"))?,
            None => {
                let config = Self::default();
                config.save(store)?;
                config
            }
        };
        crate::validation::parse_settings(&serde_json::to_string(&value.settings)?)
            .map_err(|_| io::Error::other("invalid settings"))?;
        if let Some(context) = &value.context {
            crate::validation::parse_calendar_context(&serde_json::to_string(context)?)
                .map_err(|_| io::Error::other("invalid context"))?;
        }
        for provider in ProviderName::ALL {
            let source = value
                .sources
                .get(&provider)
                .ok_or_else(|| io::Error::other("missing source"))?;
            CacheKey::new(provider, source)?;
        }
        Ok(value)
    }
    pub fn save(&self, store: &PrivateStore) -> io::Result<()> {
        store.write(
            &CacheKey::settings(),
            toml::to_string(self)
                .map_err(|_| io::Error::other("invalid settings"))?
                .as_bytes(),
        )
    }
    pub fn enabled(&self, name: ProviderName) -> bool {
        match name {
            ProviderName::Calendar => self.settings.calendar_enabled,
            ProviderName::Weather => self.settings.weather_location.is_some(),
            _ => true,
        }
    }
    pub fn context_key(&self, name: ProviderName) -> String {
        if name == ProviderName::Calendar {
            serde_json::to_string(&self.context).expect("context JSON")
        } else {
            String::new()
        }
    }
}
