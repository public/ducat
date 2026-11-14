//! Locale tags (BCP 47) and their data: the tag is checked as `Intl` checks it, then resolved by
//! TR35's fallback, dropping subtags from the end down to root (`und`).

use alloc::string::String;

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
    numbers: &'static Numbers,
    has_data: bool,
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

impl Locale {
    /// The locale for a BCP 47 tag (`"de-CH"`, `"ar-EG"`, `"sr-Latn-RS"`). Its data is the tag's
    /// own if the build has it, else its nearest ancestor's by TR35's fallback (`de-XX` is `de`,
    /// `xx-YY` is root); extensions such as `-u-nu-` are ignored.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidLocale`] for a tag that isn't a structurally valid BCP 47 tag, as `Intl`
    /// throws a `RangeError` for one.
    pub fn new(tag: &str) -> Result<Self, Error> {
        let subtags = subtags(tag).ok_or(Error::InvalidLocale)?;
        let requested = normal(&subtags);
        let mut candidate: &str = &requested;
        let mut resolved_name: Option<&str> = None;
        let data = loop {
            if let Some(found) = data::locale(candidate) {
                resolved_name.get_or_insert(candidate);
                break found;
            }
            if resolved_name.is_none() && data::is_default_content(candidate) {
                resolved_name = Some(candidate);
            }
            match candidate.rfind('-') {
                Some(at) => candidate = &candidate[..at],
                None => break data::locale("und").ok_or(Error::InvalidLocale)?,
            }
        };
        // as ducat requires of Intl: data for the tag's own language and region
        let has_data = resolved_name
            .is_some_and(|name| language_and_region(name) == language_and_region(&requested));
        let numbers = icu::numbers(data.name).unwrap_or(data.numbers);
        Ok(Self {
            data,
            numbers,
            has_data,
        })
    }

    /// The cldr-json name of the locale whose data this is: `de-CH`, `de` for `de-DE` or `de-XX`,
    /// `und` (root) for an unknown language.
    #[must_use]
    pub fn data_name(&self) -> &'static str {
        self.data.name
    }

    /// Whether the build has data for the tag's own language and region (`de-DE` and `de-CH` do;
    /// `de-XX`, which falls back to `de`, doesn't). [`parse`](crate::parse) refuses a locale
    /// without it, as ducat does.
    #[must_use]
    pub const fn has_data(&self) -> bool {
        self.has_data
    }

    #[allow(dead_code)] // read by the formatter
    pub(crate) const fn numbers(&self) -> &'static Numbers {
        self.numbers
    }

    #[allow(dead_code)] // read by the formatter
    pub(crate) const fn plurals(&self) -> &'static [crate::tables::Rule] {
        self.data.plurals
    }

    /// A currency's entry for one field, from this locale up its parents to root.
    #[allow(dead_code)] // read by the formatter
    pub(crate) fn currency_field(
        &self,
        code: &str,
        field: impl Fn(&'static CurrencyData) -> Option<&'static str>,
    ) -> Option<&'static str> {
        let mut locale = self.data;
        // the chain is at most a few locales long; the bound guards against a cycle in the data
        for _ in 0..16 {
            if let Ok(at) = locale
                .currencies
                .binary_search_by(|entry| entry.code.as_slice().cmp(code.as_bytes()))
            {
                if let Some(value) = field(&locale.currencies[at]) {
                    return Some(value);
                }
            }
            if locale.parent.is_empty() {
                return None;
            }
            locale = data::locale(locale.parent)?;
        }
        None
    }
}

/// The cldr-json names of every locale in this build (root, `und`, included), in code order.
pub fn locales() -> impl Iterator<Item = &'static str> {
    data::NAMES
        .iter()
        .copied()
        .filter(|name| data::locale(name).is_some())
}
