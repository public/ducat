//! A small JSON reader for the Bank of Canada's Valet files, so the library needs no JSON
//! dependency: RFC 8259 values, objects in their order with the last of a repeated key winning in
//! the first one's place (as JavaScript's `JSON.parse` keeps them), numbers kept as their text, and
//! a nesting limit so deep input is an error rather than a stack overflow.

use alloc::string::String;
use alloc::vec::Vec;

use crate::Error;

/// Deeper nesting than any Valet file has, and shallow enough for any stack.
const MAX_DEPTH: usize = 64;

#[derive(Debug, PartialEq)]
pub(crate) enum Value {
    Null,
    Bool(bool),
    /// The number as written.
    Number(String),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub(crate) fn get(&self, key: &str) -> Option<&Self> {
        match self {
            Self::Object(fields) => fields
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

const fn bad<T>() -> Result<T, Error> {
    Err(Error::MalformedRates)
}

impl Reader<'_> {
    fn skip_space(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.bytes.get(self.at) {
            self.at += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn literal(&mut self, word: &[u8], value: Value) -> Result<Value, Error> {
        if self.bytes.get(self.at..self.at + word.len()) == Some(word) {
            self.at += word.len();
            Ok(value)
        } else {
            bad()
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value, Error> {
        if depth > MAX_DEPTH {
            return bad();
        }
        self.skip_space();
        match self.peek() {
            Some(b'{') => self.object(depth),
            Some(b'[') => self.array(depth),
            Some(b'"') => self.string().map(Value::String),
            Some(b't') => self.literal(b"true", Value::Bool(true)),
            Some(b'f') => self.literal(b"false", Value::Bool(false)),
            Some(b'n') => self.literal(b"null", Value::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => bad(),
        }
    }

    fn object(&mut self, depth: usize) -> Result<Value, Error> {
        self.at += 1;
        let mut fields: Vec<(String, Value)> = Vec::new();
        self.skip_space();
        if self.peek() == Some(b'}') {
            self.at += 1;
            return Ok(Value::Object(fields));
        }
        loop {
            self.skip_space();
            if self.peek() != Some(b'"') {
                return bad();
            }
            let key = self.string()?;
            self.skip_space();
            if self.peek() != Some(b':') {
                return bad();
            }
            self.at += 1;
            let value = self.value(depth + 1)?;
            match fields.iter_mut().find(|(name, _)| *name == key) {
                Some(field) => field.1 = value,
                None => fields.push((key, value)),
            }
            self.skip_space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b'}') => {
                    self.at += 1;
                    return Ok(Value::Object(fields));
                }
                _ => return bad(),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<Value, Error> {
        self.at += 1;
        let mut items = Vec::new();
        self.skip_space();
        if self.peek() == Some(b']') {
            self.at += 1;
            return Ok(Value::Array(items));
        }
        loop {
            items.push(self.value(depth + 1)?);
            self.skip_space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b']') => {
                    self.at += 1;
                    return Ok(Value::Array(items));
                }
                _ => return bad(),
            }
        }
    }

    fn hex4(&mut self) -> Result<u32, Error> {
        let digits = self
            .bytes
            .get(self.at..self.at + 4)
            .ok_or(Error::MalformedRates)?;
        let mut value = 0;
        for &digit in digits {
            value = value * 16
                + char::from(digit)
                    .to_digit(16)
                    .ok_or(Error::MalformedRates)?;
        }
        self.at += 4;
        Ok(value)
    }

    fn string(&mut self) -> Result<String, Error> {
        self.at += 1;
        let mut out = String::new();
        loop {
            let start = self.at;
            while let Some(byte) = self.peek() {
                if byte == b'"' || byte == b'\\' || byte < 0x20 {
                    break;
                }
                self.at += 1;
            }
            // the input is a &str and the run stops only at ASCII bytes, so it is whole UTF-8
            out.push_str(
                core::str::from_utf8(&self.bytes[start..self.at])
                    .map_err(|_| Error::MalformedRates)?,
            );
            match self.peek() {
                Some(b'"') => {
                    self.at += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.at += 1;
                    let escape = self.peek().ok_or(Error::MalformedRates)?;
                    self.at += 1;
                    let char = match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => self.unicode()?,
                        _ => return bad(),
                    };
                    out.push(char);
                }
                _ => return bad(),
            }
        }
    }

    /// A `\u` escape, a surrogate pair joined; a lone surrogate becomes U+FFFD, as JavaScript
    /// strings can hold one and ducat never reads it.
    fn unicode(&mut self) -> Result<char, Error> {
        let first = self.hex4()?;
        if (0xd800..0xdc00).contains(&first) && self.bytes.get(self.at..self.at + 2) == Some(b"\\u")
        {
            let saved = self.at;
            self.at += 2;
            let second = self.hex4()?;
            if (0xdc00..0xe000).contains(&second) {
                let joined = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
                return Ok(char::from_u32(joined).unwrap_or('\u{fffd}'));
            }
            self.at = saved;
        }
        Ok(char::from_u32(first).unwrap_or('\u{fffd}'))
    }

    fn number(&mut self) -> Result<Value, Error> {
        let start = self.at;
        if self.peek() == Some(b'-') {
            self.at += 1;
        }
        let digits = |reader: &mut Self| {
            let from = reader.at;
            while reader.peek().is_some_and(|byte| byte.is_ascii_digit()) {
                reader.at += 1;
            }
            reader.at - from
        };
        let whole_start = self.at;
        let whole = digits(self);
        if whole == 0 || (whole > 1 && self.bytes[whole_start] == b'0') {
            return bad();
        }
        if self.peek() == Some(b'.') {
            self.at += 1;
            if digits(self) == 0 {
                return bad();
            }
        }
        if let Some(b'e' | b'E') = self.peek() {
            self.at += 1;
            if let Some(b'+' | b'-') = self.peek() {
                self.at += 1;
            }
            if digits(self) == 0 {
                return bad();
            }
        }
        let text =
            core::str::from_utf8(&self.bytes[start..self.at]).map_err(|_| Error::MalformedRates)?;
        Ok(Value::Number(text.into()))
    }
}

/// The JSON value of `text`.
///
/// # Errors
///
/// [`Error::MalformedRates`] for anything that isn't one JSON value, or nests deeper than 64.
pub(crate) fn parse(text: &str) -> Result<Value, Error> {
    let mut reader = Reader {
        bytes: text.as_bytes(),
        at: 0,
    };
    let value = reader.value(0)?;
    reader.skip_space();
    if reader.at == text.len() {
        Ok(value)
    } else {
        bad()
    }
}

#[cfg(test)]
mod tests {
    use alloc::string::ToString;
    use alloc::vec;

    use super::*;

    #[test]
    fn reads_json() {
        let value =
            parse(r#" {"a": [1, -2.5e3, true, null], "b": "x\u00e9\ud83d\ude00\n", "a": {}} "#)
                .unwrap();
        assert_eq!(
            value,
            Value::Object(vec![
                ("a".to_string(), Value::Object(vec![])),
                ("b".to_string(), Value::String("xé😀\n".to_string())),
            ])
        );
        for bad in [
            "",
            "{",
            "[1,]",
            "01",
            "1.",
            "-",
            "\"\u{1}\"",
            "{\"a\" 1}",
            "nul",
            "[] x",
            "\"\\x\"",
        ] {
            assert_eq!(parse(bad), Err(Error::MalformedRates), "{bad:?}");
        }
        let deep = "[".repeat(10_000);
        assert_eq!(parse(&deep), Err(Error::MalformedRates));
    }
}
