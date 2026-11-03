/* Keep libical's version-dependent structs behind opaque pointers. All borrowed
 * pointers are owned by the calendar root; Rust serializes calls to libical. */
#include <libical/ical.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    int32_t year, month, day, hour, minute, second, date, offset;
    int64_t epoch;
} lw_time;

void *lw_parse(const char *input) {
    icalerror_set_errors_are_fatal(0);
    icalerror_clear_errno();
    icalcomponent *root = icalparser_parse_string(input);
    if (!root) return NULL;
    if (icalcomponent_isa(root) != ICAL_VCALENDAR_COMPONENT || icalcomponent_count_errors(root)) {
        icalcomponent_free(root);
        return NULL;
    }
    return root;
}
void lw_free(void *root) { icalcomponent_free(root); }
void *lw_event(void *root, int first) {
    return first ? icalcomponent_get_first_component(root, ICAL_VEVENT_COMPONENT)
                 : icalcomponent_get_next_component(root, ICAL_VEVENT_COMPONENT);
}
void *lw_property(void *event, const char *name, int first) {
    icalproperty_kind kind = icalproperty_string_to_kind(name);
    return first ? icalcomponent_get_first_property(event, kind)
                 : icalcomponent_get_next_property(event, kind);
}
const char *lw_value(void *property) {
    if (icalproperty_isa(property) == ICAL_SUMMARY_PROPERTY) return icalproperty_get_summary(property);
    return icalproperty_get_value_as_string(property);
}
const char *lw_parameter(void *property, const char *name) {
    return icalproperty_get_parameter_as_string(property, name);
}
static icaltimezone *zone(void *root, const char *name) {
    if (!strcmp(name, "UTC") || !strcmp(name, "Etc/UTC")) return icaltimezone_get_utc_timezone();
    icaltimezone *tz = icalcomponent_get_timezone(root, name);
    return tz ? tz : icaltimezone_get_builtin_timezone(name);
}
static int read_time(void *root, const char *value, const char *tzid, struct icaltimetype *t) {
    *t = icaltime_from_string(value);
    if (icaltime_is_null_time(*t) || !icaltime_is_valid_time(*t)) return 1;
    if (!icaltime_is_utc(*t)) {
        t->zone = zone(root, tzid);
        if (!t->zone) return 2;
    }
    return 0;
}
static int same_wall(struct icaltimetype a, struct icaltimetype b) {
    return a.year == b.year && a.month == b.month && a.day == b.day &&
           a.hour == b.hour && a.minute == b.minute && a.second == b.second;
}
/* RFC 5545: ambiguous local time selects the first occurrence. If the time
 * does not exist, the offset before the gap applies to an explicit DTSTART. */
static time_t local_epoch(struct icaltimetype t) {
    t.is_daylight = 0;
    time_t standard = icaltime_as_timet_with_zone(t, t.zone);
    t.is_daylight = 1;
    time_t daylight = icaltime_as_timet_with_zone(t, t.zone);
    int valid_standard = same_wall(t, icaltime_from_timet_with_zone(standard, t.is_date, t.zone));
    int valid_daylight = same_wall(t, icaltime_from_timet_with_zone(daylight, t.is_date, t.zone));
    if (valid_standard && valid_daylight) return standard < daylight ? standard : daylight;
    if (valid_daylight) return daylight;
    return standard;
}
static void export_epoch(time_t epoch, int date, const icaltimezone *tz, lw_time *out) {
    struct icaltimetype t = icaltime_from_timet_with_zone(epoch, date, tz);
    struct icaltimetype utc = icaltime_from_timet_with_zone(epoch, 0, icaltimezone_get_utc_timezone());
    int daylight = 0;
    out->year = t.year; out->month = t.month; out->day = t.day;
    out->hour = t.hour; out->minute = t.minute; out->second = t.second;
    out->date = date;
    out->offset = icaltimezone_get_utc_offset_of_utc_time((icaltimezone *)tz, &utc, &daylight);
    out->epoch = (int64_t)epoch;
}
static void export_time(struct icaltimetype t, lw_time *out) {
    export_epoch(local_epoch(t), t.is_date, t.zone, out);
}
int lw_time_parse(void *root, const char *value, const char *tzid, lw_time *out) {
    struct icaltimetype t;
    int result = read_time(root, value, tzid, &t);
    if (!result) export_time(t, out);
    return result;
}
int lw_time_epoch(void *root, int64_t epoch, const char *tzid, lw_time *out) {
    icaltimezone *tz = zone(root, tzid);
    if (!tz) return 2;
    export_epoch((time_t)epoch, 0, tz, out);
    return 0;
}
typedef struct {
    icalrecur_iterator *iter;
    const icaltimezone *tz;
    int count, emitted, has_until;
    time_t until;
} lw_recurrence;
void *lw_recur_new(void *root, const char *rule, const char *start, const char *tzid, int64_t end_epoch) {
    struct icaltimetype t;
    if (read_time(root, start, tzid, &t)) return NULL;
    struct icalrecurrencetype r = icalrecurrencetype_from_string(rule);
    lw_recurrence *state = calloc(1, sizeof(*state));
    if (!state) { icalrecurrencetype_clear(&r); return NULL; }
    state->tz = t.zone;
    state->count = r.count;
    state->has_until = !icaltime_is_null_time(r.until);
    if (state->has_until) {
        if (!r.until.zone) r.until.zone = t.zone;
        state->until = local_epoch(r.until);
    }
    // Iterate wall-clock fields, then resolve each candidate. Zoned libical 3
    // iteration shifts a nonexistent 02:30 to 03:30 and consumes COUNT.
    t.zone = NULL;
    r.count = 0;
    r.until = icaltime_from_timet_with_zone((time_t)end_epoch, t.is_date, state->tz);
    r.until.zone = NULL;
    state->iter = icalrecur_iterator_new(r, t);
    icalrecurrencetype_clear(&r);
    if (!state->iter) { free(state); return NULL; }
    return state;
}
int lw_recur_next(void *ptr, lw_time *out) {
    lw_recurrence *state = ptr;
    if (state->count && state->emitted >= state->count) return 0;
    struct icaltimetype t = icalrecur_iterator_next(state->iter);
    if (icaltime_is_null_time(t)) return 0;
    t.zone = state->tz;
    time_t epoch = local_epoch(t);
    if (state->has_until && epoch > state->until) return 0;
    if (!same_wall(t, icaltime_from_timet_with_zone(epoch, t.is_date, t.zone))) return 2;
    state->emitted++;
    export_epoch(epoch, t.is_date, t.zone, out);
    return 1;
}
void lw_recur_free(void *ptr) {
    lw_recurrence *state = ptr;
    icalrecur_iterator_free(state->iter);
    free(state);
}
int lw_duration(const char *value, int64_t *days, int64_t *seconds) {
    struct icaldurationtype d = icaldurationtype_from_string(value);
    if (value[0] != 'P' || d.is_neg || icaldurationtype_is_bad_duration(d)) return 1;
    *days = (int64_t)d.weeks * 7 + d.days;
    *seconds = (int64_t)d.hours * 3600 + (int64_t)d.minutes * 60 + d.seconds;
    return 0;
}
