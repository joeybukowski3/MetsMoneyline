const CURRENT_PLAYER_ALIAS_OVERRIDES = {
  "Carlos Mendoza": {
    aliases: ["carlos mendoza", "mendoza"],
    requiresTeamContext: true
  },
  "Francisco Lindor": {
    aliases: ["francisco lindor", "lindor"]
  },
  "Juan Soto": {
    aliases: ["juan soto", "soto"]
  },
  "Pete Alonso": {
    aliases: ["pete alonso", "alonso", "polar bear"]
  },
  "Brandon Nimmo": {
    aliases: ["brandon nimmo", "nimmo"]
  },
  "Edwin Diaz": {
    aliases: ["edwin diaz", "edwin diaz", "diaz", "sugar"]
  },
  "Kodai Senga": {
    aliases: ["kodai senga", "senga", "ghost fork"]
  },
  "Jeff McNeil": {
    aliases: ["jeff mcneil", "mcneil"]
  },
  "Mark Vientos": {
    aliases: ["mark vientos", "vientos"]
  },
  "Francisco Alvarez": {
    aliases: ["francisco alvarez", "francisco alvarez", "alvarez"]
  },
  "Brett Baty": {
    aliases: ["brett baty", "baty"]
  },
  "Luisangel Acuna": {
    aliases: ["luisangel acuna", "luisangel acuna", "acuna"]
  },
  "Tylor Megill": {
    aliases: ["tylor megill", "megill"]
  },
  "David Peterson": {
    aliases: ["david peterson", "peterson"]
  },
  "Clay Holmes": {
    aliases: ["clay holmes", "holmes"]
  },
  "Sean Manaea": {
    aliases: ["sean manaea", "manaea"]
  }
};

// Current Mets players should come from the live MLB active roster.
// Keep former-player tracking here so popular ex-Mets can be shown separately
// without affecting the main social score. If one of these players returns to
// the active roster, the runtime roster fetch will move them back into the
// current-player group automatically.
const FORMER_PLAYER_DEFS = [
  { name: "Pete Alonso", playerId: 624413, aliases: ["pete alonso", "alonso", "polar bear"] },
  { name: "Jacob deGrom", playerId: 594798, aliases: ["jacob degrom", "jacob de grom", "degrom", "degrom"] },
  { name: "Max Scherzer", playerId: 453286, aliases: ["max scherzer", "scherzer", "mad max"] },
  { name: "Justin Verlander", playerId: 434378, aliases: ["justin verlander", "verlander"] },
  { name: "Brandon Nimmo", playerId: 607043, aliases: ["brandon nimmo", "nimmo"] },
  { name: "Francisco Lindor", playerId: 596019, aliases: ["francisco lindor", "lindor"] },
  { name: "Noah Syndergaard", playerId: 592789, aliases: ["noah syndergaard", "syndergaard", "thor"] },
  { name: "Max Kranick", playerId: 669127, aliases: ["max kranick", "kranick"] },
  { name: "Jose Quintana", playerId: 500779, aliases: ["jose quintana", "quintana"] }
];

module.exports = {
  CURRENT_PLAYER_ALIAS_OVERRIDES,
  FORMER_PLAYER_DEFS
};
