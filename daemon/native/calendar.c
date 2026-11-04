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

/* Libical drops empty optional TEXT fields and records X-LIC-ERROR warnings.
 * Google feeds can also carry these historical warnings from imported events.
 * Only these exact, harmless diagnostic prefixes are ignored; event dates, recurrence,
 * timezone and other parsing errors remain fatal. Missing SUMMARY uses the
 * existing untitled-event fallback. Never expose the warning's raw contents. */
static int empty_text_warning(const char *message) {
    static const char *allowed[] = {
        "No value for DESCRIPTION property. Removing entire property",
        "No value for LOCATION property. Removing entire property",
        "No value for SUMMARY property. Removing entire property"
    };
    if (!message) return 0;
    for (size_t i = 0; i < sizeof(allowed) / sizeof(allowed[0]); i++) {
        size_t length = strlen(allowed[i]);
        /* Libical appends ':' followed by optional parser context. Imported
         * warnings may omit the suffix. Do not accept other message variants. */
        if (!strncmp(message, allowed[i], length) &&
            (message[length] == '\0' || message[length] == ':')) return 1;
    }
    return 0;
}
static void discard_empty_text_warnings(icalcomponent *component) {
    icalproperty *property = icalcomponent_get_first_property(component, ICAL_XLICERROR_PROPERTY);
    while (property) {
        icalproperty *next = icalcomponent_get_next_property(component, ICAL_XLICERROR_PROPERTY);
        const char *message = icalproperty_get_xlicerror(property);
        if (empty_text_warning(message)) {
            icalcomponent_remove_property(component, property);
            icalproperty_free(property);
        }
        property = next;
    }
    for (icalcomponent *child = icalcomponent_get_first_component(component, ICAL_ANY_COMPONENT);
         child; child = icalcomponent_get_next_component(component, ICAL_ANY_COMPONENT)) {
        discard_empty_text_warnings(child);
    }
}

void *lw_parse(const char *input) {
    icalerror_set_errors_are_fatal(0);
    icalerror_clear_errno();
    icalcomponent *root = icalparser_parse_string(input);
    if (!root) return NULL;
    discard_empty_text_warnings(root);
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
typedef struct { int *values; size_t count, capacity; } lw_offsets;
static int offset_add(lw_offsets *set, int value) {
    if (set->count == set->capacity) {
        size_t capacity = set->capacity ? set->capacity * 2 : 8;
        int *values = realloc(set->values, capacity * sizeof(*values));
        if (!values) return 1;
        set->values = values; set->capacity = capacity;
    }
    set->values[set->count++] = value;
    return 0;
}
static int compare_offset(const void *a, const void *b) {
    int left = *(const int *)a, right = *(const int *)b;
    return (left > right) - (left < right);
}
static int offsets_read(const icaltimezone *tz, lw_offsets *set) {
    if (tz == icaltimezone_get_utc_timezone()) return offset_add(set, 0);
    icalcomponent *component = icaltimezone_get_component((icaltimezone *)tz);
    if (!component) return 1;
    for (icalcomponent *part = icalcomponent_get_first_component(component, ICAL_ANY_COMPONENT);
         part; part = icalcomponent_get_next_component(component, ICAL_ANY_COMPONENT)) {
        icalproperty *from = icalcomponent_get_first_property(part, ICAL_TZOFFSETFROM_PROPERTY);
        icalproperty *to = icalcomponent_get_first_property(part, ICAL_TZOFFSETTO_PROPERTY);
        if (from && offset_add(set, icalproperty_get_tzoffsetfrom(from))) return 1;
        if (to && offset_add(set, icalproperty_get_tzoffsetto(to))) return 1;
    }
    if (!set->count) return 1;
    qsort(set->values, set->count, sizeof(*set->values), compare_offset);
    size_t unique = 1;
    for (size_t i = 1; i < set->count; i++) {
        if (set->values[i] != set->values[unique - 1]) set->values[unique++] = set->values[i];
    }
    set->count = unique;
    return 0;
}
static int offset_at(time_t epoch, const icaltimezone *tz) {
    struct icaltimetype utc = icaltime_from_timet_with_zone(epoch, 0, icaltimezone_get_utc_timezone());
    int daylight = 0;
    return icaltimezone_get_utc_offset_of_utc_time((icaltimezone *)tz, &utc, &daylight);
}
/* Resolve using all offsets declared by the zone, not only DST flags: political
 * STANDARD->STANDARD transitions also create folds. In a fold take the earliest
 * valid instant. In a gap use the offset demonstrably in force before the jump. */
static int local_epoch(struct icaltimetype t, const lw_offsets *offsets, time_t *result) {
    struct icaltimetype wall = t;
    wall.is_date = 0;
    wall.zone = icaltimezone_get_utc_timezone();
    time_t nominal = icaltime_as_timet_with_zone(wall, wall.zone);
    int found = 0;
    for (size_t i = 0; i < offsets->count; i++) {
        time_t candidate = nominal - offsets->values[i];
        if (same_wall(t, icaltime_from_timet_with_zone(candidate, 0, t.zone))) {
            if (!found || candidate < *result) *result = candidate;
            found = 1;
        }
    }
    if (found) return 0;
    for (size_t i = 0; i < offsets->count; i++) {
        int before = offsets->values[i];
        time_t candidate = nominal - before;
        int after = offset_at(candidate, t.zone);
        if (after > before && offset_at(nominal - after, t.zone) == before) {
            *result = candidate;
            return 0;
        }
    }
    return 1;
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
static void export_resolved(struct icaltimetype original, time_t epoch, lw_time *out) {
    export_epoch(epoch, original.is_date, original.zone, out);
    // DATE is a civil date, even if that zone's midnight never existed.
    if (original.is_date) {
        out->year = original.year; out->month = original.month; out->day = original.day;
    }
}
static int export_time(struct icaltimetype t, lw_time *out) {
    lw_offsets offsets = {0};
    time_t epoch = 0;
    int error = offsets_read(t.zone, &offsets) || local_epoch(t, &offsets, &epoch);
    free(offsets.values);
    if (!error) export_resolved(t, epoch, out);
    return error;
}
int lw_time_parse(void *root, const char *value, const char *tzid, lw_time *out) {
    struct icaltimetype t;
    int result = read_time(root, value, tzid, &t);
    if (!result) result = export_time(t, out);
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
    lw_offsets offsets;
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
    if (offsets_read(t.zone, &state->offsets)) {
        free(state->offsets.values); free(state); icalrecurrencetype_clear(&r); return NULL;
    }
    time_t first = 0;
    if (local_epoch(t, &state->offsets, &first)) {
        free(state->offsets.values); free(state); icalrecurrencetype_clear(&r); return NULL;
    }
    // Rust includes explicit DTSTART separately. A nonexistent timed DTSTART
    // still consumes the first COUNT, unlike subsequent invalid candidates.
    if (!t.is_date && !same_wall(t, icaltime_from_timet_with_zone(first, 0, t.zone))) state->emitted = 1;
    state->has_until = !icaltime_is_null_time(r.until);
    if (state->has_until) {
        if (!r.until.zone) r.until.zone = t.zone;
        lw_time until;
        if (export_time(r.until, &until)) {
            free(state->offsets.values); free(state); icalrecurrencetype_clear(&r); return NULL;
        }
        state->until = (time_t)until.epoch;
    }
    // Iterate wall-clock fields, then resolve each candidate. Zoned libical 3
    // iteration shifts a nonexistent 02:30 to 03:30 and consumes COUNT.
    t.zone = NULL;
    r.count = 0;
    r.until = icaltime_from_timet_with_zone((time_t)end_epoch, t.is_date, state->tz);
    r.until.zone = NULL;
    state->iter = icalrecur_iterator_new(r, t);
    icalrecurrencetype_clear(&r);
    if (!state->iter) { free(state->offsets.values); free(state); return NULL; }
    return state;
}
int lw_recur_next(void *ptr, lw_time *out) {
    lw_recurrence *state = ptr;
    if (state->count && state->emitted >= state->count) return 0;
    struct icaltimetype t = icalrecur_iterator_next(state->iter);
    if (icaltime_is_null_time(t)) return 0;
    t.zone = state->tz;
    time_t epoch = 0;
    if (local_epoch(t, &state->offsets, &epoch)) return -1;
    if (state->has_until && epoch > state->until) return 0;
    if (!t.is_date && !same_wall(t, icaltime_from_timet_with_zone(epoch, 0, t.zone))) return 2;
    state->emitted++;
    export_resolved(t, epoch, out);
    return 1;
}
void lw_recur_free(void *ptr) {
    lw_recurrence *state = ptr;
    icalrecur_iterator_free(state->iter);
    free(state->offsets.values);
    free(state);
}
int lw_duration(const char *value, int64_t *days, int64_t *seconds) {
    struct icaldurationtype d = icaldurationtype_from_string(value);
    if (value[0] != 'P' || d.is_neg || icaldurationtype_is_bad_duration(d)) return 1;
    *days = (int64_t)d.weeks * 7 + d.days;
    *seconds = (int64_t)d.hours * 3600 + (int64_t)d.minutes * 60 + d.seconds;
    return 0;
}
