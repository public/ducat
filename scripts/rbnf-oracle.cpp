// The ICU oracle for test/vectors/rbnf.json: reads "locale<TAB>rule set<TAB>integer" lines and prints
// ICU's spell-out for each (or "ERR <code>"). Build it against ICU4C 79.1 (CLDR 49), the release
// the rules in data/rbnf come from; see scripts/gen-rbnf-vectors.mjs.
#include <unicode/rbnf.h>
#include <unicode/locid.h>
#include <unicode/unistr.h>
#include <iostream>
#include <map>
#include <memory>
#include <string>
using namespace icu;
int main() {
  std::map<std::string, std::unique_ptr<RuleBasedNumberFormat>> formats;
  std::string line;
  while (std::getline(std::cin, line)) {
    auto tab1 = line.find('\t'), tab2 = line.find('\t', tab1 + 1);
    std::string loc = line.substr(0, tab1), rs = line.substr(tab1 + 1, tab2 - tab1 - 1), num = line.substr(tab2 + 1);
    UErrorCode status = U_ZERO_ERROR;
    auto &fmt = formats[loc];
    if (!fmt) fmt.reset(new RuleBasedNumberFormat(URBNF_SPELLOUT, Locale(loc.c_str()), status));
    UnicodeString out;
    status = U_ZERO_ERROR;
    StringPiece sp(num.c_str());
    Formattable f(sp, status);
    fmt->setDefaultRuleSet(UnicodeString::fromUTF8(rs), status);
    FieldPosition pos;
    if (U_SUCCESS(status)) fmt->format(f, out, pos, status);
    std::string s;
    if (U_FAILURE(status)) { std::cout << "ERR " << u_errorName(status) << "\n"; continue; }
    out.toUTF8String(s);
    std::cout << s << "\n";
  }
}
