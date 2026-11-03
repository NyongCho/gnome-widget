//! Private safe wrapper: root owns all components, properties and custom zones.
//! The caller holds LIBICAL_LOCK for the entire lifetime of Root and Iterator.
use super::CalendarError;
use std::ffi::{CStr, CString, c_char, c_void};
use std::sync::Mutex;

pub(super) static LIBICAL_LOCK: Mutex<()> = Mutex::new(());
#[repr(C)]
#[derive(Default, Debug, Clone, Copy)]
pub(super) struct Time {
    pub year: i32,
    pub month: i32,
    pub day: i32,
    pub hour: i32,
    pub minute: i32,
    pub second: i32,
    pub date: i32,
    pub offset: i32,
    pub epoch: i64,
}
unsafe extern "C" {
    fn lw_duration(value: *const c_char, days: *mut i64, seconds: *mut i64) -> i32;
    fn lw_parse(input: *const c_char) -> *mut c_void;
    fn lw_free(root: *mut c_void);
    fn lw_event(root: *mut c_void, first: i32) -> *mut c_void;
    fn lw_property(event: *mut c_void, name: *const c_char, first: i32) -> *mut c_void;
    fn lw_value(property: *mut c_void) -> *const c_char;
    fn lw_parameter(property: *mut c_void, name: *const c_char) -> *const c_char;
    fn lw_time_parse(
        root: *mut c_void,
        value: *const c_char,
        tzid: *const c_char,
        out: *mut Time,
    ) -> i32;
    fn lw_time_epoch(root: *mut c_void, epoch: i64, tzid: *const c_char, out: *mut Time) -> i32;
    fn lw_recur_new(
        root: *mut c_void,
        rule: *const c_char,
        start: *const c_char,
        tzid: *const c_char,
        end_epoch: i64,
    ) -> *mut c_void;
    fn lw_recur_next(iter: *mut c_void, out: *mut Time) -> i32;
    fn lw_recur_free(iter: *mut c_void);
}
fn c(value: &str) -> Result<CString, CalendarError> {
    CString::new(value).map_err(|_| CalendarError::InvalidCalendar)
}
unsafe fn string(ptr: *const c_char) -> Result<Option<String>, CalendarError> {
    if ptr.is_null() {
        return Ok(None);
    }
    Ok(Some(
        unsafe { CStr::from_ptr(ptr) }
            .to_str()
            .map_err(|_| CalendarError::InvalidCalendar)?
            .into(),
    ))
}
pub(super) struct Root(*mut c_void);
pub(super) struct Event<'a> {
    ptr: *mut c_void,
    _root: &'a Root,
}
#[derive(Clone)]
pub(super) struct Property {
    pub value: String,
    pub tzid: Option<String>,
    pub range: Option<String>,
}
impl Root {
    pub fn parse(input: &str) -> Result<Self, CalendarError> {
        let ptr = unsafe { lw_parse(c(input)?.as_ptr()) };
        if ptr.is_null() {
            Err(CalendarError::InvalidCalendar)
        } else {
            Ok(Self(ptr))
        }
    }
    pub fn events(&self) -> Vec<Event<'_>> {
        let mut result = Vec::new();
        let mut ptr = unsafe { lw_event(self.0, 1) };
        while !ptr.is_null() {
            result.push(Event { ptr, _root: self });
            ptr = unsafe { lw_event(self.0, 0) };
        }
        result
    }
    pub fn time(&self, value: &str, zone: &str) -> Result<Time, CalendarError> {
        let mut out = Time::default();
        let code =
            unsafe { lw_time_parse(self.0, c(value)?.as_ptr(), c(zone)?.as_ptr(), &mut out) };
        match code {
            0 => Ok(out),
            2 => Err(CalendarError::UnknownTimeZone),
            _ => Err(CalendarError::InvalidCalendar),
        }
    }
    pub fn at(&self, epoch: i64, zone: &str) -> Result<Time, CalendarError> {
        let mut out = Time::default();
        let code = unsafe { lw_time_epoch(self.0, epoch, c(zone)?.as_ptr(), &mut out) };
        if code == 0 {
            Ok(out)
        } else {
            Err(CalendarError::UnknownTimeZone)
        }
    }
    pub fn recur(
        &self,
        rule: &str,
        start: &str,
        zone: &str,
        end_epoch: i64,
    ) -> Result<Recurrence<'_>, CalendarError> {
        let ptr = unsafe {
            lw_recur_new(
                self.0,
                c(rule)?.as_ptr(),
                c(start)?.as_ptr(),
                c(zone)?.as_ptr(),
                end_epoch,
            )
        };
        if ptr.is_null() {
            Err(CalendarError::InvalidCalendar)
        } else {
            Ok(Recurrence { ptr, _root: self })
        }
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        unsafe { lw_free(self.0) };
    }
}
impl Event<'_> {
    pub fn properties(&self, name: &str) -> Result<Vec<Property>, CalendarError> {
        let name = c(name)?;
        let mut result = Vec::new();
        let mut ptr = unsafe { lw_property(self.ptr, name.as_ptr(), 1) };
        while !ptr.is_null() {
            result.push(Property {
                value: unsafe { string(lw_value(ptr)) }?.ok_or(CalendarError::InvalidCalendar)?,
                tzid: unsafe { string(lw_parameter(ptr, c"TZID".as_ptr())) }?,
                range: unsafe { string(lw_parameter(ptr, c"RANGE".as_ptr())) }?,
            });
            ptr = unsafe { lw_property(self.ptr, name.as_ptr(), 0) };
        }
        Ok(result)
    }
    pub fn one(&self, name: &str) -> Result<Option<Property>, CalendarError> {
        let mut props = self.properties(name)?;
        if props.len() > 1 {
            return Err(CalendarError::UnsupportedCalendar);
        }
        Ok(props.pop())
    }
}
pub(super) struct Recurrence<'a> {
    ptr: *mut c_void,
    _root: &'a Root,
}
impl Iterator for Recurrence<'_> {
    type Item = Option<Time>;
    fn next(&mut self) -> Option<Self::Item> {
        let mut out = Time::default();
        match unsafe { lw_recur_next(self.ptr, &mut out) } {
            0 => None,
            1 => Some(Some(out)),
            _ => Some(None),
        }
    }
}
impl Drop for Recurrence<'_> {
    fn drop(&mut self) {
        unsafe { lw_recur_free(self.ptr) };
    }
}

pub(super) fn duration(value: &str) -> Result<(i64, i64), CalendarError> {
    let (mut days, mut seconds) = (0, 0);
    if unsafe { lw_duration(c(value)?.as_ptr(), &mut days, &mut seconds) } == 0 {
        Ok((days, seconds))
    } else {
        Err(CalendarError::InvalidCalendar)
    }
}
