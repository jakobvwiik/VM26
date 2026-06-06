// English (as stored in DB) -> { no: Norwegian name, flag: emoji }
export const TEAM_INFO = {
  "Algeria":               { no:"Algerie",            flag:"🇩🇿" },
  "Argentina":             { no:"Argentina",          flag:"🇦🇷" },
  "Australia":             { no:"Australia",          flag:"🇦🇺" },
  "Austria":               { no:"Østerrike",          flag:"🇦🇹" },
  "Belgium":               { no:"Belgia",             flag:"🇧🇪" },
  "Bosnia and Herzegovina":{ no:"Bosnia-Hercegovina", flag:"🇧🇦" },
  "Brazil":                { no:"Brasil",             flag:"🇧🇷" },
  "Canada":                { no:"Canada",             flag:"🇨🇦" },
  "Cape Verde":            { no:"Kapp Verde",         flag:"🇨🇻" },
  "Colombia":              { no:"Colombia",           flag:"🇨🇴" },
  "Croatia":               { no:"Kroatia",            flag:"🇭🇷" },
  "Curacao":               { no:"Curaçao",            flag:"🇨🇼" },
  "Czechia":               { no:"Tsjekkia",           flag:"🇨🇿" },
  "DR Congo":              { no:"DR Kongo",           flag:"🇨🇩" },
  "Ecuador":               { no:"Ecuador",            flag:"🇪🇨" },
  "Egypt":                 { no:"Egypt",              flag:"🇪🇬" },
  "England":               { no:"England",            flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  "France":                { no:"Frankrike",          flag:"🇫🇷" },
  "Germany":               { no:"Tyskland",           flag:"🇩🇪" },
  "Ghana":                 { no:"Ghana",              flag:"🇬🇭" },
  "Haiti":                 { no:"Haiti",              flag:"🇭🇹" },
  "Iran":                  { no:"Iran",               flag:"🇮🇷" },
  "Iraq":                  { no:"Irak",               flag:"🇮🇶" },
  "Ivory Coast":           { no:"Elfenbenskysten",    flag:"🇨🇮" },
  "Japan":                 { no:"Japan",              flag:"🇯🇵" },
  "Jordan":                { no:"Jordan",             flag:"🇯🇴" },
  "Mexico":                { no:"Mexico",             flag:"🇲🇽" },
  "Morocco":               { no:"Marokko",            flag:"🇲🇦" },
  "Netherlands":           { no:"Nederland",          flag:"🇳🇱" },
  "New Zealand":           { no:"New Zealand",        flag:"🇳🇿" },
  "Norway":                { no:"Norge",              flag:"🇳🇴" },
  "Panama":                { no:"Panama",             flag:"🇵🇦" },
  "Paraguay":              { no:"Paraguay",           flag:"🇵🇾" },
  "Portugal":              { no:"Portugal",           flag:"🇵🇹" },
  "Qatar":                 { no:"Qatar",              flag:"🇶🇦" },
  "Saudi Arabia":          { no:"Saudi-Arabia",       flag:"🇸🇦" },
  "Scotland":              { no:"Skottland",          flag:"🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  "Senegal":               { no:"Senegal",            flag:"🇸🇳" },
  "South Africa":          { no:"Sør-Afrika",         flag:"🇿🇦" },
  "South Korea":           { no:"Sør-Korea",          flag:"🇰🇷" },
  "Spain":                 { no:"Spania",             flag:"🇪🇸" },
  "Sweden":                { no:"Sverige",            flag:"🇸🇪" },
  "Switzerland":           { no:"Sveits",             flag:"🇨🇭" },
  "Tunisia":               { no:"Tunisia",            flag:"🇹🇳" },
  "Turkiye":               { no:"Tyrkia",             flag:"🇹🇷" },
  "USA":                   { no:"USA",                flag:"🇺🇸" },
  "Uruguay":               { no:"Uruguay",            flag:"🇺🇾" },
  "Uzbekistan":            { no:"Usbekistan",         flag:"🇺🇿" },
};
// Norwegian display name (falls back to original, e.g. "R32 M1 (hjemme)")
export function teamNo(name){ return TEAM_INFO[name]?.no || name; }
export function teamFlag(name){ return TEAM_INFO[name]?.flag || ""; }
// "🇳🇴 Norge" — flag + Norwegian name
export function teamLabel(name){
  const i=TEAM_INFO[name];
  return i ? `${i.flag} ${i.no}` : name;
}
