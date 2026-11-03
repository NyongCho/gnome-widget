use liquid_widgets_daemon::providers::system::{SystemSampler, read_temperature};
const STAT: &str = include_str!("../../tests/fixtures/system/stat-first.txt");
const NEXT: &str = include_str!("../../tests/fixtures/system/stat-next.txt");
const MEM: &str = include_str!("../../tests/fixtures/system/meminfo.txt");
#[test]
fn system_first_sample_has_no_cpu_rate() {
    let mut sampler = SystemSampler::default();
    let first = sampler.sample(STAT, MEM, None).unwrap();
    assert_eq!(first.cpu_percent, None);
    assert_eq!(first.memory_total_bytes, 1024000);
    assert_eq!(first.memory_used_bytes, 768000);
    let next = sampler.sample(NEXT, MEM, Some(38.0)).unwrap();
    assert_eq!(next.cpu_percent, Some(50.0));
    assert_eq!(next.temperature_c, Some(38.0));
    assert_eq!(sampler.sample(STAT, MEM, None).unwrap().cpu_percent, None);
}
#[test]
fn missing_sensor_is_null() {
    let root = tempfile::tempdir().unwrap();
    assert_eq!(read_temperature(root.path()), None);
    let nvme = root.path().join("hwmon0");
    std::fs::create_dir(&nvme).unwrap();
    std::fs::write(nvme.join("name"), "nvme").unwrap();
    std::fs::write(nvme.join("temp1_input"), "45000").unwrap();
    assert_eq!(read_temperature(root.path()), None);
}
#[test]
fn identified_cpu_package_temperature_is_preferred_over_core_or_storage() {
    let root = tempfile::tempdir().unwrap();
    let cpu = root.path().join("hwmon1");
    std::fs::create_dir(&cpu).unwrap();
    for (file, text) in [
        ("name", "coretemp"),
        ("temp1_label", "Package id 0"),
        ("temp1_input", "38000"),
        ("temp2_label", "Core 0"),
        ("temp2_input", "42000"),
    ] {
        std::fs::write(cpu.join(file), text).unwrap();
    }
    assert_eq!(read_temperature(root.path()), Some(38.0));
}
