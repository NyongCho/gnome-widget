fn main() {
    let lib = pkg_config::Config::new()
        .atleast_version("3.0.20")
        .probe("libical")
        .expect("libical >= 3.0.20 headers required (Ubuntu: libical-dev)");
    cc::Build::new()
        .file("native/calendar.c")
        .includes(lib.include_paths)
        .warnings(true)
        .compile("calendar_bridge");
    println!("cargo:rerun-if-changed=native/calendar.c");
}
