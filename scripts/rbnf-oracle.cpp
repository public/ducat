// The ICU oracle for test/vectors/rbnf.json: reads "locale<TAB>rule set<TAB>integer" lines and prints
// ICU's spell-out for each (or "ERR <code>"), and ICU's version for a line "VERSION". Build it
// against ICU4C 79.1 (CLDR 49), the release the rules in data/rbnf come from; see
// scripts/gen-rbnf-vectors.mjs. Given a directory (data/rbnf), it runs ICU's engine on the rule text
// in <directory>/<locale>.txt instead of ICU's own data, so an older ICU can check CLDR 49's rules.
#include <unicode/rbnf.h>
#include <unicode/locid.h>
#include <unicode/unistr.h>
#include <unicode/uversion.h>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <string>
using namespace icu;
int main(int argc, char **argv) {
  std::map<std::string, std::unique_ptr<RuleBasedNumberFormat>> formats;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line == "VERSION") {
      UVersionInfo version;
      char text[U_MAX_VERSION_STRING_LENGTH];
      u_getVersion(version);
      u_versionToString(version, text);
      std::cout << text << "\n";
      continue;
    }
    auto tab1 = line.find('\t'), tab2 = line.find('\t', tab1 + 1);
    std::string loc = line.substr(0, tab1), rs = line.substr(tab1 + 1, tab2 - tab1 - 1), num = line.substr(tab2 + 1);
    UErrorCode status = U_ZERO_ERROR;
    auto &fmt = formats[loc];
    if (!fmt && argc > 1) {
      std::ifstream file(std::string(argv[1]) + "/" + loc + ".txt");
      std::string rules, ruleLine;
      while (std::getline(file, ruleLine)) {
        if (!ruleLine.empty() && ruleLine[0] != '#') rules += ruleLine + "\n";
      }
      UParseError error;
      fmt.reset(new RuleBasedNumberFormat(UnicodeString::fromUTF8(rules), Locale(loc.c_str()), error, status));
    } else if (!fmt) {
      fmt.reset(new RuleBasedNumberFormat(URBNF_SPELLOUT, Locale(loc.c_str()), status));
    }
    UnicodeString out;
    if (U_SUCCESS(status)) {
      StringPiece sp(num.c_str());
      Formattable f(sp, status);
      fmt->setDefaultRuleSet(UnicodeString::fromUTF8(rs), status);
      FieldPosition pos;
      if (U_SUCCESS(status)) fmt->format(f, out, pos, status);
    }
    std::string s;
    if (U_FAILURE(status)) { std::cout << "ERR " << u_errorName(status) << "\n"; continue; }
    out.toUTF8String(s);
    std::cout << s << "\n";
  }
}
