//! Locale tags (BCP 47) and their data: the tag is checked as `Intl` checks it, then resolved by
//! TR35's fallback, dropping subtags from the end down to root (`und`); its `-u-nu-` keyword
//! picks the numbering system.

use alloc::string::String;

use ducat::territories::{TerritoryOptions, territory_currencies};

use crate::Error;
use crate::data;
use crate::icu;
use crate::tables::{CurrencyData, LocaleData, Numbers};

/// The longest tag taken, in bytes: a structurally valid tag is far shorter.
const MAX_TAG: usize = 256;

/// A locale resolved against the built data. Make one with [`Locale::new`] and reuse it: the
/// lookups are done once.
#[derive(Clone, Copy, Debug)]
pub struct Locale {
    data: &'static LocaleData,
    /// The number data of its numbering system (`-u-nu-`, else the default).
    numbers: &'static Numbers,
    /// That numbering system's digits.
    digits: &'static [char; 10],
    /// That numbering system's name.
    system: &'static str,
    has_data: bool,
    /// The tag's region (or the resolved locale's), ASCII, for its currency.
    region: [u8; 3],
}

/// How a tag is matched to the locales of the build: `Intl`'s `localeMatcher`.
///
/// Both give the same locale. ECMA-402 lets `"best fit"` be `"lookup"`, and V8 (Node 24, ICU
/// 78.3) makes it so: for every locale of CLDR's snapshot, alone, with an unknown region and
/// with extensions, Node resolves both to the same locale (`scripts/check-locale-matcher.mjs`).
/// Its `"lookup"` is ECMA-402's `LookupMatcher` over ICU's locales, which include the aliases
/// (`zh-TW`, `sr-ME`) whose data is a script's (`zh-Hant-TW`, `sr-Latn-ME`): the resolution
/// [`Locale::new`] does, CLDR's likely script, then dropping subtags from the end.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum LocaleMatcher {
    /// `'best fit'`, `Intl`'s default.
    #[default]
    BestFit,
    /// `'lookup'`: RFC 4647's lookup, as ECMA-402's `LookupMatcher` does it.
    Lookup,
}

impl core::str::FromStr for LocaleMatcher {
    type Err = Error;

    /// `Intl`'s names, `"best fit"` and `"lookup"`; [`Error::InvalidOptions`] (its `RangeError`)
    /// for another.
    fn from_str(name: &str) -> Result<Self, Error> {
        match name {
            "best fit" => Ok(Self::BestFit),
            "lookup" => Ok(Self::Lookup),
            _ => Err(Error::InvalidOptions),
        }
    }
}

/// The type of the first `-u-` extension's `nu` keyword, lowercase (`"arab"`; `""` for a key
/// without one), in a tag [`subtags`] has checked. Private use (`-x-u-nu-…`) isn't an extension.
fn unicode_nu(tag: &str) -> Option<String> {
    let mut in_unicode = false;
    let mut seen_unicode = false;
    let mut found: Option<String> = None;
    let mut collecting = false;
    for part in tag.split('-').skip(1) {
        if part.len() == 1 {
            if part.eq_ignore_ascii_case("x") {
                break;
            }
            in_unicode = part.eq_ignore_ascii_case("u") && !seen_unicode;
            seen_unicode |= in_unicode;
            collecting = false;
            continue;
        }
        if !in_unicode {
            continue;
        }
        if part.len() == 2 {
            // the first nu keyword counts (UTS #35 drops the later duplicates)
            collecting = found.is_none() && part.eq_ignore_ascii_case("nu");
            if collecting {
                found = Some(String::new());
            }
        } else if collecting {
            if let Some(value) = found.as_mut() {
                if !value.is_empty() {
                    value.push('-');
                }
                value.push_str(&part.to_ascii_lowercase());
            }
        }
    }
    found
}

/// A tag's language, script, region and variants, case-normalised; extensions are dropped.
struct Subtags<'a> {
    language: &'a str,
    script: Option<&'a str>,
    region: Option<&'a str>,
    variants: &'a str,
}

fn is_alpha(text: &str) -> bool {
    text.bytes().all(|byte| byte.is_ascii_alphabetic())
}

fn is_alphanumeric(text: &str) -> bool {
    text.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

/// Splits a Unicode BCP 47 locale identifier (UTS #35's `unicode_locale_id`, as `Intl` takes it):
/// language, then an optional script, region and variants, then extensions and private use, which
/// are checked and ignored here.
fn subtags(tag: &str) -> Option<Subtags<'_>> {
    if tag.is_empty() || tag.len() > MAX_TAG {
        return None;
    }
    let mut parts = tag.split('-').peekable();
    let language = parts.next()?;
    if !(is_alpha(language) && matches!(language.len(), 2 | 3 | 5..=8)) {
        return None;
    }
    let mut script = None;
    let mut region = None;
    let mut variants_start = None;
    let mut variants_end = 0;
    let mut offset = language.len();
    while let Some(&part) = parts.peek() {
        let start = offset + 1;
        let is_script = part.len() == 4 && is_alpha(part);
        let is_region = (part.len() == 2 && is_alpha(part))
            || (part.len() == 3 && part.bytes().all(|byte| byte.is_ascii_digit()));
        let is_variant = is_alphanumeric(part)
            && ((5..=8).contains(&part.len())
                || (part.len() == 4 && part.as_bytes()[0].is_ascii_digit()));
        if script.is_none() && region.is_none() && variants_start.is_none() && is_script {
            script = Some(part);
        } else if region.is_none() && variants_start.is_none() && is_region {
            region = Some(part);
        } else if is_variant {
            variants_start.get_or_insert(start);
            variants_end = start + part.len();
        } else {
            break;
        }
        offset = start + part.len();
        parts.next();
    }
    // extensions (a singleton and subtags of 2 to 8) and private use (x and subtags of 1 to 8)
    while let Some(singleton) = parts.next() {
        if singleton.len() != 1 || !is_alphanumeric(singleton) {
            return None;
        }
        let private = singleton.eq_ignore_ascii_case("x");
        let mut count = 0;
        while let Some(&part) = parts.peek() {
            let fits = if private {
                (1..=8).contains(&part.len())
            } else {
                (2..=8).contains(&part.len())
            };
            if !fits || !is_alphanumeric(part) {
                break;
            }
            count += 1;
            parts.next();
        }
        if count == 0 {
            return None;
        }
        if private {
            if parts.next().is_some() {
                return None;
            }
            break;
        }
    }
    let variants = match variants_start {
        Some(start) => &tag[start..variants_end],
        None => "",
    };
    Some(Subtags {
        language,
        script,
        region,
        variants,
    })
}

/// The tag's normal form: `en`, `sr-Latn-RS`, `ca-ES-valencia`.
fn normal(subtags: &Subtags<'_>) -> String {
    let mut out = String::with_capacity(16);
    out.push_str(&subtags.language.to_ascii_lowercase());
    if let Some(script) = subtags.script {
        out.push('-');
        for (index, ch) in script.chars().enumerate() {
            out.push(if index == 0 {
                ch.to_ascii_uppercase()
            } else {
                ch.to_ascii_lowercase()
            });
        }
    }
    if let Some(region) = subtags.region {
        out.push('-');
        out.push_str(&region.to_ascii_uppercase());
    }
    if !subtags.variants.is_empty() {
        out.push('-');
        out.push_str(&subtags.variants.to_ascii_lowercase());
    }
    out
}

/// The language and region of a cldr-json name, the part `Intl` must have data for.
fn language_and_region(name: &str) -> (&str, &str) {
    let mut parts = name.split('-');
    let language = parts.next().unwrap_or("");
    let region = parts
        .find(|part| {
            (part.len() == 2 && is_alpha(part))
                || (part.len() == 3 && part.bytes().all(|b| b.is_ascii_digit()))
        })
        .unwrap_or("");
    (language, region)
}

/// Drops subtags from the end of `start` until a built locale, or stops when the candidate is
/// shorter than `floor` bytes. Returns the first candidate that is a built locale or the default
/// content of one (the name the tag resolves to), and the data of the first built locale.
fn walk(start: &str, floor: usize) -> Option<(&str, &'static LocaleData)> {
    let mut candidate = start;
    let mut resolved = None;
    loop {
        if candidate.len() < floor {
            return None;
        }
        if let Some(found) = data::locale(candidate) {
            return Some((resolved.unwrap_or(candidate), found));
        }
        if resolved.is_none() && data::is_default_content(candidate) {
            resolved = Some(candidate);
        }
        candidate = &candidate[..candidate.rfind('-')?];
    }
}

impl Locale {
    /// The locale for a BCP 47 tag (`"de-CH"`, `"ar-EG"`, `"sr-Latn-RS"`). Its data is the tag's
    /// own if the build has it, else its nearest ancestor's by TR35's fallback (`de-XX` is `de`,
    /// `xx-YY` is root). The `-u-nu-` keyword picks the numbering system (`ar-EG-u-nu-latn`),
    /// where the build supports it (see [`FormatOptions::numbering_system`](crate::FormatOptions::numbering_system));
    /// other extensions are ignored.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidLocale`] for a tag that isn't a structurally valid BCP 47 tag, as `Intl`
    /// throws a `RangeError` for one.
    pub fn new(tag: &str) -> Result<Self, Error> {
        Self::with_matcher(tag, LocaleMatcher::BestFit)
    }

    /// The locale for a tag, matched by `matcher` (`Intl`'s `localeMatcher`): the same locale
    /// either way, as in V8 ([`LocaleMatcher`]).
    ///
    /// # Errors
    ///
    /// As [`Locale::new`].
    pub fn with_matcher(tag: &str, matcher: LocaleMatcher) -> Result<Self, Error> {
        // V8's "best fit" is its lookup
        let (LocaleMatcher::BestFit | LocaleMatcher::Lookup) = matcher;
        let subtags = subtags(tag).ok_or(Error::InvalidLocale)?;
        let requested = normal(&subtags);
        // A language-region tag is first looked up with its likely script, as CLDR's likely subtags
        // give it: zh-TW is zh-Hant-TW, sr-ME sr-Latn-ME, zh-CN zh-Hans-CN. Without that script's
        // locale in the build, the tag falls back as written.
        let mut found = None;
        if let (None, Some(region)) = (subtags.script, subtags.region) {
            let language = subtags.language.to_ascii_lowercase();
            let region = region.to_ascii_uppercase();
            let mut key = String::with_capacity(language.len() + 1 + region.len());
            key.push_str(&language);
            key.push('-');
            key.push_str(&region);
            if let Some(script) =
                data::likely_script(&key).or_else(|| data::likely_script(&language))
            {
                let scripted = normal(&Subtags {
                    script: Some(script),
                    ..subtags
                });
                // down to language-Script, never to the language, whose script is another
                let floor = language.len() + 1 + script.len();
                found = walk(&scripted, floor).map(|(name, data)| (String::from(name), data));
            }
        }
        let (resolved_name, data) = match found {
            Some(found) => found,
            None => match walk(&requested, 0) {
                Some((name, data)) => (String::from(name), data),
                None => (
                    String::new(),
                    data::locale("und").ok_or(Error::InvalidLocale)?,
                ),
            },
        };
        // as ducat requires of Intl: data for the tag's own language and region, and for its script
        // where it names one (uz-Arab isn't uz, whose script is Latn)
        let language = subtags.language.to_ascii_lowercase();
        let script_kept = match subtags.script {
            None => true,
            Some(script) => {
                let resolved_script = resolved_name
                    .split('-')
                    .nth(1)
                    .filter(|part| part.len() == 4)
                    .or_else(|| data::likely_script(&language));
                resolved_script.is_some_and(|found| found.eq_ignore_ascii_case(script))
            }
        };
        let has_data = !resolved_name.is_empty()
            && script_kept
            && language_and_region(&resolved_name) == language_and_region(&requested);
        let numbers = icu::numbers(data.name).unwrap_or(data.numbers);
        let mut locale = Self {
            data,
            numbers,
            digits: &numbers.digits,
            system: data.system,
            has_data,
            region: [0; 3],
        };
        if let Some((numbers, digits, system)) =
            unicode_nu(tag).and_then(|name| locale.find_system(&name))
        {
            locale.numbers = numbers;
            locale.digits = digits;
            locale.system = system;
        }
        let region_text = subtags
            .region
            .map(str::to_ascii_uppercase)
            .unwrap_or_else(|| String::from(language_and_region(data.name).1));
        for (slot, byte) in locale.region.iter_mut().zip(region_text.bytes()) {
            *slot = byte;
        }
        Ok(locale)
    }

    /// The number data and digits of the numbering system `name`, if the build supports it for
    /// this locale: its default, and with the `numbering-systems` feature every numeric system
    /// of CLDR's (with the locale's data for it, else latn's, as TR35 and ICU fall back).
    fn find_system(
        &self,
        name: &str,
    ) -> Option<(&'static Numbers, &'static [char; 10], &'static str)> {
        let default = icu::numbers(self.data.name).unwrap_or(self.data.numbers);
        if name == self.data.system {
            return Some((default, &default.digits, self.data.system));
        }
        #[cfg(feature = "numbering-systems")]
        {
            let (system, digits) = data::digits(name)?;
            let own = |wanted: &str| {
                self.data
                    .systems
                    .iter()
                    .find(|(found, _)| *found == wanted)
                    .map(|(_, numbers)| *numbers)
            };
            let numbers = own(system).or_else(|| {
                if self.data.system == "latn" {
                    Some(default)
                } else {
                    own("latn")
                }
            })?;
            Some((numbers, digits, system))
        }
        #[cfg(not(feature = "numbering-systems"))]
        None
    }

    /// The number data and digits for `option` (`FormatOptions::numbering_system`) where the
    /// build supports it, else the tag's (its `-u-nu-`, else the default), as ECMA-402's
    /// `ResolveLocale` keeps the keyword for an unsupported option (JavaScriptCore does; V8 drops
    /// it: `th-TH-u-nu-thai` with `roman` is latn there).
    pub(crate) fn system(&self, option: Option<&str>) -> (&'static Numbers, &'static [char; 10]) {
        option
            .and_then(|name| self.find_system(name))
            .map_or((self.numbers, self.digits), |(numbers, digits, _)| {
                (numbers, digits)
            })
    }

    /// The numbering system the tag's data is written in: its `-u-nu-` where the build supports
    /// it, else the locale's default (`latn`, `arab` for ar-EG).
    #[must_use]
    pub const fn numbering_system(&self) -> &'static str {
        self.system
    }

    /// The cldr-json name of the locale whose data this is: `de-CH`, `de` for `de-DE` or `de-XX`,
    /// `und` (root) for an unknown language.
    #[must_use]
    pub fn data_name(&self) -> &'static str {
        self.data.name
    }

    /// Whether the build has data for the tag's own language and region (`de-DE` and `de-CH` do;
    /// `de-XX`, which falls back to `de`, doesn't). [`parse()`](crate::parse) refuses a locale
    /// without it, as ducat does.
    #[must_use]
    pub const fn has_data(&self) -> bool {
        self.has_data
    }

    pub(crate) const fn numbers(&self) -> &'static Numbers {
        self.numbers
    }

    pub(crate) const fn plurals(&self) -> &'static [crate::tables::Rule] {
        self.data.plurals
    }

    /// A currency's entry for one field, from this locale up its parents to root.
    pub(crate) fn currency_field(
        &self,
        code: &str,
        field: impl Fn(&'static CurrencyData) -> Option<&'static str>,
    ) -> Option<&'static str> {
        self.currency_owner(code, &field)
            .and_then(|(_, entry)| field(entry))
    }

    /// The first locale, from this one up its parents to root, whose entry for the currency has
    /// the field, and that entry.
    pub(crate) fn currency_owner(
        &self,
        code: &str,
        field: impl Fn(&'static CurrencyData) -> Option<&'static str>,
    ) -> Option<(&'static LocaleData, &'static CurrencyData)> {
        let mut locale = self.data;
        // the chain is at most a few locales long; the bound guards against a cycle in the data
        for _ in 0..16 {
            if let Ok(at) = locale
                .currencies
                .binary_search_by(|entry| entry.code.as_slice().cmp(code.as_bytes()))
            {
                let entry = &locale.currencies[at];
                if field(entry).is_some() {
                    return Some((locale, entry));
                }
            }
            if locale.parent.is_empty() {
                return None;
            }
            locale = data::locale(locale.parent)?;
        }
        None
    }

    /// The current legal tender of the locale's region (EUR for en-NL), if CLDR names one.
    fn region_currency(&self) -> Option<&'static str> {
        let length = self.region.iter().position(|&byte| byte == 0).unwrap_or(3);
        let region = core::str::from_utf8(&self.region[..length]).ok()?;
        if region.is_empty() {
            return None;
        }
        territory_currencies(region, &TerritoryOptions::default())
            .ok()?
            .into_iter()
            .find(|use_| use_.to.is_none())
            .map(|use_| use_.currency)
    }

    /// The pattern and separators CLDR gives this currency of its own in the locale (EUR in
    /// en-150, PTE in pt-PT), as ICU stores them: with the separators of the locale that gives
    /// them, or that locale's own where CLDR gives none, which its descendants inherit.
    fn special_format(&self, code: &str) -> Option<(&'static str, &'static str, &'static str)> {
        let (owner, entry) = self.currency_owner(code, |entry| {
            entry
                .field('p')
                .or_else(|| entry.field('.'))
                .or_else(|| entry.field(','))
        })?;
        let numbers = icu::numbers(owner.name).unwrap_or(owner.numbers);
        Some((
            entry.field('p').unwrap_or(numbers.currency_pattern),
            entry.field('.').unwrap_or(numbers.decimal),
            entry.field(',').unwrap_or(numbers.group),
        ))
    }

    /// The pattern and separators every sign and display of `code` is written with, where ICU
    /// 78.3 writes them so (data/icu/README.md): the currency's own special format, else that of
    /// the locale's region's currency, which ICU's symbols load for the locale and keep for
    /// currencies without one (en-NL writes USD as `US$1,234.50`, in EUR's pattern from en-150).
    pub(crate) fn currency_format(
        &self,
        code: &str,
    ) -> Option<(&'static str, &'static str, &'static str)> {
        self.special_format(code).or_else(|| {
            let region_code = self.region_currency()?;
            self.special_format(region_code)
        })
    }
}

/// The cldr-json names of every locale in this build (root, `und`, included), in code order.
pub fn locales() -> impl Iterator<Item = &'static str> {
    data::NAMES
        .iter()
        .copied()
        .filter(|name| data::locale(name).is_some())
}
