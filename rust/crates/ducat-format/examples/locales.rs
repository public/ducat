//! Prints the locales this build of ducat-format has data for, one per line, and how many.
//! The binary carries every built locale's data, so its size measures the data's
//! (rust/docs/design.md, "Coverage").

fn main() {
    let mut count = 0;
    for name in ducat_format::locales() {
        let locale = ducat_format::Locale::new(name).expect("a built locale's name is a valid tag");
        println!("{}", locale.data_name());
        count += 1;
    }
    eprintln!("{count} locales (CLDR {})", ducat_format::CLDR_VERSION);
}
